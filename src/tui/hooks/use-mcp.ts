/**
 * Hook for MCP (Model Context Protocol) integration into the TUI.
 *
 * Manages the McpManager lifecycle:
 * - Creates manager and connects servers from config on mount
 * - Exposes reactive signals for status map and tool list
 * - Registers/unregisters MCP tools in the shared tools array
 * - Fires toast callbacks on connect/disconnect/tools-changed events
 * - Cleans up (disconnects all servers) on unmount
 */

import { createSignal, onCleanup, onMount } from 'solid-js';
import { McpManager } from '../../agent/mcp';
import type { McpStatusMap, McpToolInfo } from '../../agent/mcp/types';
import { getToolsArray } from '../../agent/tools';
import type { ResolvedConfig } from '../../config/schema';

export type UseMcpProps = {
  /** Resolved app config (mcp field has server configs) */
  config: ResolvedConfig;
  /** Callback to show a toast message */
  onToast?: (message: string) => void;
};

export type UseMcpReturn = {
  /** Reactive MCP status map (server name -> status/toolCount/error) */
  mcpStatus: () => McpStatusMap;
  /** Reactive list of all MCP tool metadata (for permissions/mode filtering) */
  mcpTools: () => McpToolInfo[];
  /** The McpManager instance (for /mcp command access to stderr, etc.) */
  manager: McpManager;
  /** Whether initial connection is still in progress */
  connecting: () => boolean;
};

export function useMcp(props: UseMcpProps): UseMcpReturn {
  const manager = new McpManager();

  const [mcpStatus, setMcpStatus] = createSignal<McpStatusMap>(new Map());
  const [mcpTools, setMcpTools] = createSignal<McpToolInfo[]>([]);
  const [connecting, setConnecting] = createSignal(false);

  /** Snapshot current status from manager into signal */
  const refreshStatus = () => {
    setMcpStatus(manager.getStatus());
  };

  /** Max output chars for MCP tool truncation */
  const maxOutputChars = props.config.tools.mcp.maxOutputChars;

  // Track unsubscribe function for cleanup
  let unsubscribe: (() => void) | undefined;

  // Cleanup unconditionally — safe even if no servers were connected (#4 review)
  onCleanup(() => {
    unsubscribe?.();
    manager.unregisterTools(getToolsArray());
    void manager.disconnectAll();
  });

  onMount(() => {
    const servers = props.config.mcp;
    const serverNames = Object.keys(servers).filter(
      (name) => servers[name]?.enabled !== false,
    );

    // Nothing to do if no MCP servers configured
    if (serverNames.length === 0) return;

    setConnecting(true);

    // Listen for tool list changes (reconnects, dynamic tool updates)
    unsubscribe = manager.onToolsChanged((tools) => {
      setMcpTools(tools);
      refreshStatus();

      // Re-register tools in the shared array with fresh definitions
      manager.registerTools(getToolsArray(), maxOutputChars);
    });

    // Connect all servers, then register tools and update signals
    void manager
      .connectAll(servers)
      .then(() => {
        const tools = manager.getAllTools();
        setMcpTools(tools);
        refreshStatus();
        setConnecting(false);

        // Register MCP tools into the shared tools array
        manager.registerTools(getToolsArray(), maxOutputChars);

        // Fire toast for each connected server
        const status = manager.getStatus();
        for (const [name, info] of status) {
          if (info.status === 'connected') {
            props.onToast?.(
              `MCP: ${name} connected (${info.toolCount} tool${info.toolCount !== 1 ? 's' : ''})`,
            );
          } else if (info.status === 'error') {
            props.onToast?.(`MCP: ${name} failed to connect`);
          }
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        props.onToast?.(`MCP: initialization failed — ${message}`);
        setConnecting(false);
        refreshStatus();
      });
  });

  return {
    mcpStatus,
    mcpTools,
    manager,
    connecting,
  };
}

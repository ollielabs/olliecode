/**
 * Pure utility functions for MCP display in the TUI.
 * Extracted from components for testability.
 */

import type { McpStatusMap } from '../../agent/mcp/types';

/**
 * Parse MCP qualified tool name (mcp__server__tool) into display parts.
 * Returns null if not an MCP tool name.
 */
export function parseMcpToolName(name: string): {
  displayName: string;
  serverName: string;
  toolName: string;
} | null {
  const match = name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (!match?.[1] || !match[2]) return null;
  return {
    displayName: `${match[1]} > ${match[2]}`,
    serverName: match[1],
    toolName: match[2],
  };
}

/**
 * Get the display name for a tool, formatting MCP tools as "server > tool".
 * Native tools pass through unchanged.
 */
export function getToolDisplayName(name: string): string {
  const mcp = parseMcpToolName(name);
  return mcp ? mcp.displayName : name;
}

/**
 * Format MCP status map for display in the status bar.
 *
 * Examples:
 *   "MCP: github(3) context7(2)"
 *   "MCP: github(err) context7(2)"
 *   "MCP: connecting..."
 *   null (no servers configured)
 */
export function formatMcpStatus(
  status: McpStatusMap | undefined,
  connecting: boolean | undefined,
): string | null {
  if (!status || status.size === 0) return null;

  if (connecting) return 'MCP: connecting...';

  const parts: string[] = [];
  for (const [name, info] of status) {
    if (info.status === 'error') {
      parts.push(`${name}(err)`);
    } else if (info.status === 'connecting') {
      parts.push(`${name}(...)`);
    } else if (info.status === 'connected') {
      parts.push(`${name}(${info.toolCount})`);
    } else {
      // disconnected
      parts.push(`${name}(off)`);
    }
  }

  return parts.length > 0 ? `MCP: ${parts.join(' ')}` : null;
}

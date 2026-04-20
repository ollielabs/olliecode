/**
 * Pure utility functions for MCP display in the TUI.
 * Extracted from components for testability.
 */

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

import type { McpConnectionStatus } from '../../agent/mcp/types';

/** Status icons for the sidebar MCP section. */
export const MCP_STATUS_ICONS: Record<McpConnectionStatus, string> = {
  connected: '\u25CF', // ●
  connecting: '\u25CB', // ○
  error: '\u2717', // ✗
  disconnected: '\u25CC', // ◌
};

/**
 * Get the detail text for an MCP server status entry in the sidebar.
 */
export function getMcpStatusDetail(
  status: McpConnectionStatus,
  toolCount: number,
): string {
  switch (status) {
    case 'connected':
      return `${toolCount} tool${toolCount !== 1 ? 's' : ''}`;
    case 'connecting':
      return 'connecting...';
    case 'error':
      return 'error';
    case 'disconnected':
      return 'off';
    default:
      return status;
  }
}

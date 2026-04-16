/**
 * MCP-specific types used by McpManager and tool registration.
 */

import type { ToolRisk } from '../types';

/**
 * Information about a single tool discovered from an MCP server.
 * Created during tool discovery, consumed by tool registration (Issue B).
 */
export type McpToolInfo = {
  /** Original MCP tool name (as reported by the server) */
  name: string;
  /** Qualified name: mcp__<server>__<tool> */
  qualifiedName: string;
  /** Tool description from MCP server */
  description: string;
  /** Raw JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /** MCP tool annotations (hints about behavior) */
  annotations?: McpToolAnnotations;
  /** Name of the MCP server providing this tool */
  serverName: string;
};

/**
 * MCP tool annotations as defined in the MCP spec.
 * These are hints — not guarantees — about tool behavior.
 */
export type McpToolAnnotations = {
  /** Human-readable title for the tool */
  title?: string;
  /** Hint: tool does not modify its environment */
  readOnlyHint?: boolean;
  /** Hint: tool may perform destructive operations */
  destructiveHint?: boolean;
  /** Hint: calling tool repeatedly with same args has no additional effect */
  idempotentHint?: boolean;
  /** Hint: tool interacts with external entities (open-world) */
  openWorldHint?: boolean;
};

/**
 * Connection status for an MCP server.
 */
export type McpConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

/**
 * Status info for a single MCP server, used by TUI (Issue E).
 */
export type McpServerStatus = {
  status: McpConnectionStatus;
  toolCount: number;
  error?: string;
};

/**
 * Map of server name -> status, for TUI display.
 */
export type McpStatusMap = Map<string, McpServerStatus>;

/**
 * Map MCP tool annotations to our ToolRisk level.
 *
 * - destructiveHint -> high
 * - readOnlyHint -> safe
 * - default -> medium (unknown MCP tools are treated cautiously)
 */
export function mcpAnnotationsToRisk(
  annotations?: McpToolAnnotations,
): ToolRisk {
  if (!annotations) return 'medium';
  if (annotations.destructiveHint) return 'high';
  if (annotations.readOnlyHint) return 'safe';
  return 'medium';
}

/**
 * Check if an MCP tool is read-only (for plan mode filtering).
 */
export function isMcpToolReadOnly(tool: McpToolInfo): boolean {
  return tool.annotations?.readOnlyHint === true;
}

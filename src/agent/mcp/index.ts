/**
 * MCP module — re-exports for external consumption.
 */

export { McpManager } from './manager';
export type { McpContentItem, McpToolsChangedListener } from './manager';

export {
  mcpAnnotationsToRisk,
  isMcpToolReadOnly,
} from './types';

export type {
  McpToolInfo,
  McpToolAnnotations,
  McpConnectionStatus,
  McpServerStatus,
  McpStatusMap,
} from './types';

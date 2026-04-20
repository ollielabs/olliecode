/**
 * Agent modes - Plan and Build
 *
 * Plan mode: Read-only research and planning
 * Build mode: Full execution power
 */

export type AgentMode = 'plan' | 'build';

/**
 * Tools available in each mode
 * Plan mode: read-only tools + todo tracking + task delegation + run_command (with whitelist)
 * Build mode: all tools + todo tracking + task delegation
 *
 * Note: run_command in plan mode is filtered by PLAN_MODE_ALLOWED_COMMANDS
 * in the safety layer to only allow read-only commands.
 *
 * Note: task tool delegates to a subagent which always runs in plan mode (read-only).
 */
export const MODE_TOOLS: Record<AgentMode, readonly string[]> = {
  plan: [
    'read_file',
    'list_dir',
    'glob',
    'grep',
    'run_command',
    'todo_write',
    'todo_read',
    'task',
    'web_fetch',
  ] as const,
  build: [
    'read_file',
    'list_dir',
    'glob',
    'grep',
    'write_file',
    'edit_file',
    'run_command',
    'todo_write',
    'todo_read',
    'task',
    'web_fetch',
  ] as const,
};

/**
 * Check if a tool is available in a given mode.
 *
 * Native tools: checked against MODE_TOOLS[mode] (static list).
 * MCP tools (mcp__server__tool): always allowed through here — mode filtering
 * for MCP tools is handled by getToolsForMode() in tools/index.ts, which
 * excludes non-read-only MCP tools from the Ollama tool list in plan mode.
 * If the model calls an MCP tool, it was already mode-approved.
 */
export function isToolAvailable(mode: AgentMode, toolName: string): boolean {
  // MCP tools are mode-filtered at the Ollama tool list level, not here
  if (toolName.startsWith('mcp__')) return true;
  return MODE_TOOLS[mode].includes(toolName);
}

/**
 * Get list of tools for a mode
 */
export function getToolsForMode(mode: AgentMode): readonly string[] {
  return MODE_TOOLS[mode];
}

/**
 * Get display name for mode (for status bar)
 */
export function getModeDisplayName(mode: AgentMode): string {
  return mode.toUpperCase();
}

/**
 * Toggle between modes
 */
export function toggleMode(current: AgentMode): AgentMode {
  return current === 'plan' ? 'build' : 'plan';
}

/**
 * Default mode when starting a new session
 */
export const DEFAULT_MODE: AgentMode = 'build';

/**
 * Agent modes - Plan and Build
 *
 * Plan mode: Read-only research and planning
 * Build mode: Full execution power
 */

export type AgentMode = "plan" | "build";

/**
 * Tools available in each mode
 * Plan mode: read-only tools + todo tracking
 * Build mode: all tools + todo tracking
 */
export const MODE_TOOLS: Record<AgentMode, readonly string[]> = {
  plan: ["read_file", "list_dir", "glob", "grep", "todo_write", "todo_read"] as const,
  build: [
    "read_file",
    "list_dir",
    "glob",
    "grep",
    "write_file",
    "edit_file",
    "run_command",
    "todo_write",
    "todo_read",
  ] as const,
};

/**
 * Check if a tool is available in a given mode
 */
export function isToolAvailable(mode: AgentMode, toolName: string): boolean {
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
  return current === "plan" ? "build" : "plan";
}

/**
 * Default mode when starting a new session
 */
export const DEFAULT_MODE: AgentMode = "build";

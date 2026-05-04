/**
 * Agent modes — backward-compatible type and TUI helpers.
 *
 * `AgentMode` ('plan' | 'build') is kept as a thin compatibility layer
 * for the TUI and session system. Internally, modes map to built-in agent
 * names in the agent registry. Tool filtering is now handled by the
 * permission system, not the hardcoded MODE_TOOLS lists.
 *
 * @see src/agent/agents/builtins.ts — built-in agent definitions
 * @see src/agent/permission/index.ts — permission evaluation engine
 */

/**
 * Agent mode type — maps directly to built-in agent names.
 * Kept for TUI, session types, and safety layer backward compatibility.
 */
export type AgentMode = 'plan' | 'build';

/**
 * Get display name for mode (for status bar).
 */
export function getModeDisplayName(mode: AgentMode): string {
  return mode.toUpperCase();
}

/**
 * Toggle between modes.
 */
export function toggleMode(current: AgentMode): AgentMode {
  return current === 'plan' ? 'build' : 'plan';
}

/**
 * Default mode when starting a new session.
 */
export const DEFAULT_MODE: AgentMode = 'build';

/**
 * System reminders - injected at runtime to reinforce mode constraints.
 * Based on OpenCode's <system-reminder> pattern.
 */

import type { AgentMode } from "../modes";

/**
 * Plan mode reminder - reinforces read-only constraints
 */
export const PLAN_MODE_REMINDER = `<system-reminder>
PLAN MODE ACTIVE - READ-ONLY

You are in planning/research mode. Your role is to explore, analyze, and plan.

FORBIDDEN:
- File modifications (write_file, edit_file)
- Destructive commands (rm, mv, etc.)
- System changes

ALLOWED:
- read_file, list_dir, glob, grep
- Analysis and exploration
- Creating plans and recommendations

Focus on understanding the codebase and providing actionable plans.
Ask clarifying questions when requirements are unclear.
</system-reminder>`;

/**
 * Build mode reminder - confirms write access
 */
export const BUILD_MODE_REMINDER = `<system-reminder>
BUILD MODE ACTIVE

You are now in implementation mode with full access.

You may:
- Edit and create files
- Run shell commands
- Implement changes

Remember:
- Read files before editing (you need exact text to replace)
- Make minimal, focused changes
- Verify changes work as expected
</system-reminder>`;

/**
 * Mode switch reminder - when transitioning from plan to build
 */
export const MODE_SWITCH_REMINDER = `<system-reminder>
MODE CHANGED: plan -> build

Your operational mode has changed from planning to building.
You are no longer in read-only mode.
You are permitted to make file changes, run shell commands, and implement the plan.

Proceed with implementation.
</system-reminder>`;

/**
 * Get the appropriate reminder for a mode
 */
export function getModeReminder(mode: AgentMode): string {
  return mode === "plan" ? PLAN_MODE_REMINDER : BUILD_MODE_REMINDER;
}

/**
 * Get reminder for mode transition
 */
export function getModeSwitchReminder(fromMode: AgentMode, toMode: AgentMode): string | null {
  if (fromMode === "plan" && toMode === "build") {
    return MODE_SWITCH_REMINDER;
  }
  if (fromMode === "build" && toMode === "plan") {
    return PLAN_MODE_REMINDER;
  }
  return null;
}

/**
 * System prompts for Olly.
 *
 * Each mode has its own focused prompt:
 * - Plan mode: Research and planning (read-only)
 * - Build mode: Implementation (full power)
 */

import type { AgentMode } from '../modes';
import { type SystemPromptContext, getDefaultContext } from './shared';
import { buildPlanModePrompt } from './plan';
import { buildBuildModePrompt } from './build';

export { type SystemPromptContext, getDefaultContext } from './shared';
export { buildExplorePrompt, type ThoroughnessLevel } from './explore';
export {
  getModeReminder,
  getModeSwitchReminder,
  PLAN_MODE_REMINDER,
  BUILD_MODE_REMINDER,
  MODE_SWITCH_REMINDER,
} from './reminders';

/**
 * Get the system prompt for a given mode
 */
export function getSystemPromptForMode(
  mode: AgentMode,
  ctx: SystemPromptContext = getDefaultContext(),
): string {
  switch (mode) {
    case 'plan':
      return buildPlanModePrompt(ctx);
    case 'build':
      return buildBuildModePrompt(ctx);
  }
}

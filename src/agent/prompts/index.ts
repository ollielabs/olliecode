/**
 * System prompts for Ollie.
 *
 * Supports both agent-based and mode-based (backward compat) prompt resolution:
 * - Agent-based: built-in agents resolve to their prompt builders; user-defined
 *   agents use their `systemPrompt` field.
 * - Mode-based: `getSystemPromptForMode()` maps mode → built-in agent → prompt.
 */

import type { ResolvedAgent } from '../agents/schema';
import type { AgentMode } from '../modes';
import { buildBuildModePrompt } from './build';
import { buildPlanModePrompt } from './plan';
import { type SystemPromptContext, getDefaultContext } from './shared';

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
 * Get the system prompt for a resolved agent.
 *
 * Built-in agents (build, plan, explore) have empty systemPrompt fields —
 * they resolve to their dedicated prompt builders which inject dynamic context.
 * User-defined agents use their systemPrompt field directly.
 *
 * @param agent - The resolved agent definition
 * @param ctx - System prompt context (environment, project instructions, etc.)
 * @returns The system prompt string
 */
export function getSystemPromptForAgent(
  agent: ResolvedAgent,
  ctx: SystemPromptContext = getDefaultContext(),
): string {
  // Built-in agents with dedicated prompt builders
  if (agent.source.type === 'builtin') {
    switch (agent.name) {
      case 'build':
        return buildBuildModePrompt(ctx);
      case 'plan':
        return buildPlanModePrompt(ctx);
      case 'explore':
        // Explore prompt is built separately via buildExplorePrompt()
        // with thoroughness parameter — handled by the task tool caller.
        // Return empty here; the task tool provides the prompt override.
        return '';
    }
  }

  // User-defined agents: use their systemPrompt field.
  // If empty, they get a minimal identity prompt.
  if (agent.systemPrompt) {
    return agent.systemPrompt;
  }

  return `You are "${agent.name}": ${agent.description}`;
}

/**
 * Get the system prompt for a given mode.
 *
 * Backward-compatible wrapper. Prefer `getSystemPromptForAgent()` for new code.
 *
 * @deprecated Use getSystemPromptForAgent() instead.
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

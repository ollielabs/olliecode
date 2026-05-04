/**
 * Built-in agent definitions.
 *
 * Expresses the existing `build`, `plan`, and `explore` modes as agent
 * definitions in the unified agent model. These are registered first in the
 * merging pipeline — user-defined agents (global/project/config) can override
 * or extend them.
 *
 * System prompts are NOT inlined here — they stay in their existing prompt
 * builder functions. The `systemPrompt` field is left empty; the prompt
 * system resolves it at runtime via the prompt builders (Story 4 will wire
 * this up). This avoids duplicating the prompt content and keeps the
 * prompt-builder context injection working.
 */

import type { PermissionConfig } from '../permission/types';
import type { ResolvedAgent } from './schema';

// === Permission configs for built-in agents ===

/**
 * Build agent: full access (current default behavior).
 */
const BUILD_PERMISSIONS: PermissionConfig = {
  '*': 'allow',
};

/**
 * Plan agent: read-only — deny edit tools (current plan mode behavior).
 * run_command is allowed but filtered by the safety layer's
 * PLAN_MODE_ALLOWED_COMMANDS whitelist at runtime.
 */
const PLAN_PERMISSIONS: PermissionConfig = {
  edit: 'deny',
};

/**
 * Explore agent: restricted to read-only tools + bash + web_fetch.
 * Matches the current explore subagent tool set from MODE_TOOLS.plan
 * plus web_fetch.
 */
const EXPLORE_PERMISSIONS: PermissionConfig = {
  '*': 'deny',
  read: 'allow',
  glob: 'allow',
  grep: 'allow',
  list: 'allow',
  bash: 'allow',
  web_fetch: 'allow',
  todo: 'allow',
};

// === Built-in agent definitions ===

export const BUILTIN_BUILD_AGENT: ResolvedAgent = {
  name: 'build',
  description: 'Full-power implementation mode with all tools available',
  mode: 'primary',
  disabled: false,
  permission: BUILD_PERMISSIONS,
  systemPrompt: '',
  source: { type: 'builtin' },
};

export const BUILTIN_PLAN_AGENT: ResolvedAgent = {
  name: 'plan',
  description: 'Read-only research and planning mode',
  mode: 'primary',
  disabled: false,
  permission: PLAN_PERMISSIONS,
  systemPrompt: '',
  source: { type: 'builtin' },
};

export const BUILTIN_EXPLORE_AGENT: ResolvedAgent = {
  name: 'explore',
  description: 'Fast codebase search specialist for targeted exploration',
  mode: 'subagent',
  disabled: false,
  maxIterations: 'medium',
  permission: EXPLORE_PERMISSIONS,
  systemPrompt: '',
  source: { type: 'builtin' },
};

/**
 * All built-in agents in registration order.
 * Order matters for display — alphabetical within each mode.
 */
export const BUILTIN_AGENTS: readonly ResolvedAgent[] = [
  BUILTIN_BUILD_AGENT,
  BUILTIN_PLAN_AGENT,
  BUILTIN_EXPLORE_AGENT,
];

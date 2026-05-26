/**
 * Agent definition schema using Zod.
 *
 * Defines the shape of agent configurations as found in:
 * - Markdown frontmatter (`.ollie/agents/*.md`, `~/.config/ollie/agents/*.md`)
 * - JSON config (`ollie.json` → `agents` field)
 */

import { z } from 'zod';

import type { PermissionConfig } from '../permission/types';

// === Permission schema (matches PermissionConfig type) ===

const PermissionActionSchema = z.enum(['allow', 'ask', 'deny']);

const PermissionRuleSchema = z.union([
  PermissionActionSchema,
  z.record(z.string(), PermissionActionSchema),
]);

export const PermissionConfigSchema: z.ZodType<PermissionConfig> = z.record(
  z.string(),
  PermissionRuleSchema,
);

// === Agent name validation ===

/**
 * Agent name format: lowercase alphanumeric with hyphens/underscores.
 * Must start with alphanumeric. No double underscores (prevents ambiguity
 * in qualified tool names like `mcp__server__tool`).
 *
 * Matches the same pattern as McpServerNameSchema in config/schema.ts.
 */
export const AgentNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    'Agent name must start with alphanumeric, contain only lowercase alphanumeric, hyphens, or underscores',
  )
  .refine((s) => !s.includes('__'), {
    message: 'Agent name must not contain "__" (double underscore)',
  });

// === Max iterations ===

const MaxIterationsPresetSchema = z.enum(['quick', 'medium', 'thorough']);

/**
 * Numeric values for iteration presets. Single source of truth — also used
 * by IterationLimitsObjectSchema in config/schema.ts.
 */
export const ITERATION_PRESETS = {
  quick: 8,
  medium: 15,
  thorough: 25,
} as const;

const MaxIterationsSchema = z.union([
  z.number().int().positive(),
  MaxIterationsPresetSchema,
]);

// === Agent mode ===

export const AgentModeSchema = z.enum(['primary', 'subagent', 'all']);

// === Permission key to tool name mapping ===

/**
 * Maps permission keys (as used in agent configs) to actual tool names
 * (as registered in the tool system). Used by Story 4's mode refactor
 * to translate permission evaluations to tool filtering.
 *
 * Unknown keys fall through — future tools work without schema changes.
 */
export const PERMISSION_KEY_TO_TOOLS: Record<string, readonly string[]> = {
  read: ['read_file'],
  edit: ['edit_file', 'write_file'],
  glob: ['glob'],
  grep: ['grep'],
  list: ['list_dir'],
  bash: ['run_command'],
  task: ['task'],
  todo: ['todo_write', 'todo_read'],
  web_fetch: ['web_fetch'],
  web_search: ['web_search'],
  // 'mcp' and '*' are handled specially — not in this map
};

/**
 * Reverse mapping: tool name → permission key.
 * Built from PERMISSION_KEY_TO_TOOLS at module load.
 */
export const TOOL_TO_PERMISSION_KEY: Record<string, string> = {};
for (const [key, tools] of Object.entries(PERMISSION_KEY_TO_TOOLS)) {
  for (const tool of tools) {
    TOOL_TO_PERMISSION_KEY[tool] = key;
  }
}

// === Agent definition schema ===

const AgentInfoObjectSchema = z.object({
  /**
   * Agent name. Optional in markdown (filename is fallback).
   * When present, must match the agent name format.
   */
  name: AgentNameSchema.optional(),
  /** Description shown in task tool dynamic listing. Required. */
  description: z.string(),
  /** Whether this agent can be used as primary, subagent, or both. */
  mode: AgentModeSchema.default('subagent'),
  /** Ollama model override. */
  model: z.string().optional(),
  /** Temperature override. */
  temperature: z.number().min(0).max(2).optional(),
  /** Iteration budget — number or named preset. */
  maxIterations: MaxIterationsSchema.optional(),
  /** Permission ruleset controlling tool access. */
  permission: PermissionConfigSchema.optional(),
  /** If true, this agent is suppressed (project can disable a global agent). */
  disabled: z.boolean().default(false),
});

export const AgentInfoSchema = AgentInfoObjectSchema;

/** Agent definition as parsed from config (all defaults applied). */
export type AgentInfo = z.output<typeof AgentInfoSchema>;

/** Agent definition as written in config files (optional fields). */
export type AgentInfoInput = z.input<typeof AgentInfoSchema>;

// === Resolved agent (fully loaded with source metadata) ===

/**
 * Fully resolved agent with required name, system prompt, and source.
 * Uses Omit to explicitly narrow `name` from optional to required.
 */
export type ResolvedAgent = Omit<AgentInfo, 'name'> & {
  /** Canonical agent name (from frontmatter `name` field or filename fallback). */
  name: string;
  /** System prompt (markdown body for file-based agents, empty for JSON-only). */
  systemPrompt: string;
  /** Where this agent was loaded from. */
  source: AgentSource;
};

export type AgentSource =
  | { type: 'builtin' }
  | { type: 'global'; path: string }
  | { type: 'project'; path: string }
  | { type: 'config' };

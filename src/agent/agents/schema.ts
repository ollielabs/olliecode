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

// === Max iterations ===

const MaxIterationsPresetSchema = z.enum(['quick', 'medium', 'thorough']);

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

// === Agent definition schema ===

const AgentInfoObjectSchema = z.object({
  /** Agent name. Required in JSON config; optional in markdown (filename fallback). */
  name: z.string().optional(),
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

export type ResolvedAgent = AgentInfo & {
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

/**
 * Config schema definitions using Zod.
 *
 * This is the single source of truth for:
 * - Config structure and types
 * - Default values
 * - Validation rules
 */

import { z } from 'zod';

// === Shared enums ===

export const AutonomyLevelSchema = z.enum([
  'paranoid',
  'cautious',
  'balanced',
  'autonomous',
]);

export const PermissionValueSchema = z.enum(['allow', 'ask', 'deny']);

// === Section schemas ===

const AgentObjectSchema = z.object({
  maxIterations: z.number().int().min(1).max(200).default(50),
  loopDetection: z.boolean().default(true),
  loopThreshold: z.number().int().min(1).max(20).default(3),
  defaultMode: z.enum(['plan', 'build']).default('build'),
});

export const AgentSchema = AgentObjectSchema.default(() =>
  AgentObjectSchema.parse({}),
);

const CompactionObjectSchema = z.object({
  auto: z.boolean().default(true),
  threshold: z.number().int().min(50).max(100).default(80),
  temperature: z.number().min(0).max(2).default(0.3),
});

export const CompactionSchema = CompactionObjectSchema.default(() =>
  CompactionObjectSchema.parse({}),
);

export const PermissionsSchema = z
  .record(z.string(), PermissionValueSchema)
  .default({});

const SafetyObjectSchema = z.object({
  maxFileSizeBytes: z.number().int().min(1024).default(102400),
  maxToolCallsPerTurn: z.number().int().min(1).default(20),
  maxToolCallsPerSession: z.number().int().min(1).default(100),
  allowNetworkCommands: z.boolean().default(false),
  deniedPaths: z
    .array(z.string())
    .default([
      '.env',
      '.env.*',
      '*.pem',
      '*.key',
      'id_rsa*',
      'id_ed25519*',
      '*.p12',
      '*.pfx',
      'credentials.*',
      'secrets.*',
      '.git/config',
    ]),
  deniedCommands: z
    .array(z.string())
    .default([
      'rm -rf /',
      'rm -rf /*',
      'sudo',
      'chmod 777',
      '> /dev/',
      '>/dev/',
      'mkfs',
      'dd if=',
      ':(){:|:&};:',
      ':(){ :|:& };:',
      'mv /*',
      'cat /etc/passwd',
      'cat /etc/shadow',
    ]),
  auditLog: z.boolean().default(true),
  auditLogPath: z.string().default('.ollie/audit.jsonl'),
});

export const SafetySchema = SafetyObjectSchema.default(() =>
  SafetyObjectSchema.parse({}),
);

const ReadFileToolObjectSchema = z.object({
  defaultLimit: z.number().int().min(1).default(2000),
  maxLineLength: z.number().int().min(100).default(2000),
});

const RunCommandToolObjectSchema = z.object({
  timeout: z.number().int().min(1000).max(300000).default(30000),
  maxOutputSize: z.number().int().min(100).max(1000000).default(10000),
});

const IterationLimitsObjectSchema = z.object({
  quick: z.number().int().min(1).default(8),
  medium: z.number().int().min(1).default(15),
  thorough: z.number().int().min(1).default(25),
});

const TaskToolObjectSchema = z.object({
  iterationLimits: IterationLimitsObjectSchema.default(() =>
    IterationLimitsObjectSchema.parse({}),
  ),
});

const WebFetchToolObjectSchema = z.object({
  timeout: z.number().int().min(1000).max(120000).default(30000),
  maxResponseSize: z
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  maxOutputChars: z.number().int().min(1000).max(500_000).default(50_000),
});

const ToolsObjectSchema = z.object({
  read_file: ReadFileToolObjectSchema.default(() =>
    ReadFileToolObjectSchema.parse({}),
  ),
  run_command: RunCommandToolObjectSchema.default(() =>
    RunCommandToolObjectSchema.parse({}),
  ),
  task: TaskToolObjectSchema.default(() => TaskToolObjectSchema.parse({})),
  web_fetch: WebFetchToolObjectSchema.default(() =>
    WebFetchToolObjectSchema.parse({}),
  ),
});

export const ToolsSchema = ToolsObjectSchema.default(() =>
  ToolsObjectSchema.parse({}),
);

const TuiObjectSchema = z.object({
  theme: z.string().default('auto'),
  toastDuration: z.number().int().min(500).default(2500),
  doubleEscapeThreshold: z.number().int().min(100).default(500),
  sessionListLimit: z.number().int().min(1).default(50),
});

export const TuiSchema = TuiObjectSchema.default(() =>
  TuiObjectSchema.parse({}),
);

// === Memory schema ===

const MemoryObservationObjectSchema = z.object({
  messageTokens: z.number().int().min(1000).default(30000),
  bufferTokens: z
    .union([z.number().min(0).max(1), z.literal(false)])
    .default(0.2),
  bufferActivation: z.number().min(0).max(1).default(0.933),
  blockAfter: z.number().min(1).max(2).default(1.2),
  temperature: z.number().min(0).max(2).default(0.3),
});

const MemoryReflectionObjectSchema = z.object({
  observationTokens: z.number().int().min(1000).default(40000),
  temperature: z.number().min(0).max(2).default(0),
  bufferActivation: z
    .union([z.number().min(0).max(1), z.literal(false)])
    .default(0.5),
  blockAfter: z.number().min(1).max(2).default(1.1),
  reflectionSplit: z.number().min(0.1).max(1).default(0.8),
});

const MemoryObjectSchema = z.object({
  enabled: z.boolean().default(true),
  host: z.string().url().optional(),
  model: z.string().optional(),
  observation: MemoryObservationObjectSchema.default(() =>
    MemoryObservationObjectSchema.parse({}),
  ),
  reflection: MemoryReflectionObjectSchema.default(() =>
    MemoryReflectionObjectSchema.parse({}),
  ),
});

export const MemorySchema = MemoryObjectSchema.default(() =>
  MemoryObjectSchema.parse({}),
);

// === Top-level config schema ===

export const ConfigSchema = z.object({
  model: z.string().default('llama3.2:latest'),
  host: z.string().url().default('http://127.0.0.1:11434'),
  temperature: z.number().min(0).max(2).default(0.2),

  agent: AgentSchema,
  compaction: CompactionSchema,
  memory: MemorySchema,

  autonomy: AutonomyLevelSchema.default('cautious'),
  permissions: PermissionsSchema,
  safety: SafetySchema,

  tools: ToolsSchema,
  tui: TuiSchema,

  instructions: z.array(z.string()).default([]),

  debug: z.boolean().default(false),
});

// === Derived types ===

/** User-facing config (all fields optional, as written in config files) */
export type OllieConfig = z.input<typeof ConfigSchema>;

/** Fully resolved config (all defaults applied, no optionals) */
export type ResolvedConfig = z.output<typeof ConfigSchema>;

/** Autonomy level type */
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

/** Permission value type */
export type PermissionValue = z.infer<typeof PermissionValueSchema>;

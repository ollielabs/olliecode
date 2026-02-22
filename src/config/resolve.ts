/**
 * Config resolution and distribution.
 *
 * Bridges the gap between the merged config and the consumers
 * (agent, safety, tools, TUI). Extracts typed sub-configs from
 * ResolvedConfig for each layer.
 */

import type { CompactionConfig } from '../agent/compaction';
import type { SafetyConfig } from '../agent/safety/types';
import type { AgentConfig, ToolsConfig } from '../agent/types';
import type { PermissionValue, ResolvedConfig } from './schema';

// === TUI config type ===

/** Extracted TUI configuration for components and hooks */
export type TuiConfig = {
  theme: string;
  toastDuration: number;
  doubleEscapeThreshold: number;
  sessionListLimit: number;
};

// === Autonomy → Permission mapping ===

/** Per-tool permission map derived from autonomy level */
export type ToolPermissionMap = Record<string, PermissionValue>;

/**
 * Autonomy level → baseline per-tool permission mapping.
 *
 * This replaces the risk-based shouldConfirm() approach.
 * Each autonomy level defines which tools auto-approve, prompt, or deny.
 */
const AUTONOMY_BASELINES: Record<string, ToolPermissionMap> = {
  paranoid: {
    read_file: 'ask',
    list_dir: 'ask',
    glob: 'ask',
    grep: 'ask',
    write_file: 'ask',
    edit_file: 'ask',
    run_command: 'ask',
    task: 'ask',
    todo_read: 'ask',
    todo_write: 'ask',
  },
  cautious: {
    read_file: 'allow',
    list_dir: 'allow',
    glob: 'allow',
    grep: 'allow',
    write_file: 'ask',
    edit_file: 'ask',
    run_command: 'ask',
    task: 'allow',
    todo_read: 'allow',
    todo_write: 'allow',
  },
  balanced: {
    read_file: 'allow',
    list_dir: 'allow',
    glob: 'allow',
    grep: 'allow',
    write_file: 'allow',
    edit_file: 'ask',
    run_command: 'ask',
    task: 'allow',
    todo_read: 'allow',
    todo_write: 'allow',
  },
  autonomous: {
    read_file: 'allow',
    list_dir: 'allow',
    glob: 'allow',
    grep: 'allow',
    write_file: 'allow',
    edit_file: 'allow',
    run_command: 'allow',
    task: 'allow',
    todo_read: 'allow',
    todo_write: 'allow',
  },
};

/**
 * Resolve the effective per-tool permission map.
 *
 * Starts from the autonomy level baseline, then applies
 * any explicit permission overrides from config.
 */
export function resolvePermissions(config: ResolvedConfig): ToolPermissionMap {
  const baseline =
    AUTONOMY_BASELINES[config.autonomy] ?? AUTONOMY_BASELINES.cautious;
  const resolved = { ...baseline };

  // Apply explicit overrides
  for (const [tool, permission] of Object.entries(config.permissions)) {
    resolved[tool] = permission;
  }

  return resolved;
}

// === Sub-config extractors ===

/**
 * Extract AgentConfig from resolved config.
 */
export function extractAgentConfig(config: ResolvedConfig): AgentConfig {
  return {
    maxIterations: config.agent.maxIterations,
    loopDetection: config.agent.loopDetection,
    loopThreshold: config.agent.loopThreshold,
    autoCompaction: config.compaction.auto,
    compactionThreshold: config.compaction.threshold,
  };
}

/**
 * Extract CompactionConfig from resolved config.
 */
export function extractCompactionConfig(
  config: ResolvedConfig,
): CompactionConfig {
  return {
    threshold: config.compaction.threshold,
    temperature: config.compaction.temperature,
  };
}

/**
 * Extract SafetyConfig from resolved config.
 *
 * Resolves autonomy level + permission overrides into a per-tool
 * permission map using the unified allow/ask/deny vocabulary.
 */
export function extractSafetyConfig(
  config: ResolvedConfig,
  projectRoot: string,
): SafetyConfig {
  const toolPermissions = resolvePermissions(config);

  return {
    projectRoot,
    autonomyLevel: config.autonomy,
    maxFileSizeBytes: config.safety.maxFileSizeBytes,
    maxToolCallsPerTurn: config.safety.maxToolCallsPerTurn,
    maxToolCallsPerSession: config.safety.maxToolCallsPerSession,
    allowNetworkCommands: config.safety.allowNetworkCommands,
    deniedPaths: config.safety.deniedPaths,
    deniedCommands: config.safety.deniedCommands,
    enableAuditLog: config.safety.auditLog,
    auditLogPath: config.safety.auditLogPath,
    toolPermissions,
  };
}

/**
 * Extract ToolsConfig from resolved config.
 */
export function extractToolsConfig(config: ResolvedConfig): ToolsConfig {
  return {
    read_file: {
      defaultLimit: config.tools.read_file.defaultLimit,
      maxLineLength: config.tools.read_file.maxLineLength,
    },
    run_command: {
      timeout: config.tools.run_command.timeout,
      maxOutputSize: config.tools.run_command.maxOutputSize,
    },
    task: {
      iterationLimits: {
        quick: config.tools.task.iterationLimits.quick,
        medium: config.tools.task.iterationLimits.medium,
        thorough: config.tools.task.iterationLimits.thorough,
      },
    },
  };
}

/**
 * Extract TuiConfig from resolved config.
 */
export function extractTuiConfig(config: ResolvedConfig): TuiConfig {
  return {
    theme: config.tui.theme,
    toastDuration: config.tui.toastDuration,
    doubleEscapeThreshold: config.tui.doubleEscapeThreshold,
    sessionListLimit: config.tui.sessionListLimit,
  };
}

/**
 * Derive a modified config for subagents (task tool).
 *
 * Subagents may need different iteration limits, temperature, etc.
 * This creates a new ResolvedConfig with the overrides applied.
 */
export function deriveSubagentConfig(
  baseConfig: ResolvedConfig,
  overrides: {
    maxIterations?: number;
    systemPromptOverride?: string;
  },
): ResolvedConfig {
  return {
    ...baseConfig,
    agent: {
      ...baseConfig.agent,
      maxIterations: overrides.maxIterations ?? baseConfig.agent.maxIterations,
    },
  };
}

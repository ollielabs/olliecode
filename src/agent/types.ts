import type { Message, ToolCall } from 'ollama';
import type { z } from 'zod';

import type { SafetyConfig } from './safety/types';

// Re-export safety types for convenience
export type {
  ConfirmationRequest,
  ConfirmationResponse,
  SafetyConfig,
} from './safety/types';

/**
 * Tool-specific configuration extracted from ResolvedConfig.tools.
 * Each tool reads its settings from here with fallback to hardcoded defaults.
 */
export type ToolsConfig = {
  read_file: { defaultLimit: number; maxLineLength: number };
  run_command: { timeout: number; maxOutputSize: number };
  task: {
    iterationLimits: { quick: number; medium: number; thorough: number };
  };
};

/**
 * Risk level for a tool
 * - safe: No confirmation needed, can run in parallel
 * - low: Minor risk, no confirmation usually
 * - medium: May modify files, confirmation recommended
 * - high: Destructive or dangerous, always confirm
 * - prompt: Always prompt user for confirmation before execution
 */
export type ToolRisk = 'safe' | 'low' | 'medium' | 'high' | 'prompt';

/**
 * Context passed to tools at execution time.
 * Contains session info and other runtime context not provided by the LLM.
 */
export type ToolContext = {
  sessionId?: string;
  projectRoot?: string;
  /** Model name for subagent delegation */
  model?: string;
  /** Host URL for subagent delegation */
  host?: string;
  /** Safety config for subagent delegation */
  safetyConfig?: SafetyConfig;
  /** Tool-specific configuration from config file */
  toolsConfig?: ToolsConfig;
  /** Instruction file paths from config (for subagent delegation) */
  configInstructions?: string[];
};

/**
 * Tool definition with typed parameters and output
 */
export type ToolDefinition<
  TParams extends z.ZodType,
  TOutput extends z.ZodType,
> = {
  name: string;
  description: string;
  parameters: TParams;
  outputSchema: TOutput;
  risk: ToolRisk;
  execute: (
    params: z.infer<TParams>,
    signal?: AbortSignal,
    context?: ToolContext,
  ) => Promise<z.infer<TOutput>>;
};

/**
 * Result from executing a tool
 */
export type ToolResult = {
  tool: string;
  output: string;
  error?: string;
};

/**
 * A single step in the agent's reasoning
 */
export type AgentStep = {
  thought: string;
  actions: ToolCall[];
  observations: ToolResult[];
  durationMs: number;
};

/**
 * Context usage statistics for the agent run.
 *
 * When `promptTokens` is present, `totalTokens` and `usagePercent` are
 * computed from real model tokenizer counts. Otherwise they fall back to
 * the character-based heuristic.
 */
export type ContextUsage = {
  /** Total tokens used (real if promptTokens available, else estimated) */
  totalTokens: number;
  /** Maximum context window for the model */
  maxTokens: number;
  /** Usage as percentage (0-100) */
  usagePercent: number;
  /** Whether context exceeded 80% threshold */
  exceededThreshold: boolean;
  /** Actual prompt tokens from model (undefined if not yet available) */
  promptTokens?: number;
  /** Actual completion tokens from model (undefined if not yet available) */
  completionTokens?: number;
};

/**
 * Successful agent result
 */
export type AgentResult = {
  steps: AgentStep[];
  finalAnswer: string;
  messages: Message[];
  stats: {
    totalIterations: number;
    totalToolCalls: number;
    totalDurationMs: number;
  };
  /** Context usage statistics (if available) */
  contextUsage?: ContextUsage;
  /** Whether the caller should run summarization after settling */
  needsSummarization?: boolean;
};

/**
 * Error types for agent failures
 */
export type AgentError =
  | {
      type: 'aborted';
      messages: Message[];
      contextUsage?: ContextUsage;
    }
  | {
      type: 'model_error';
      message: string;
      messages: Message[];
      contextUsage?: ContextUsage;
      /** If true, the error was "prompt too long" — caller should summarize and retry */
      promptTooLong?: boolean;
    }
  | {
      type: 'loop_detected';
      action: string;
      attempts: number;
      messages: Message[];
      contextUsage?: ContextUsage;
    }
  | {
      type: 'max_iterations';
      iterations: number;
      lastThought: string;
      messages: Message[];
      contextUsage?: ContextUsage;
    }
  | {
      type: 'tool_error';
      tool: string;
      message: string;
      messages: Message[];
      contextUsage?: ContextUsage;
    };

/**
 * Configuration for the agent
 */
export type AgentConfig = {
  maxIterations: number;
  loopDetection: boolean;
  loopThreshold: number;
  /** Enable auto-compaction when context usage exceeds threshold */
  autoCompaction: boolean;
  /** Context usage threshold (0-100) to trigger compaction, default 80 */
  compactionThreshold: number;
};

/**
 * Default agent configuration
 *
 * maxIterations set to 50 — high enough for complex multi-file tasks
 * (read, edit, test, fix cycles), low enough to catch true runaways.
 * A soft warning is injected at 80% of the limit to nudge the model
 * to wrap up before the hard stop.
 *
 * loopThreshold of 3 means 3 truly consecutive identical calls trigger detection.
 * The smarter loop detection allows interleaved patterns like read→edit→read.
 *
 * autoCompaction enabled by default at 80% context usage threshold.
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxIterations: 50,
  loopDetection: true,
  loopThreshold: 3,
  autoCompaction: true,
  compactionThreshold: 80,
};

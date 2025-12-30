// Phase 4 test
import type { z } from "zod";
import type { ToolCall, Message } from "ollama";
import path from "path";

// Re-export safety types for convenience
export type { ConfirmationRequest, ConfirmationResponse } from "./safety/types";

/**
 * Risk level for a tool
 * - safe: No confirmation needed, can run in parallel
 * - low: Minor risk, no confirmation usually
 * - medium: May modify files, confirmation recommended
 * - high: Destructive or dangerous, always confirm
 * - prompt: Always prompt user for confirmation before execution
 */
export type ToolRisk = "safe" | "low" | "medium" | "high" | "prompt";

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
    context?: ToolContext
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
};

/**
 * Error types for agent failures
 */
export type AgentError =
  | { type: "aborted" }
  | { type: "model_error"; message: string }
  | { type: "loop_detected"; action: string; attempts: number }
  | { type: "max_iterations"; iterations: number; lastThought: string }
  | { type: "tool_error"; tool: string; message: string };

/**
 * Configuration for the agent
 */
export type AgentConfig = {
  maxIterations: number;
  loopDetection: boolean;
  loopThreshold: number;
};

/**
 * Default agent configuration
 * 
 * maxIterations set to 15 to support complex exploration tasks.
 * Complex codebase analysis may need 15-20 iterations to systematically
 * explore structure, read key files, and synthesize findings.
 * 
 * loopThreshold of 3 means 3 truly consecutive identical calls trigger detection.
 * The smarter loop detection allows interleaved patterns like read→edit→read.
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxIterations: 15,
  loopDetection: true,
  loopThreshold: 3,
};

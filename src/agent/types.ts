import type { z } from "zod";
import type { ToolCall, Message } from "ollama";

// Re-export safety types for convenience
export type { ConfirmationRequest, ConfirmationResponse } from "./safety/types";

/**
 * Risk level for a tool
 */
export type ToolRisk = "safe" | "low" | "medium" | "high";

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
    signal?: AbortSignal
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
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxIterations: 20,
  loopDetection: true,
  loopThreshold: 3,
};

/**
 * Tool execution processor.
 * Handles mode availability, safety checks, execution, and result formatting.
 * 
 * Supports parallel execution for safe tools (risk: "safe") using Promise.allSettled,
 * while unsafe tools run sequentially to support confirmation flows.
 */

import type { Message, ToolCall } from "ollama";
import type { AgentMode } from "./modes";
import { isToolAvailable } from "./modes";
import { executeTool, isToolSafeForParallel } from "./tools";
import type { ToolResult, ToolContext } from "./types";
import { SafetyLayer, type ConfirmationRequest, type ConfirmationResponse } from "./safety";
import { log } from "./logger";

/**
 * Prefix for tool results to remind model that user can't see tool output.
 */
export const TOOL_RESULT_PREFIX = 
  "[TOOL RESULT - USER CANNOT SEE THIS. You must include the relevant content in your response.]";

/**
 * Callbacks for tool processing events.
 */
export type ToolProcessorCallbacks = {
  onToolResult: (result: ToolResult, index: number) => void;
  onToolBlocked?: (tool: string, reason: string) => void;
  onConfirmationNeeded?: (request: ConfirmationRequest) => Promise<ConfirmationResponse>;
};

/**
 * Options for tool processing.
 */
export type ToolProcessorOptions = {
  context?: ToolContext;
  /** Maximum number of retries for failed parallel tools (default: 0 = no retry) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 100) */
  retryDelayMs?: number;
};

/**
 * Result of processing a single tool call.
 */
export type ProcessedToolCall = {
  result: ToolResult;
  message: Message;
  executed: boolean;
  durationMs?: number;
  index: number; // Original index for ordering
};

/**
 * Result of processing all tool calls in a step.
 */
export type ToolProcessingResult = {
  observations: ToolResult[];
  messages: Message[];
  executedCount: number;
  totalDurationMs: number;
  /** Number of tools that ran in parallel */
  parallelCount: number;
  /** Number of tools that ran sequentially */
  sequentialCount: number;
  /** Number of tools that failed (for partial failure handling) */
  failedCount: number;
  /** Number of retry attempts made */
  retryAttempts: number;
  /** Number of tools recovered after retry */
  recoveredCount: number;
};

/**
 * Processes a tool call that is not available in the current mode.
 */
function handleModeBlocked(
  toolName: string,
  mode: AgentMode,
  callbacks: ToolProcessorCallbacks,
  index: number
): ProcessedToolCall {
  log(`Tool not available in ${mode} mode: ${toolName}`);
  callbacks.onToolBlocked?.(toolName, `Not available in ${mode} mode`);

  const result: ToolResult = {
    tool: toolName,
    output: "",
    error: `BLOCKED: Tool "${toolName}" is not available in ${mode} mode`,
  };
  callbacks.onToolResult(result, index);

  const message: Message = {
    role: "tool",
    content: `[TOOL NOT AVAILABLE] The ${toolName} tool is not available in ${mode} mode. Only read-only tools are available in plan mode.`,
  };

  return { result, message, executed: false, index };
}

/**
 * Processes a tool call that was denied by the safety layer.
 */
async function handleSafetyDenied(
  toolName: string,
  toolArgs: Record<string, unknown>,
  reason: string,
  safetyLayer: SafetyLayer,
  callbacks: ToolProcessorCallbacks,
  index: number
): Promise<ProcessedToolCall> {
  log(`Tool blocked: ${reason}`);
  callbacks.onToolBlocked?.(toolName, reason);
  await safetyLayer.recordDenied(toolName, toolArgs, reason);

  const result: ToolResult = {
    tool: toolName,
    output: "",
    error: `BLOCKED: ${reason}`,
  };
  callbacks.onToolResult(result, index);

  const message: Message = {
    role: "tool",
    content: `[TOOL FAILED - OPERATION NOT PERFORMED] The ${toolName} operation was BLOCKED and did NOT execute. Reason: ${reason}. You must inform the user that this operation was not allowed.`,
  };

  return { result, message, executed: false, index };
}

/**
 * Processes a tool call that was denied by the user during confirmation.
 */
async function handleUserDenied(
  toolName: string,
  toolArgs: Record<string, unknown>,
  safetyLayer: SafetyLayer,
  callbacks: ToolProcessorCallbacks,
  index: number
): Promise<ProcessedToolCall> {
  log("User denied tool execution");
  await safetyLayer.recordRejected(toolName, toolArgs);

  const result: ToolResult = {
    tool: toolName,
    output: "",
    error: "User denied execution",
  };
  callbacks.onToolResult(result, index);

  const message: Message = {
    role: "tool",
    content: `Error: ${result.error}`,
  };

  return { result, message, executed: false, index };
}

/**
 * Processes a tool call that requires confirmation but has no handler.
 */
async function handleNoConfirmationHandler(
  toolName: string,
  toolArgs: Record<string, unknown>,
  safetyLayer: SafetyLayer,
  callbacks: ToolProcessorCallbacks,
  index: number
): Promise<ProcessedToolCall> {
  log("No confirmation handler, denying");
  await safetyLayer.recordDenied(toolName, toolArgs, "No confirmation handler");

  const result: ToolResult = {
    tool: toolName,
    output: "",
    error: "Tool requires confirmation but no confirmation handler provided",
  };
  callbacks.onToolResult(result, index);

  const message: Message = {
    role: "tool",
    content: `Error: ${result.error}`,
  };

  return { result, message, executed: false, index };
}

/**
 * Executes a tool and returns the result.
 */
async function executeToolCall(
  toolName: string,
  toolArgs: Record<string, unknown>,
  safetyLayer: SafetyLayer,
  needsConfirmation: boolean,
  callbacks: ToolProcessorCallbacks,
  index: number,
  signal: AbortSignal,
  context?: ToolContext
): Promise<ProcessedToolCall> {
  log(`Executing tool: ${toolName}`, toolArgs);
  const toolStartTime = Date.now();

  const result = await executeTool(toolName, toolArgs, signal, context);
  const durationMs = Date.now() - toolStartTime;

  log(`Tool result:`, result.error ? `Error: ${result.error}` : `${result.output.length} chars`);

  // Record execution
  await safetyLayer.recordExecution(
    toolName,
    toolArgs,
    result,
    needsConfirmation,
    durationMs
  );

  callbacks.onToolResult(result, index);

  // Format tool content
  const content = result.error
    ? `Error: ${result.error}`
    : `${TOOL_RESULT_PREFIX}\n\n${result.output}`;

  const message: Message = {
    role: "tool",
    content,
  };

  return { result, message, executed: true, durationMs, index };
}

/**
 * Categorize tool calls into safe (parallel) and unsafe (sequential).
 */
type CategorizedToolCalls = {
  safe: Array<{ index: number; call: ToolCall }>;
  unsafe: Array<{ index: number; call: ToolCall }>;
};

function categorizeToolCalls(toolCalls: ToolCall[]): CategorizedToolCalls {
  const safe: CategorizedToolCalls["safe"] = [];
  const unsafe: CategorizedToolCalls["unsafe"] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    if (!call) continue;

    const toolName = call.function.name;
    if (isToolSafeForParallel(toolName)) {
      safe.push({ index: i, call });
    } else {
      unsafe.push({ index: i, call });
    }
  }

  return { safe, unsafe };
}

/**
 * Process a single tool call (used for both parallel and sequential execution).
 */
async function processSingleToolCall(
  toolCall: ToolCall,
  index: number,
  mode: AgentMode,
  safetyLayer: SafetyLayer,
  callbacks: ToolProcessorCallbacks,
  signal: AbortSignal,
  context?: ToolContext
): Promise<ProcessedToolCall> {
  const toolName = toolCall.function.name;
  const toolArgs = toolCall.function.arguments as Record<string, unknown>;

  // Step 1: Mode enforcement
  if (!isToolAvailable(mode, toolName)) {
    return handleModeBlocked(toolName, mode, callbacks, index);
  }

  log(`Checking safety for: ${toolName}`, toolArgs);

  // Step 2: Safety check
  const safetyCheck = await safetyLayer.checkToolCall(toolCall, mode);

  if (safetyCheck.status === "denied") {
    return handleSafetyDenied(
      toolName,
      toolArgs,
      safetyCheck.reason,
      safetyLayer,
      callbacks,
      index
    );
  }

  // Step 3: Handle confirmation if needed
  let needsConfirmation = false;
  if (safetyCheck.status === "needs_confirmation") {
    log(`Tool needs confirmation: ${toolName}`);
    needsConfirmation = true;

    if (!callbacks.onConfirmationNeeded) {
      return handleNoConfirmationHandler(
        toolName,
        toolArgs,
        safetyLayer,
        callbacks,
        index
      );
    }

    // Request confirmation from user
    const response = await callbacks.onConfirmationNeeded(safetyCheck.request);
    safetyLayer.handleConfirmationResponse(response);

    if (response.action === "deny" || response.action === "deny_always") {
      return handleUserDenied(
        toolName,
        toolArgs,
        safetyLayer,
        callbacks,
        index
      );
    }
  }

  // Step 4: Execute the tool
  return executeToolCall(
    toolName,
    toolArgs,
    safetyLayer,
    needsConfirmation,
    callbacks,
    index,
    signal,
    context
  );
}

/**
 * Handle a rejected promise from Promise.allSettled.
 */
function handleParallelFailure(
  toolCall: ToolCall,
  index: number,
  error: unknown,
  callbacks: ToolProcessorCallbacks
): ProcessedToolCall {
  const toolName = toolCall.function.name;
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  log(`Parallel tool execution failed: ${toolName}`, errorMessage);

  const result: ToolResult = {
    tool: toolName,
    output: "",
    error: `Execution failed: ${errorMessage}`,
  };
  callbacks.onToolResult(result, index);

  const message: Message = {
    role: "tool",
    content: `Error: ${result.error}`,
  };

  return { result, message, executed: false, index };
}

/**
 * Processes all tool calls from a model response.
 * 
 * Uses parallel execution for safe tools (risk: "safe") via Promise.allSettled,
 * while unsafe tools run sequentially to support confirmation flows.
 * 
 * Handles:
 * - Mode availability checking
 * - Safety layer checks (blocked, needs confirmation)
 * - User confirmation flow
 * - Parallel execution for safe tools
 * - Sequential execution for unsafe tools
 * - Result formatting with original ordering preserved
 * 
 * @param toolCalls - Array of tool calls from model response
 * @param mode - Current agent mode (plan or build)
 * @param safetyLayer - Safety layer instance
 * @param callbacks - Event callbacks
 * @param signal - Abort signal
 * @param options - Additional options including context
 * @returns Processing results with observations and messages
 */
export async function processToolCalls(
  toolCalls: ToolCall[],
  mode: AgentMode,
  safetyLayer: SafetyLayer,
  callbacks: ToolProcessorCallbacks,
  signal: AbortSignal,
  options?: ToolProcessorOptions
): Promise<ToolProcessingResult> {
  log("Processing", toolCalls.length, "tool calls");

  // Categorize tools for parallel vs sequential execution
  const { safe, unsafe } = categorizeToolCalls(toolCalls);
  
  log(`Parallel tools: ${safe.length}, Sequential tools: ${unsafe.length}`);

  const allResults: ProcessedToolCall[] = [];

  // Process safe tools in parallel using Promise.allSettled
  if (safe.length > 0) {
    log(`Executing ${safe.length} safe tools in parallel`);
    
    const parallelPromises = safe.map(({ index, call }) =>
      processSingleToolCall(
        call,
        index,
        mode,
        safetyLayer,
        callbacks,
        signal,
        options?.context
      )
    );

    const settledResults = await Promise.allSettled(parallelPromises);

    // Process settled results
    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      const safeItem = safe[i];
      
      if (!settled || !safeItem) continue;
      
      const { index, call } = safeItem;

      if (settled.status === "fulfilled") {
        allResults.push(settled.value);
      } else {
        // Handle rejected promise
        allResults.push(
          handleParallelFailure(call, index, settled.reason, callbacks)
        );
      }
    }
  }

  // Process unsafe tools sequentially (they may need confirmation)
  if (unsafe.length > 0) {
    log(`Executing ${unsafe.length} unsafe tools sequentially`);
    
    for (const { index, call } of unsafe) {
      const result = await processSingleToolCall(
        call,
        index,
        mode,
        safetyLayer,
        callbacks,
        signal,
        options?.context
      );
      allResults.push(result);
    }
  }

  // Sort by original index to maintain order
  allResults.sort((a, b) => a.index - b.index);

  // Aggregate results
  const observations: ToolResult[] = [];
  const messages: Message[] = [];
  let executedCount = 0;
  let totalDurationMs = 0;
  let failedCount = 0;

  for (const processed of allResults) {
    observations.push(processed.result);
    messages.push(processed.message);
    
    if (processed.executed) {
      executedCount++;
      totalDurationMs += processed.durationMs ?? 0;
    }
    
    if (processed.result.error) {
      failedCount++;
    }
  }

  return {
    observations,
    messages,
    executedCount,
    totalDurationMs,
    parallelCount: safe.length,
    sequentialCount: unsafe.length,
    failedCount,
    retryAttempts: 0, // TODO: Implement retry logic
    recoveredCount: 0,
  };
}

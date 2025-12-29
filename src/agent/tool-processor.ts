/**
 * Tool execution processor.
 * Handles mode availability, safety checks, execution, and result formatting.
 */

import type { Message, ToolCall } from "ollama";
import type { AgentMode } from "./modes";
import { isToolAvailable } from "./modes";
import { executeTool } from "./tools";
import type { ToolResult } from "./types";
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
 * Result of processing a single tool call.
 */
export type ProcessedToolCall = {
  result: ToolResult;
  message: Message;
  executed: boolean;
  durationMs?: number;
};

/**
 * Result of processing all tool calls in a step.
 */
export type ToolProcessingResult = {
  observations: ToolResult[];
  messages: Message[];
  executedCount: number;
  totalDurationMs: number;
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

  return { result, message, executed: false };
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

  return { result, message, executed: false };
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

  return { result, message, executed: false };
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

  return { result, message, executed: false };
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
  signal: AbortSignal
): Promise<ProcessedToolCall> {
  log(`Executing tool: ${toolName}`, toolArgs);
  const toolStartTime = Date.now();

  const result = await executeTool(toolName, toolArgs, signal);
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

  return { result, message, executed: true, durationMs };
}

/**
 * Processes all tool calls from a model response.
 * 
 * Handles:
 * - Mode availability checking
 * - Safety layer checks (blocked, needs confirmation)
 * - User confirmation flow
 * - Tool execution
 * - Result formatting
 * 
 * @param toolCalls - Array of tool calls from model response
 * @param mode - Current agent mode (plan or build)
 * @param safetyLayer - Safety layer instance
 * @param callbacks - Event callbacks
 * @param signal - Abort signal
 * @returns Processing results with observations and messages
 */
export async function processToolCalls(
  toolCalls: ToolCall[],
  mode: AgentMode,
  safetyLayer: SafetyLayer,
  callbacks: ToolProcessorCallbacks,
  signal: AbortSignal
): Promise<ToolProcessingResult> {
  log("Processing", toolCalls.length, "tool calls");

  const observations: ToolResult[] = [];
  const messages: Message[] = [];
  let executedCount = 0;
  let totalDurationMs = 0;

  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i];
    if (!toolCall) continue;

    const toolName = toolCall.function.name;
    const toolArgs = toolCall.function.arguments as Record<string, unknown>;

    let processed: ProcessedToolCall;

    // Step 1: Mode enforcement
    if (!isToolAvailable(mode, toolName)) {
      processed = handleModeBlocked(toolName, mode, callbacks, i);
      observations.push(processed.result);
      messages.push(processed.message);
      continue;
    }

    log(`Checking safety for: ${toolName}`, toolArgs);

    // Step 2: Safety check (pass mode for mode-aware command validation)
    const safetyCheck = await safetyLayer.checkToolCall(toolCall, mode);

    if (safetyCheck.status === "denied") {
      processed = await handleSafetyDenied(
        toolName,
        toolArgs,
        safetyCheck.reason,
        safetyLayer,
        callbacks,
        i
      );
      observations.push(processed.result);
      messages.push(processed.message);
      continue;
    }

    // Step 3: Handle confirmation if needed
    let needsConfirmation = false;
    if (safetyCheck.status === "needs_confirmation") {
      log(`Tool needs confirmation: ${toolName}`);
      needsConfirmation = true;

      if (!callbacks.onConfirmationNeeded) {
        processed = await handleNoConfirmationHandler(
          toolName,
          toolArgs,
          safetyLayer,
          callbacks,
          i
        );
        observations.push(processed.result);
        messages.push(processed.message);
        continue;
      }

      // Request confirmation from user
      const response = await callbacks.onConfirmationNeeded(safetyCheck.request);
      safetyLayer.handleConfirmationResponse(response);

      if (response.action === "deny" || response.action === "deny_always") {
        processed = await handleUserDenied(
          toolName,
          toolArgs,
          safetyLayer,
          callbacks,
          i
        );
        observations.push(processed.result);
        messages.push(processed.message);
        continue;
      }
    }

    // Step 4: Execute the tool
    processed = await executeToolCall(
      toolName,
      toolArgs,
      safetyLayer,
      needsConfirmation,
      callbacks,
      i,
      signal
    );

    observations.push(processed.result);
    messages.push(processed.message);
    
    if (processed.executed) {
      executedCount++;
      totalDurationMs += processed.durationMs ?? 0;
    }
  }

  return {
    observations,
    messages,
    executedCount,
    totalDurationMs,
  };
}

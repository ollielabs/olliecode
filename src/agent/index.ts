/**
 * Core agent orchestration.
 * Handles the main agent loop: streaming, tool handling, safety, and loop detection.
 */

import { Ollama } from "ollama";
import type { Message, ToolCall } from "ollama";

import { getToolsForMode } from "./tools";
import { getSystemPromptForMode } from "./prompts";
import type { AgentMode } from "./modes";
import { DEFAULT_MODE } from "./modes";
import type { AgentStep, AgentResult, AgentError, AgentConfig, ToolResult } from "./types";
import { DEFAULT_AGENT_CONFIG } from "./types";
import { SafetyLayer, type ConfirmationRequest, type ConfirmationResponse, type SafetyConfig } from "./safety";
import { log } from "./logger";
import { processStream, isAbortError } from "./stream-handler";
import { processToolCalls } from "./tool-processor";
import { detectLoop, detectDoomLoop } from "./loop-detector";

/**
 * Arguments for running the agent.
 */
export type RunAgentArgs = {
  model: string;
  host: string;
  userMessage: string;
  history: Message[];

  /** Session ID for context (used by todo tools, etc.) */
  sessionId?: string;

  /** Agent mode (plan or build). Defaults to DEFAULT_MODE. */
  mode?: AgentMode;

  /** Streaming callbacks */
  onReasoningToken: (token: string) => void;
  onToolCall: (call: ToolCall, index: number) => void;
  onToolResult: (result: ToolResult, index: number) => void;
  onStepComplete: (step: AgentStep) => void;

  /** Safety callbacks */
  onConfirmationNeeded?: (request: ConfirmationRequest) => Promise<ConfirmationResponse>;
  onToolBlocked?: (tool: string, reason: string) => void;

  /** Abort signal for cancellation */
  signal: AbortSignal;

  /** Configuration overrides */
  config?: Partial<AgentConfig>;
  safetyConfig?: Partial<SafetyConfig>;
};

/**
 * Creates the initial message array for the agent.
 */
function buildInitialMessages(
  systemPrompt: string,
  history: Message[],
  userMessage: string
): Message[] {
  return [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];
}

/**
 * Creates the final result when the agent completes successfully.
 */
function buildFinalResult(
  steps: AgentStep[],
  finalAnswer: string,
  messages: Message[],
  iteration: number,
  totalToolCalls: number,
  startTime: number
): AgentResult {
  // Return messages WITHOUT the system prompt (index 0)
  // The system prompt is added fresh each turn by the agent
  const historyMessages = messages.slice(1);

  return {
    steps,
    finalAnswer,
    messages: historyMessages,
    stats: {
      totalIterations: iteration + 1,
      totalToolCalls,
      totalDurationMs: Date.now() - startTime,
    },
  };
}

/**
 * Nudges the model when it returns an empty response.
 */
function createNudgeMessage(): Message {
  return {
    role: "user",
    content: "[System: Please provide an answer or use a tool to gather more information.]",
  };
}

/**
 * Main agent loop - handles reasoning, tool calls, and iteration.
 *
 * The agent:
 * 1. Sends the conversation to the model
 * 2. Streams the response (content + tool calls)
 * 3. If no tool calls, returns the final answer
 * 4. If tool calls, executes them with safety checks
 * 5. Adds results to history and repeats
 *
 * @param args - Agent configuration and callbacks
 * @returns Final result or error
 */
export async function runAgent(args: RunAgentArgs): Promise<AgentResult | AgentError> {
  const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...args.config };
  const safetyLayer = new SafetyLayer(args.safetyConfig);
  const mode = args.mode ?? DEFAULT_MODE;

  // Get mode-specific tools and prompt
  const modeTools = getToolsForMode(mode);
  const systemPrompt = getSystemPromptForMode(mode);

  log("Starting agent with model:", args.model, "host:", args.host, "mode:", mode);
  log("Tools available:", modeTools.map((t) => t.function.name));

  const client = new Ollama({ host: args.host });
  const messages = buildInitialMessages(systemPrompt, args.history, args.userMessage);

  log("Initial messages count:", messages.length);
  log("System prompt length:", systemPrompt.length, "chars");

  const steps: AgentStep[] = [];
  const startTime = Date.now();
  let totalToolCalls = 0;

  // Wire up abort signal
  const abortHandler = () => client.abort();
  args.signal.addEventListener("abort", abortHandler, { once: true });

  try {
    for (let iteration = 0; iteration < config.maxIterations; iteration++) {
      log(`--- Iteration ${iteration + 1} ---`);

      // Reset turn-based rate limits
      safetyLayer.resetTurn();

      // Check for abort before iteration
      if (args.signal.aborted) {
        log("Aborted before iteration");
        return { type: "aborted" };
      }

      const stepStartTime = Date.now();

      // Stream response from model
      let content: string;
      let toolCalls: ToolCall[];

      try {
        log("Calling Ollama chat...");
        const response = await client.chat({
          model: args.model,
          messages,
          tools: modeTools,
          stream: true,
          options: {
            temperature: 0.2,
          },
        });
        log("Got response iterator, starting to stream...");

        const accumulated = await processStream(
          response,
          {
            onReasoningToken: args.onReasoningToken,
            onToolCall: args.onToolCall,
          },
          args.signal
        );

        content = accumulated.content;
        toolCalls = accumulated.toolCalls;
      } catch (e) {
        log("Error during chat:", e);

        if (args.signal.aborted || isAbortError(e)) {
          return { type: "aborted" };
        }

        const message = e instanceof Error ? e.message : String(e);
        return { type: "model_error", message };
      }

      // Handle empty response
      if (!content.trim() && toolCalls.length === 0) {
        log("Empty response, nudging model");
        messages.push(createNudgeMessage());
        continue;
      }

      // No tool calls = final answer
      if (toolCalls.length === 0) {
        log("No tool calls, returning final answer");

        messages.push({
          role: "assistant",
          content,
        });

        return buildFinalResult(
          steps,
          content,
          messages,
          iteration,
          totalToolCalls,
          startTime
        );
      }

      // Add assistant message with tool calls to history
      messages.push({
        role: "assistant",
        content,
        tool_calls: toolCalls,
      });

      // Process tool calls
      const toolResults = await processToolCalls(
        toolCalls,
        mode,
        safetyLayer,
        {
          onToolResult: args.onToolResult,
          onToolBlocked: args.onToolBlocked,
          onConfirmationNeeded: args.onConfirmationNeeded,
        },
        args.signal,
        {
          context: {
            sessionId: args.sessionId,
            projectRoot: args.safetyConfig?.projectRoot,
          },
        }
      );

      // Add tool result messages to history
      for (const msg of toolResults.messages) {
        messages.push(msg);
      }

      totalToolCalls += toolResults.executedCount;

      // Record the step
      const step: AgentStep = {
        thought: content,
        actions: toolCalls,
        observations: toolResults.observations,
        durationMs: Date.now() - stepStartTime,
      };
      steps.push(step);
      args.onStepComplete(step);

      // Check for loops (both identical and doom loops)
      if (config.loopDetection) {
        // Check for identical loops first
        const loopCheck = detectLoop(steps, config.loopThreshold);
        if (loopCheck.detected) {
          log("Loop detected:", loopCheck.signature);
          return {
            type: "loop_detected",
            action: loopCheck.action ?? "unknown",
            attempts: config.loopThreshold,
          };
        }

        // Check for doom loops (error patterns, oscillations)
        const doomCheck = detectDoomLoop(steps, config.loopThreshold + 1);
        if (doomCheck.detected) {
          log("Doom loop detected:", doomCheck.type, doomCheck.suggestion);
          return {
            type: "loop_detected",
            action: doomCheck.tool ?? "unknown",
            attempts: config.loopThreshold,
          };
        }
      }
    }

    // Max iterations reached
    log("Max iterations reached:", config.maxIterations);
    return {
      type: "max_iterations",
      iterations: config.maxIterations,
      lastThought: steps[steps.length - 1]?.thought ?? "",
    };
  } finally {
    args.signal.removeEventListener("abort", abortHandler);
    await safetyLayer.flush();
  }
}

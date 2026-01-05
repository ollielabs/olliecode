/**
 * Core agent orchestration.
 * Handles the main agent loop: streaming, tool handling, safety, and loop detection.
 */

import { Ollama } from 'ollama';
import type { Message, ToolCall } from 'ollama';

import { getToolsForMode } from './tools';
import { getSystemPromptForMode } from './prompts';
import type { AgentMode } from './modes';
import { DEFAULT_MODE } from './modes';
import type {
  AgentStep,
  AgentResult,
  AgentError,
  AgentConfig,
  ToolResult,
  ContextUsage,
} from './types';
import { DEFAULT_AGENT_CONFIG } from './types';
import {
  SafetyLayer,
  type ConfirmationRequest,
  type ConfirmationResponse,
  type SafetyConfig,
} from './safety';
import { log } from './logger';
import { processStream, isAbortError } from './stream-handler';
import { processToolCalls } from './tool-processor';
import {
  detectConsecutiveLoop,
  detectDoomLoop,
  detectNotFoundPattern,
} from './loop-detector';
import { fetchModelInfo, getContextStats } from '../lib/tokenizer';
import {
  compactMessages,
  getCompactionLevel,
  needsCompaction as checkNeedsCompaction,
} from './compaction';

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
  onConfirmationNeeded?: (
    request: ConfirmationRequest,
  ) => Promise<ConfirmationResponse>;
  onToolBlocked?: (tool: string, reason: string) => void;

  /** Abort signal for cancellation */
  signal: AbortSignal;

  /** Configuration overrides */
  config?: Partial<AgentConfig>;
  safetyConfig?: Partial<SafetyConfig>;

  /** Override the system prompt (used by subagents) */
  systemPromptOverride?: string;
};

/**
 * Creates the initial message array for the agent.
 */
function buildInitialMessages(
  systemPrompt: string,
  history: Message[],
  userMessage: string,
): Message[] {
  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
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
  startTime: number,
  contextUsage?: ContextUsage,
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
    contextUsage,
  };
}

/**
 * Nudges the model when it returns an empty response.
 */
function createNudgeMessage(): Message {
  return {
    role: 'user',
    content:
      '[System: Please provide an answer or use a tool to gather more information.]',
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
export async function runAgent(
  args: RunAgentArgs,
): Promise<AgentResult | AgentError> {
  const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...args.config };
  const safetyLayer = new SafetyLayer(args.safetyConfig);
  const mode = args.mode ?? DEFAULT_MODE;

  // Get mode-specific tools and prompt
  const modeTools = getToolsForMode(mode);
  const systemPrompt =
    args.systemPromptOverride ?? getSystemPromptForMode(mode);

  log(
    'Starting agent with model:',
    args.model,
    'host:',
    args.host,
    'mode:',
    mode,
  );
  log(
    'Tools available:',
    modeTools.map((t) => t.function.name),
  );

  // Fetch model info for context tracking (non-blocking, best effort)
  let maxContextTokens: number | undefined;
  try {
    const modelInfo = await fetchModelInfo(args.model, args.host);
    maxContextTokens = modelInfo.contextLength;
    log('Model context window:', maxContextTokens, 'tokens');
  } catch (e) {
    log('Could not fetch model info for context tracking:', e);
    // Continue without context tracking
  }

  const client = new Ollama({ host: args.host });
  const messages = buildInitialMessages(
    systemPrompt,
    args.history,
    args.userMessage,
  );

  log('Initial messages count:', messages.length);
  log('System prompt length:', systemPrompt.length, 'chars');

  const steps: AgentStep[] = [];
  const startTime = Date.now();
  let totalToolCalls = 0;

  // Wire up abort signal
  const abortHandler = () => client.abort();
  args.signal.addEventListener('abort', abortHandler, { once: true });

  try {
    for (let iteration = 0; iteration < config.maxIterations; iteration++) {
      log(`--- Iteration ${iteration + 1} ---`);

      // Reset turn-based rate limits
      safetyLayer.resetTurn();

      // Check for abort before iteration
      if (args.signal.aborted) {
        log('Aborted before iteration');
        return { type: 'aborted' };
      }

      const stepStartTime = Date.now();

      // Stream response from model
      let content: string;
      let toolCalls: ToolCall[];

      try {
        log('Calling Ollama chat...');
        const response = await client.chat({
          model: args.model,
          messages,
          tools: modeTools,
          stream: true,
          options: {
            temperature: 0.2,
          },
        });
        log('Got response iterator, starting to stream...');

        const accumulated = await processStream(
          response,
          {
            onReasoningToken: args.onReasoningToken,
            onToolCall: args.onToolCall,
          },
          args.signal,
        );

        content = accumulated.content;
        toolCalls = accumulated.toolCalls;
      } catch (e) {
        log('Error during chat:', e);

        if (args.signal.aborted || isAbortError(e)) {
          return { type: 'aborted' };
        }

        const message = e instanceof Error ? e.message : String(e);
        return { type: 'model_error', message };
      }

      // Handle empty response
      if (!content.trim() && toolCalls.length === 0) {
        log('Empty response, nudging model');
        messages.push(createNudgeMessage());
        continue;
      }

      // No tool calls = final answer
      if (toolCalls.length === 0) {
        log('No tool calls, returning final answer');

        messages.push({
          role: 'assistant',
          content,
        });

        // Calculate final context usage if we have model info
        let contextUsage: ContextUsage | undefined;
        if (maxContextTokens) {
          const stats = getContextStats(messages, maxContextTokens);
          contextUsage = {
            totalTokens: stats.totalTokens,
            maxTokens: stats.maxTokens,
            usagePercent: stats.usagePercent,
            exceededThreshold: stats.isNearLimit,
          };
          log('Final context usage:', `${contextUsage.usagePercent}%`);
        }

        return buildFinalResult(
          steps,
          content,
          messages,
          iteration,
          totalToolCalls,
          startTime,
          contextUsage,
        );
      }

      // Add assistant message with tool calls to history
      messages.push({
        role: 'assistant',
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
            model: args.model,
            host: args.host,
          },
        },
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
        // Check for truly consecutive identical loops
        // This allows read→edit→read patterns but catches read→read→read
        const loopCheck = detectConsecutiveLoop(steps, config.loopThreshold);
        if (loopCheck.detected) {
          log('Consecutive loop detected:', loopCheck.signature);
          return {
            type: 'loop_detected',
            action: loopCheck.action ?? 'unknown',
            attempts: config.loopThreshold,
          };
        }

        // Check for not-found patterns BEFORE doom loops
        // This prevents treating "searching for nonexistent item" as a doom loop
        const notFoundCheck = detectNotFoundPattern(
          steps,
          config.loopThreshold,
        );
        if (notFoundCheck.detected) {
          log('Not-found pattern detected:', notFoundCheck.searchTerm);
          // Inject a system reminder to help the agent give up gracefully
          // Don't return an error - give the agent a chance to report "not found"
          messages.push({
            role: 'system',
            content: `<system-reminder>
Your searches for "${notFoundCheck.searchTerm}" have returned empty multiple times.
This likely means it doesn't exist in this codebase.
Report this finding to the user rather than continuing to search.
A response like "I couldn't find X in this codebase" is helpful and valid.
</system-reminder>`,
          });
          // Don't check doom loops when not-found is detected
          // The agent should respond with "not found" on the next iteration
        } else {
          // Check for doom loops (error patterns, oscillations)
          // Only check if NOT already handling a not-found pattern
          const doomCheck = detectDoomLoop(steps, config.loopThreshold + 1);
          if (doomCheck.detected) {
            log('Doom loop detected:', doomCheck.type, doomCheck.suggestion);
            return {
              type: 'loop_detected',
              action: doomCheck.tool ?? 'unknown',
              attempts: config.loopThreshold,
            };
          }
        }
      }

      // Check for context compaction
      if (config.autoCompaction && maxContextTokens) {
        const stats = getContextStats(messages, maxContextTokens);
        if (
          checkNeedsCompaction(stats.usagePercent, config.compactionThreshold)
        ) {
          log(
            'Context usage at',
            `${stats.usagePercent}%, triggering compaction`,
          );
          const level = getCompactionLevel(stats.usagePercent);
          const result = await compactMessages(
            messages,
            level,
            undefined, // use default config
            args.model,
            args.host,
          );
          // Replace messages array with compacted version
          messages.length = 0;
          messages.push(...result.messages);
          log(
            'Compacted:',
            result.originalCount,
            '→',
            result.compactedCount,
            'messages',
          );
        }
      }
    }

    // Max iterations reached
    log('Max iterations reached:', config.maxIterations);
    return {
      type: 'max_iterations',
      iterations: config.maxIterations,
      lastThought: steps[steps.length - 1]?.thought ?? '',
    };
  } finally {
    args.signal.removeEventListener('abort', abortHandler);
    await safetyLayer.flush();
  }
}

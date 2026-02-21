/**
 * Core agent orchestration.
 * Handles the main agent loop: streaming, tool handling, safety, and loop detection.
 */

import type { Message, ToolCall } from 'ollama';
import { Ollama } from 'ollama';
import {
  fetchModelInfo,
  getContextStats,
  OVERHEAD_AGENT_LOOP,
} from '../lib/tokenizer';
import {
  type CompactionResult,
  needsCompaction as checkNeedsCompaction,
  compactMessages,
  DEFAULT_COMPACTION_CONFIG,
  getCompactionLevel,
} from './compaction';
import { log } from './logger';
import {
  detectConsecutiveLoop,
  detectDoomLoop,
  detectNotFoundPattern,
} from './loop-detector';
import type { AgentMode } from './modes';
import { DEFAULT_MODE } from './modes';
import { getDefaultContext, getSystemPromptForMode } from './prompts';
import {
  type ConfirmationRequest,
  type ConfirmationResponse,
  type SafetyConfig,
  SafetyLayer,
} from './safety';
import { isAbortError, processStream } from './stream-handler';
import { processToolCalls } from './tool-processor';
import { getToolsForMode } from './tools';
import type {
  AgentConfig,
  AgentError,
  AgentResult,
  AgentStep,
  ContextUsage,
  ToolResult,
  ToolsConfig,
} from './types';
import { DEFAULT_AGENT_CONFIG } from './types';

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
  safetyConfig: SafetyConfig;
  toolsConfig?: ToolsConfig;

  /** Instruction file paths from config (resolved and loaded into system prompt) */
  configInstructions?: string[];

  /** Chat temperature (default 0.2) */
  temperature?: number;

  /** Compaction temperature (default 0.3, separate from chat temperature) */
  compactionTemperature?: number;

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
 * Strip the system prompt (index 0) from the messages array.
 * The system prompt is added fresh each turn by buildInitialMessages,
 * so it must not be included in the returned history.
 */
function stripSystemPrompt(messages: Message[]): Message[] {
  return messages.length > 0 && messages[0]?.role === 'system'
    ? messages.slice(1)
    : messages;
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
  compacted?: CompactionResult,
): AgentResult {
  return {
    steps,
    finalAnswer,
    messages: stripSystemPrompt(messages),
    stats: {
      totalIterations: iteration + 1,
      totalToolCalls,
      totalDurationMs: Date.now() - startTime,
    },
    contextUsage,
    compacted,
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
  const temperature = args.temperature ?? 0.2;
  const compactionTemperature = args.compactionTemperature ?? 0.3;

  // Get mode-specific tools and prompt
  const modeTools = getToolsForMode(mode);
  const systemPrompt =
    args.systemPromptOverride ??
    getSystemPromptForMode(
      mode,
      getDefaultContext(args.safetyConfig.projectRoot, args.configInstructions),
    );

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
  let lastCompaction: CompactionResult | undefined;
  /** Last known actual prompt token count from model (from processStream) */
  let lastPromptTokens: number | undefined;
  /** Last known actual completion token count from model */
  let lastCompletionTokens: number | undefined;

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
        return {
          type: 'aborted',
          messages: stripSystemPrompt(messages),
          compacted: lastCompaction,
        };
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
            temperature,
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

        // Track real token counts from the model
        if (accumulated.promptTokens !== undefined) {
          lastPromptTokens = accumulated.promptTokens;
        }
        if (accumulated.completionTokens !== undefined) {
          lastCompletionTokens = accumulated.completionTokens;
        }
      } catch (e) {
        log('Error during chat:', e);
        if (e instanceof Error) {
          log('Error name:', e.name, 'Stack:', e.stack);
          if ('status_code' in e)
            log('HTTP status:', (e as { status_code: unknown }).status_code);
          if ('cause' in e) log('Cause:', e.cause);
        }
        log(
          'Messages at error:',
          messages.length,
          'messages, roles:',
          messages.map((m) => m.role).join(','),
        );

        if (args.signal.aborted || isAbortError(e)) {
          return {
            type: 'aborted',
            messages: stripSystemPrompt(messages),
            compacted: lastCompaction,
          };
        }

        const message = e instanceof Error ? e.message : String(e);
        return {
          type: 'model_error',
          message,
          messages: stripSystemPrompt(messages),
          compacted: lastCompaction,
        };
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

        // Calculate final context usage — prefer real token counts from model
        let contextUsage: ContextUsage | undefined;
        if (maxContextTokens) {
          if (lastPromptTokens !== undefined) {
            // Use real counts: promptTokens is the total input tokens
            // (system + history + user + tool schemas — everything).
            // Add completionTokens for the response we just generated.
            const totalTokens = lastPromptTokens + (lastCompletionTokens ?? 0);
            const usagePercent = Math.round(
              (totalTokens / maxContextTokens) * 100,
            );
            contextUsage = {
              totalTokens,
              maxTokens: maxContextTokens,
              usagePercent,
              exceededThreshold: usagePercent >= 80,
              promptTokens: lastPromptTokens,
              completionTokens: lastCompletionTokens,
            };
          } else {
            // Fallback to heuristic estimate (messages includes system prompt)
            const stats = getContextStats(
              messages,
              maxContextTokens,
              OVERHEAD_AGENT_LOOP,
            );
            contextUsage = {
              totalTokens: stats.totalTokens,
              maxTokens: stats.maxTokens,
              usagePercent: stats.usagePercent,
              exceededThreshold: stats.isNearLimit,
            };
          }
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
          lastCompaction,
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
            projectRoot: args.safetyConfig.projectRoot,
            model: args.model,
            host: args.host,
            safetyConfig: args.safetyConfig,
            toolsConfig: args.toolsConfig,
            configInstructions: args.configInstructions,
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

      // Soft warning at 80% of maxIterations — nudge the model to wrap up
      const warningThreshold = Math.floor(config.maxIterations * 0.8);
      if (iteration === warningThreshold) {
        log(
          `Iteration ${iteration + 1} of ${config.maxIterations} — injecting wrap-up warning`,
        );
        messages.push({
          role: 'system',
          content: `<system-reminder>
You have used ${iteration + 1} of ${config.maxIterations} allowed iterations.
Begin wrapping up your current work and provide a final response to the user.
If you need more steps, prioritize the most important remaining work.
</system-reminder>`,
        });
      }

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
            messages: stripSystemPrompt(messages),
            compacted: lastCompaction,
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
              messages: stripSystemPrompt(messages),
              compacted: lastCompaction,
            };
          }
        }
      }

      // Check for context compaction
      if (config.autoCompaction && maxContextTokens) {
        // Use real token count from model when available, fall back to heuristic
        let usagePercent: number;
        if (lastPromptTokens !== undefined) {
          // Real: promptTokens includes everything the model tokenized
          // (system + history + tools + user). Add completion tokens for
          // the response that is now part of history.
          const totalUsed = lastPromptTokens + (lastCompletionTokens ?? 0);
          usagePercent = Math.round((totalUsed / maxContextTokens) * 100);
          log('Context usage (real):', `${usagePercent}%`);
        } else {
          // messages already includes system prompt, only add tool schema overhead
          const stats = getContextStats(
            messages,
            maxContextTokens,
            OVERHEAD_AGENT_LOOP,
          );
          usagePercent = stats.usagePercent;
          log('Context usage (estimated):', `${usagePercent}%`);
        }
        if (checkNeedsCompaction(usagePercent, config.compactionThreshold)) {
          log('Context usage at', `${usagePercent}%, triggering compaction`);
          const level = getCompactionLevel(usagePercent);
          const result = await compactMessages(
            messages,
            level,
            {
              ...DEFAULT_COMPACTION_CONFIG,
              temperature: compactionTemperature,
            },
            args.model,
            args.host,
          );
          // Replace messages array with compacted version
          messages.length = 0;
          messages.push(...result.messages);
          // Stash the compaction result so the TUI can persist a snapshot
          lastCompaction = result;
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
      messages: stripSystemPrompt(messages),
      compacted: lastCompaction,
    };
  } finally {
    args.signal.removeEventListener('abort', abortHandler);
    await safetyLayer.flush();
  }
}

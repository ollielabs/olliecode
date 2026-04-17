/**
 * Core agent orchestration.
 * Handles the main agent loop: streaming, tool handling, safety, and loop detection.
 */

import type { Message, ToolCall } from 'ollama';
import { Ollama } from 'ollama';
import {
  computeOverhead,
  estimateMessagesTokens,
  fetchModelInfo,
  getContextStats,
  OVERHEAD_AGENT_LOOP,
} from '../lib/tokenizer';
import { needsCompaction } from './compaction';
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

  /** Override the system prompt (used by subagents) */
  systemPromptOverride?: string;

  /** MCP tool metadata for mode filtering (plan mode: readOnlyHint only) */
  mcpTools?: import('./mcp/types').McpToolInfo[];

  /** Observation block from observational memory (injected into system prompt) */
  observationBlock?: string;

  /**
   * Continuation hint for OM — injected as a system message after
   * the observation block when observations exist. Tells the model
   * to continue from observations rather than expecting full history.
   */
  continuationHint?: string;

  /**
   * Called after each tool iteration with the current message array
   * (system prompt stripped) and token counts from the latest model
   * response. Used for:
   * - OM async buffering (Zone 1 check every agent step, per Mastra)
   * - Sidebar context stats updates (live token usage during long runs)
   */
  onIterationComplete?: (
    messages: Message[],
    tokenInfo?: {
      promptTokens: number;
      completionTokens: number;
      maxTokens: number;
    },
  ) => void;
};

/**
 * Creates the initial message array for the agent.
 *
 * When continuationHint is provided (OM active with observations),
 * it's injected as a system message right after the system prompt
 * and before the history. This tells the model to continue from
 * observations rather than expecting full conversation history.
 */
function buildInitialMessages(
  systemPrompt: string,
  history: Message[],
  userMessage: string,
  continuationHint?: string,
): Message[] {
  const messages: Message[] = [{ role: 'system', content: systemPrompt }];

  if (continuationHint) {
    messages.push({ role: 'system', content: continuationHint });
  }

  messages.push(...history);
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

/**
 * Strip ALL system messages from the messages array.
 *
 * Multiple system messages can exist:
 * - Index 0: the main system prompt (added by buildInitialMessages)
 * - Index 1: continuation hint (OM, added by buildInitialMessages)
 * - Mid-loop: wrap-up warning, not-found warning (injected during agent loop)
 *
 * None of these should leak into the persisted history or be passed
 * to OM for observation tracking — they're ephemeral per-turn injections.
 */
function stripSystemPrompt(messages: Message[]): Message[] {
  return messages.filter((m) => m.role !== 'system');
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
 * Build context usage from real token counts or heuristic fallback.
 *
 * @param overheadTokens - Dynamically computed overhead for tool schemas.
 *   Falls back to OVERHEAD_AGENT_LOOP when not provided.
 */
function buildContextUsage(
  lastPromptTokens: number | undefined,
  lastCompletionTokens: number | undefined,
  messages: Message[],
  maxContextTokens: number,
  compactionThreshold: number,
  overheadTokens?: number,
): ContextUsage {
  if (lastPromptTokens !== undefined) {
    // Real counts from model — overhead is already included in prompt_eval_count
    const totalTokens = lastPromptTokens + (lastCompletionTokens ?? 0);
    const usagePercent = Math.round((totalTokens / maxContextTokens) * 100);
    return {
      totalTokens,
      maxTokens: maxContextTokens,
      usagePercent,
      exceededThreshold: usagePercent >= compactionThreshold,
      promptTokens: lastPromptTokens,
      completionTokens: lastCompletionTokens,
    };
  }
  // Heuristic fallback — use dynamic overhead if available
  const stats = getContextStats(
    messages,
    maxContextTokens,
    overheadTokens ?? OVERHEAD_AGENT_LOOP,
  );
  return {
    totalTokens: stats.totalTokens,
    maxTokens: stats.maxTokens,
    usagePercent: stats.usagePercent,
    exceededThreshold: stats.isNearLimit,
  };
}

/**
 * Detect "prompt too long" errors from Ollama.
 */
function isPromptTooLong(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return (
    msg.includes('prompt too long') ||
    msg.includes('exceeded max context length') ||
    msg.includes('context length exceeded')
  );
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
 * Compaction is NOT performed in the agent loop. If context usage
 * exceeds the threshold, the result includes `needsSummarization: true`
 * and the caller handles summarization after settlement.
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

  // Get mode-specific tools and prompt (pass mcpTools for plan mode filtering)
  const modeTools = getToolsForMode(mode, args.mcpTools);
  const ctx = getDefaultContext(
    args.safetyConfig.projectRoot,
    args.configInstructions,
  );
  if (args.observationBlock) {
    ctx.observationBlock = args.observationBlock;
  }
  const systemPrompt =
    args.systemPromptOverride ?? getSystemPromptForMode(mode, ctx);

  // Compute tool schema overhead dynamically (for heuristic fallback path).
  // In the agent loop, the system prompt IS included in the messages array,
  // so only tool schemas contribute to overhead not captured by the heuristic.
  const toolSchemaOverhead = computeOverhead(modeTools);

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
  log('Tool schema overhead:', toolSchemaOverhead, 'tokens (estimated)');

  // Fetch model info for context tracking (non-blocking, best effort)
  let maxContextTokens: number | undefined;
  try {
    const modelInfo = await fetchModelInfo(args.model, args.host);
    maxContextTokens = modelInfo.contextLength;
    log('Model context window:', maxContextTokens, 'tokens');
  } catch (e) {
    log('Could not fetch model info for context tracking:', e);
  }

  const client = new Ollama({ host: args.host });
  const messages = buildInitialMessages(
    systemPrompt,
    args.history,
    args.userMessage,
    args.continuationHint,
  );

  log('Initial messages count:', messages.length);
  log('System prompt length:', systemPrompt.length, 'chars');
  if (args.observationBlock) {
    log('Observation block injected:', args.observationBlock.length, 'chars');
  }

  const steps: AgentStep[] = [];
  const startTime = Date.now();
  let totalToolCalls = 0;
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

        // Debug: compare heuristic estimate against real counts
        if (accumulated.promptTokens !== undefined) {
          const estimatedTokens =
            estimateMessagesTokens(messages) + toolSchemaOverhead;
          const realTokens = accumulated.promptTokens;
          const totalChars = messages.reduce(
            (sum, m) => sum + (m.content?.length ?? 0),
            0,
          );
          const charsPerToken =
            realTokens > 0 ? (totalChars / realTokens).toFixed(2) : 'N/A';
          const delta = estimatedTokens - realTokens;
          const deltaPercent =
            realTokens > 0 ? ((delta / realTokens) * 100).toFixed(1) : 'N/A';
          log(
            `Token accuracy: estimated=${estimatedTokens} real=${realTokens} delta=${delta} (${deltaPercent}%) chars=${totalChars} chars/token=${charsPerToken}`,
          );
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
          };
        }

        // "Prompt too long" — signal the caller to summarize and retry
        const message = e instanceof Error ? e.message : String(e);
        if (isPromptTooLong(e)) {
          log('Prompt too long — signaling caller for summarization');
          return {
            type: 'model_error',
            message,
            messages: stripSystemPrompt(messages),
            contextUsage: maxContextTokens
              ? buildContextUsage(
                  lastPromptTokens,
                  lastCompletionTokens,
                  messages,
                  maxContextTokens,
                  config.compactionThreshold,
                  toolSchemaOverhead,
                )
              : undefined,
            promptTooLong: true,
          };
        }

        return {
          type: 'model_error',
          message,
          messages: stripSystemPrompt(messages),
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

        // Build context usage from real counts or heuristic
        let contextUsage: ContextUsage | undefined;
        let shouldSummarize = false;
        if (maxContextTokens) {
          contextUsage = buildContextUsage(
            lastPromptTokens,
            lastCompletionTokens,
            messages,
            maxContextTokens,
            config.compactionThreshold,
            toolSchemaOverhead,
          );
          log('Final context usage:', `${contextUsage.usagePercent}%`);
          // Signal caller to summarize if threshold exceeded
          if (
            config.autoCompaction &&
            needsCompaction(
              contextUsage.usagePercent,
              config.compactionThreshold,
            )
          ) {
            shouldSummarize = true;
            log(
              `Context at ${contextUsage.usagePercent}% exceeds ${config.compactionThreshold}% — flagging for summarization`,
            );
          }
        }

        return {
          steps,
          finalAnswer: content,
          messages: stripSystemPrompt(messages),
          stats: {
            totalIterations: iteration + 1,
            totalToolCalls,
            totalDurationMs: Date.now() - startTime,
          },
          contextUsage,
          needsSummarization: shouldSummarize || undefined,
        };
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

      // Record the step (pre-compute action signatures for loop detection)
      const step: AgentStep = {
        thought: content,
        actions: toolCalls,
        observations: toolResults.observations,
        durationMs: Date.now() - stepStartTime,
        actionSignatures: toolCalls.map(
          (tc) =>
            `${tc.function.name}:${JSON.stringify(tc.function.arguments)}`,
        ),
      };
      steps.push(step);
      args.onStepComplete(step);

      // Cache stripped messages for this iteration (avoids re-filtering
      // the full array on every callback/return path).
      const strippedMessages = stripSystemPrompt(messages);

      // Mid-loop: OM buffering check + sidebar stats update.
      // Fire-and-forget — does not block the agent loop.
      if (args.onIterationComplete) {
        try {
          args.onIterationComplete(
            strippedMessages,
            lastPromptTokens !== undefined && maxContextTokens !== undefined
              ? {
                  promptTokens: lastPromptTokens,
                  completionTokens: lastCompletionTokens ?? 0,
                  maxTokens: maxContextTokens,
                }
              : undefined,
          );
        } catch {
          // Enhancement — never break the agent loop
        }
      }

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
        const loopCheck = detectConsecutiveLoop(steps, config.loopThreshold);
        if (loopCheck.detected) {
          log('Consecutive loop detected:', loopCheck.signature);
          return {
            type: 'loop_detected',
            action: loopCheck.action ?? 'unknown',
            attempts: config.loopThreshold,
            messages: stripSystemPrompt(messages),
          };
        }

        // Check for not-found patterns BEFORE doom loops
        const notFoundCheck = detectNotFoundPattern(
          steps,
          config.loopThreshold,
        );
        if (notFoundCheck.detected) {
          log('Not-found pattern detected:', notFoundCheck.searchTerm);
          messages.push({
            role: 'system',
            content: `<system-reminder>
Your searches for "${notFoundCheck.searchTerm}" have returned empty multiple times.
This likely means it doesn't exist in this codebase.
Report this finding to the user rather than continuing to search.
A response like "I couldn't find X in this codebase" is helpful and valid.
</system-reminder>`,
          });
        } else {
          // Check for doom loops (error patterns, oscillations)
          const doomCheck = detectDoomLoop(steps, config.loopThreshold + 1);
          if (doomCheck.detected) {
            log('Doom loop detected:', doomCheck.type, doomCheck.suggestion);
            return {
              type: 'loop_detected',
              action: doomCheck.tool ?? 'unknown',
              attempts: config.loopThreshold,
              messages: stripSystemPrompt(messages),
            };
          }
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
    };
  } finally {
    args.signal.removeEventListener('abort', abortHandler);
    await safetyLayer.flush();
  }
}

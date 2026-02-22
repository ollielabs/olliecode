/**
 * Token counting utilities for context management.
 *
 * Provides token estimation for messages to help track context usage.
 * Uses a character-based heuristic for estimation since Ollama doesn't
 * expose a tokenization endpoint.
 *
 * Context window size is fetched from the Ollama API via /api/show.
 *
 * Typical token ratios:
 * - English text: ~4 characters per token
 * - Code: ~3 characters per token (more symbols/short identifiers)
 * - JSON: ~3.5 characters per token
 */

import type { Message, Tool } from 'ollama';

/**
 * Average characters per token for different content types.
 * Conservative estimates (lower = higher token count = safer).
 * Based on empirical testing with GLM-4, Llama 3, and Qwen tokenizers.
 */
const CHARS_PER_TOKEN = {
  text: 3.5,
  code: 2.5,
  json: 3,
  mixed: 2.5, // Conservative — code-heavy conversations average 2-2.5 chars/token
} as const;

type ContentType = keyof typeof CHARS_PER_TOKEN;

/**
 * Context usage statistics.
 */
export type ContextStats = {
  /** Estimated total tokens in context */
  totalTokens: number;
  /** Token limit for the model */
  maxTokens: number;
  /** Usage as percentage (0-100) */
  usagePercent: number;
  /** Whether context is approaching limit (>80%) */
  isNearLimit: boolean;
  /** Whether context is at critical level (>90%) */
  isCritical: boolean;
  /** Breakdown by message role */
  byRole: {
    system: number;
    user: number;
    assistant: number;
    tool: number;
  };
};

/**
 * Model info from Ollama API /api/show endpoint.
 */
export type ModelInfo = {
  contextLength: number;
  family: string;
  parameterSize: string;
  capabilities: string[];
};

/**
 * Cache for model info to avoid repeated API calls.
 */
const modelInfoCache = new Map<string, ModelInfo>();

/**
 * Estimate token count for a string using character-based heuristic.
 *
 * @param text - The text to estimate tokens for
 * @param contentType - Type of content for better estimation
 * @returns Estimated token count
 */
export function estimateTokens(
  text: string,
  contentType: ContentType = 'mixed',
): number {
  if (!text) return 0;

  const charsPerToken = CHARS_PER_TOKEN[contentType];
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Estimate token count for a message, accounting for role overhead.
 *
 * Messages have overhead from:
 * - Role markers (e.g., "<|im_start|>assistant")
 * - Message separators
 * - Tool call formatting
 *
 * @param message - The message to estimate
 * @returns Estimated token count including overhead
 */
export function estimateMessageTokens(message: Message): number {
  // Base overhead for role/formatting (~4 tokens)
  let tokens = 4;

  // Content tokens
  if (message.content) {
    // Detect if content looks like code
    const isCode =
      message.content.includes('```') ||
      message.content.includes('function ') ||
      message.content.includes('const ') ||
      message.content.includes('import ');

    tokens += estimateTokens(message.content, isCode ? 'code' : 'mixed');
  }

  // Tool calls add significant overhead
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const call of message.tool_calls) {
      // Tool name and structure overhead
      tokens += 10;
      // Arguments (usually JSON)
      const argsStr =
        typeof call.function.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function.arguments);
      tokens += estimateTokens(argsStr, 'json');
    }
  }

  return tokens;
}

/**
 * Estimate total token count for an array of messages.
 *
 * @param messages - Array of messages to estimate
 * @returns Total estimated token count
 */
export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Parse num_ctx from Ollama's /api/show `parameters` string and compute
 * the effective context length.
 *
 * The `parameters` field is a multiline string from the Modelfile, e.g.:
 *   "num_ctx 32768\ntemperature 0.7\nstop <|im_end|>\n"
 *
 * When `num_ctx` is present and lower than the architecture `context_length`,
 * it represents the operational limit and should be used instead.
 *
 * @param archContextLength - Architecture context_length from model_info
 * @param parameters - Raw parameters string from /api/show (may be undefined)
 * @returns Effective context length (min of arch limit and num_ctx)
 */
export function resolveContextLength(
  archContextLength: number,
  parameters?: string,
): number {
  if (!parameters) return archContextLength;

  const match = parameters.match(/^num_ctx\s+"?(\d+)"?/m);
  if (!match?.[1]) return archContextLength;

  const numCtx = Number.parseInt(match[1], 10);
  if (numCtx <= 0) return archContextLength;

  return Math.min(archContextLength, numCtx);
}

/**
 * Fetch model info from Ollama API.
 *
 * @param model - Model name
 * @param host - Ollama host URL
 * @returns Model info including context length
 */
export async function fetchModelInfo(
  model: string,
  host: string,
): Promise<ModelInfo> {
  // Check cache first
  const cacheKey = `${host}:${model}`;
  const cached = modelInfoCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(`${host}/api/show`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OLLAMA_API_KEY ?? ''}`,
      },
      body: JSON.stringify({ model }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch model info: ${response.status}`);
    }

    const data = (await response.json()) as {
      model_info?: Record<string, unknown>;
      details?: { family?: string; parameter_size?: string };
      capabilities?: string[];
      parameters?: string;
    };

    // Extract context length from model_info
    // The key is {family}.context_length (e.g., "glm4.context_length")
    const modelInfo = data.model_info ?? {};
    const family = data.details?.family ?? '';

    // Find context_length key - could be "{family}.context_length" or just "context_length"
    let archContextLength = 0;
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith('.context_length') || key === 'context_length') {
        archContextLength = value as number;
        break;
      }
    }

    if (archContextLength === 0) {
      throw new Error(
        `Could not find context_length in model info for ${model}`,
      );
    }

    // Parse num_ctx from parameters string and compute effective context length
    const contextLength = resolveContextLength(
      archContextLength,
      data.parameters,
    );

    const info: ModelInfo = {
      contextLength,
      family,
      parameterSize: data.details?.parameter_size ?? 'unknown',
      capabilities: data.capabilities ?? [],
    };

    // Cache the result
    modelInfoCache.set(cacheKey, info);

    return info;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get model info for ${model}: ${message}`);
  }
}

/**
 * Get the context window size for a model.
 * This is a synchronous version that requires the model info to be pre-fetched.
 *
 * @param model - Model name
 * @param host - Ollama host URL
 * @returns Context window size in tokens, or undefined if not cached
 */
export function getModelContextSize(
  model: string,
  host: string,
): number | undefined {
  const cacheKey = `${host}:${model}`;
  const cached = modelInfoCache.get(cacheKey);
  return cached?.contextLength;
}

/**
 * Clear the model info cache.
 */
export function clearModelInfoCache(): void {
  modelInfoCache.clear();
}

/**
 * Static fallback overhead constants.
 *
 * Prefer {@link computeOverhead} when tool schemas are available, which
 * measures overhead dynamically. These constants are retained as fallbacks
 * for paths that don't have access to tool schemas (e.g., context stats modal).
 *
 * When real token counts are available (from prompt_eval_count), they
 * supersede overhead estimates entirely.
 */
export const OVERHEAD_SIDEBAR = 10_000;
export const OVERHEAD_AGENT_LOOP = 6_000;

/** Fixed token overhead for ChatML framing (role markers, delimiters). */
const CHATML_FRAMING_TOKENS = 50;

/**
 * Compute token overhead for components NOT included in the message
 * history but always present in the actual Ollama request.
 *
 * In the agent loop, the system prompt IS in the messages array,
 * so only tool schemas contribute to unmeasured overhead. This function
 * estimates the token cost of the serialized tool schemas + ChatML framing.
 *
 * Only used in the agent loop's heuristic fallback path (before real
 * prompt_eval_count is available). Once real counts arrive, they supersede
 * this entirely.
 *
 * @param toolSchemas - Ollama tool schemas sent with each request
 * @returns Estimated overhead in tokens
 */
export function computeOverhead(toolSchemas: Tool[]): number {
  let overhead = CHATML_FRAMING_TOKENS;

  if (toolSchemas.length > 0) {
    const toolsJson = JSON.stringify(toolSchemas);
    overhead += estimateTokens(toolsJson, 'json');
  }

  return overhead;
}

/**
 * Calculate context usage statistics.
 *
 * @param messages - Current conversation messages (excluding system prompt)
 * @param maxTokens - Maximum context window size (from fetchModelInfo)
 * @param overheadTokens - Additional tokens for system prompt + tool schemas
 *                         (defaults to DEFAULT_OVERHEAD_TOKENS)
 * @returns Context usage statistics
 */
export function getContextStats(
  messages: Message[],
  maxTokens: number,
  overheadTokens: number = OVERHEAD_SIDEBAR,
): ContextStats {
  // Calculate tokens by role
  const byRole = {
    system: overheadTokens,
    user: 0,
    assistant: 0,
    tool: 0,
  };

  for (const msg of messages) {
    const tokens = estimateMessageTokens(msg);
    const role = msg.role as keyof typeof byRole;
    if (role in byRole) {
      byRole[role] += tokens;
    } else {
      // Tool responses come back as 'tool' role
      byRole.tool += tokens;
    }
  }

  const totalTokens = Object.values(byRole).reduce((a, b) => a + b, 0);
  const usagePercent = Math.round((totalTokens / maxTokens) * 100);

  return {
    totalTokens,
    maxTokens,
    usagePercent,
    isNearLimit: usagePercent >= 80,
    isCritical: usagePercent >= 90,
    byRole,
  };
}

/**
 * Format context stats for display.
 *
 * @param stats - Context statistics
 * @returns Formatted string for display
 */
export function formatContextStats(stats: ContextStats): string {
  const bar = createUsageBar(stats.usagePercent);
  const status = stats.isCritical
    ? '⚠️  CRITICAL'
    : stats.isNearLimit
      ? '⚡ Near Limit'
      : '✓ OK';

  return `Context: ${stats.totalTokens.toLocaleString()}/${stats.maxTokens.toLocaleString()} tokens (${stats.usagePercent}%) ${bar} ${status}`;
}

/**
 * Create a visual usage bar.
 *
 * @param percent - Usage percentage (0-100)
 * @param width - Bar width in characters
 * @returns ASCII usage bar
 */
function createUsageBar(percent: number, width: number = 10): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Check if context needs compaction based on usage threshold.
 *
 * @param messages - Current messages
 * @param maxTokens - Maximum context window size
 * @param threshold - Usage threshold (0-100), default 80
 * @returns Whether compaction is recommended
 */
export function needsCompaction(
  messages: Message[],
  maxTokens: number,
  threshold: number = 80,
): boolean {
  const stats = getContextStats(messages, maxTokens);
  return stats.usagePercent >= threshold;
}

/**
 * Estimate how many messages can be added before hitting threshold.
 *
 * @param messages - Current messages
 * @param maxTokens - Maximum context window size
 * @param threshold - Usage threshold (0-100), default 80
 * @param avgMessageTokens - Average tokens per message, default 500
 * @returns Estimated number of messages remaining
 */
export function estimateRemainingCapacity(
  messages: Message[],
  maxTokens: number,
  threshold: number = 80,
  avgMessageTokens: number = 500,
): number {
  const stats = getContextStats(messages, maxTokens);
  const thresholdTokens = Math.floor(stats.maxTokens * (threshold / 100));
  const remainingTokens = thresholdTokens - stats.totalTokens;

  if (remainingTokens <= 0) return 0;
  return Math.floor(remainingTokens / avgMessageTokens);
}

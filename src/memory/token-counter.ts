/**
 * Token counting for Observational Memory.
 *
 * Wraps the existing estimateTokens heuristic for OM-specific use cases:
 * counting message arrays, observation text, and tracking thresholds.
 *
 * Uses the conservative 'mixed' content type (2.5 chars/token) from
 * the existing tokenizer. This may over-count slightly but is safe for
 * threshold decisions — we'd rather observe slightly early than late.
 *
 * If accuracy becomes an issue, we can switch to tiktoken (o200k_base)
 * like Mastra does. For now, the heuristic is sufficient.
 */

import type { Message } from 'ollama';

import { estimateTokens } from '../lib/tokenizer';

/** Per-message overhead for role markers, message framing */
const TOKENS_PER_MESSAGE = 4;

/** Per-conversation overhead for system prompt framing, reply priming */
const TOKENS_PER_CONVERSATION = 24;

/**
 * Count tokens in a single Ollama message.
 * Accounts for role tokens, content, and tool call overhead.
 */
export function countMessageTokens(message: Message): number {
  let tokens = TOKENS_PER_MESSAGE;

  // Role name
  tokens += estimateTokens(message.role);

  // Content
  if (message.content) {
    tokens += estimateTokens(message.content);
  }

  // Tool calls
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      // Tool name and structure overhead
      tokens += estimateTokens(call.function.name);
      tokens += TOKENS_PER_MESSAGE; // per-call overhead

      // Arguments (usually JSON)
      const argsStr =
        typeof call.function.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function.arguments);
      tokens += estimateTokens(argsStr);
    }
  }

  return tokens;
}

/**
 * Count tokens in an array of messages.
 */
export function countMessagesTokens(messages: Message[]): number {
  let total = TOKENS_PER_CONVERSATION;
  for (const msg of messages) {
    total += countMessageTokens(msg);
  }
  return total;
}

/**
 * Count tokens in a text string (observations, prompts, etc.).
 */
export function countTextTokens(text: string): number {
  return estimateTokens(text);
}

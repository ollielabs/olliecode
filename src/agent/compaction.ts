/**
 * Context compaction for managing conversation history size.
 *
 * Compaction reduces context size while preserving essential information.
 * See docs/context-compaction.md for the full strategy.
 */

import { Ollama } from 'ollama';
import type { Message } from 'ollama';
import { estimateMessagesTokens } from '../lib/tokenizer';
import { log } from './logger';

/**
 * Compaction configuration options.
 */
export type CompactionConfig = {
  /** Threshold to trigger compaction (0-100), default 80 */
  threshold: number;
  /** Minimum recent messages to keep uncompacted, default 6 */
  minPreservedMessages: number;
  /** Use LLM for summarization vs simple truncation, default true */
  useLLMSummary: boolean;
  /** Maximum tokens for summaries, default 200 */
  maxSummaryTokens: number;
};

/**
 * Default compaction configuration.
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  threshold: 80,
  minPreservedMessages: 6,
  useLLMSummary: true,
  maxSummaryTokens: 200,
};

/**
 * Compaction levels based on context usage.
 */
export type CompactionLevel = 'light' | 'medium' | 'aggressive';

/**
 * Result of a compaction operation.
 */
export type CompactionResult = {
  /** Compacted messages */
  messages: Message[];
  /** Number of messages before compaction */
  originalCount: number;
  /** Number of messages after compaction */
  compactedCount: number;
  /** Estimated tokens before */
  tokensBefore: number;
  /** Estimated tokens after */
  tokensAfter: number;
  /** Compaction level applied */
  level: CompactionLevel;
};

/**
 * Determine compaction level based on context usage percentage.
 */
export function getCompactionLevel(usagePercent: number): CompactionLevel {
  if (usagePercent >= 90) return 'aggressive';
  if (usagePercent >= 85) return 'medium';
  return 'light';
}

/**
 * Check if a message should be preserved (never compacted).
 */
function shouldPreserve(
  message: Message,
  index: number,
  totalMessages: number,
  minPreserved: number,
): boolean {
  // Always preserve system prompt (index 0)
  if (index === 0 && message.role === 'system') {
    return true;
  }

  // Always preserve recent messages
  if (index >= totalMessages - minPreserved) {
    return true;
  }

  // Preserve messages with tool calls (they contain action history)
  if (message.tool_calls && message.tool_calls.length > 0) {
    // But only recent ones
    if (index >= totalMessages - minPreserved * 2) {
      return true;
    }
  }

  // Preserve user messages that look like task definitions
  if (message.role === 'user' && message.content) {
    const content = message.content.toLowerCase();
    // Task definition patterns
    if (
      content.includes('please') ||
      content.includes('help me') ||
      content.includes('i want') ||
      content.includes('create') ||
      content.includes('implement') ||
      content.includes('fix')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Truncate tool output to a maximum length.
 */
function truncateToolOutput(content: string, maxLines: number = 50): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    return content;
  }

  const truncated = lines.slice(0, maxLines).join('\n');
  return `${truncated}\n... (truncated ${lines.length - maxLines} more lines)`;
}

/**
 * Summarize a tool message (truncate output).
 */
function summarizeToolMessage(
  message: Message,
  level: CompactionLevel,
): Message {
  if (message.role !== 'tool' || !message.content) {
    return message;
  }

  const maxLines = level === 'aggressive' ? 10 : level === 'medium' ? 30 : 50;
  return {
    ...message,
    content: truncateToolOutput(message.content, maxLines),
  };
}

/**
 * Create a summary message for a sequence of messages.
 */
async function createSummary(
  messages: Message[],
  model: string,
  host: string,
  maxTokens: number,
): Promise<string> {
  // Build a prompt for summarization
  const conversationText = messages
    .map((m) => {
      const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
      const content = m.content?.slice(0, 500) ?? '[no content]';
      return `${role}: ${content}`;
    })
    .join('\n\n');

  const summaryPrompt = `Summarize this conversation segment in 2-3 concise sentences.
Focus on: what was accomplished, what files were modified, key decisions made.
Do not include greetings or filler. Be direct.

Conversation:
${conversationText}

Summary:`;

  try {
    const client = new Ollama({ host });
    const response = await client.chat({
      model,
      messages: [{ role: 'user', content: summaryPrompt }],
      options: {
        temperature: 0.3,
        num_predict: maxTokens,
      },
    });

    return response.message.content || '[Summary unavailable]';
  } catch (error) {
    log('Error creating summary:', error);
    // Fallback to simple truncation
    return `[Compacted ${messages.length} messages - summary unavailable]`;
  }
}

/**
 * Simple compaction without LLM (truncation only).
 */
function compactSimple(
  messages: Message[],
  level: CompactionLevel,
  config: CompactionConfig,
): Message[] {
  const result: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message) continue;

    if (
      shouldPreserve(message, i, messages.length, config.minPreservedMessages)
    ) {
      // Preserve but still truncate tool outputs
      if (message.role === 'tool') {
        result.push(summarizeToolMessage(message, level));
      } else {
        result.push(message);
      }
    } else if (message.role === 'tool') {
      // Aggressively summarize non-preserved tool outputs
      const maxLines = level === 'aggressive' ? 5 : 20;
      result.push({
        ...message,
        content: truncateToolOutput(message.content ?? '', maxLines),
      });
    } else if (level === 'aggressive') {
    } else {
      // Keep the message but truncate if needed
      result.push(message);
    }
  }

  return result;
}

/**
 * Compact messages using LLM summarization.
 */
async function compactWithSummary(
  messages: Message[],
  level: CompactionLevel,
  config: CompactionConfig,
  model: string,
  host: string,
): Promise<Message[]> {
  const result: Message[] = [];
  const toSummarize: Message[] = [];

  // First pass: identify what to keep vs summarize
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message) continue;

    if (
      shouldPreserve(message, i, messages.length, config.minPreservedMessages)
    ) {
      // Flush any pending messages to summarize
      if (toSummarize.length > 0) {
        const summary = await createSummary(
          toSummarize,
          model,
          host,
          config.maxSummaryTokens,
        );
        result.push({
          role: 'system',
          content: `[Previous conversation summary: ${summary}]`,
        });
        toSummarize.length = 0;
      }

      // Add preserved message (with tool output truncation)
      if (message.role === 'tool') {
        result.push(summarizeToolMessage(message, level));
      } else {
        result.push(message);
      }
    } else {
      // Queue for summarization
      toSummarize.push(message);
    }
  }

  // Handle any remaining messages to summarize
  if (toSummarize.length > 0) {
    const summary = await createSummary(
      toSummarize,
      model,
      host,
      config.maxSummaryTokens,
    );
    result.push({
      role: 'system',
      content: `[Previous conversation summary: ${summary}]`,
    });
  }

  return result;
}

/**
 * Compact conversation messages to reduce context size.
 *
 * @param messages - Current conversation messages
 * @param level - Compaction aggressiveness level
 * @param config - Compaction configuration
 * @param model - Model name (for LLM summarization)
 * @param host - Ollama host URL
 * @returns Compaction result with new messages
 */
export async function compactMessages(
  messages: Message[],
  level: CompactionLevel,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  model?: string,
  host?: string,
): Promise<CompactionResult> {
  const tokensBefore = estimateMessagesTokens(messages);
  const originalCount = messages.length;

  log(
    `Compacting messages: level=${level}, count=${originalCount}, tokens=${tokensBefore}`,
  );

  let compactedMessages: Message[];

  if (config.useLLMSummary && model && host) {
    compactedMessages = await compactWithSummary(
      messages,
      level,
      config,
      model,
      host,
    );
  } else {
    compactedMessages = compactSimple(messages, level, config);
  }

  const tokensAfter = estimateMessagesTokens(compactedMessages);

  log(
    `Compaction complete: count=${compactedMessages.length}, tokens=${tokensAfter}`,
  );

  return {
    messages: compactedMessages,
    originalCount,
    compactedCount: compactedMessages.length,
    tokensBefore,
    tokensAfter,
    level,
  };
}

/**
 * Check if compaction is needed based on current usage.
 */
export function needsCompaction(
  usagePercent: number,
  threshold: number = 80,
): boolean {
  return usagePercent >= threshold;
}

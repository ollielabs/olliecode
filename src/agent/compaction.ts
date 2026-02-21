/**
 * Context compaction for managing conversation history size.
 *
 * Compaction reduces context size while preserving essential information.
 * See docs/context-compaction.md for the full strategy.
 *
 * Design invariants:
 * 1. Compaction summaries are ALWAYS preserved — never re-compacted.
 * 2. If LLM summarization fails, original messages are kept (fail-safe).
 * 3. System prompt (index 0) is always preserved.
 * 4. Recent messages (tail window) are always preserved.
 * 5. The first user message is always preserved (task context).
 * 6. Tool messages are paired with their assistant call — never orphaned.
 */

import type { Message } from 'ollama';
import { Ollama } from 'ollama';
import { estimateMessagesTokens } from '../lib/tokenizer';
import { log } from './logger';

/**
 * Prefix used to identify compaction summary messages in the Ollama Message[]
 * pipeline. This allows fromOllamaMessages() to detect summaries and store
 * them as CompactionSummaryPart instead of plain text.
 *
 * Format: `[compaction:N]` where N is the number of messages compacted.
 */
export const COMPACTION_SUMMARY_PREFIX = '[compaction:';

/**
 * Check if a message is a compaction summary (has the prefix).
 */
function isCompactionSummary(message: Message): boolean {
  return (
    message.role === 'assistant' &&
    typeof message.content === 'string' &&
    message.content.startsWith(COMPACTION_SUMMARY_PREFIX)
  );
}

/**
 * Build a compaction summary message with the identifiable prefix.
 */
function buildCompactionSummaryMessage(
  summary: string,
  compactedCount: number,
): Message {
  return {
    role: 'assistant',
    content: `${COMPACTION_SUMMARY_PREFIX}${compactedCount}]\n${summary}`,
  };
}

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
  /** Temperature for summarization LLM calls, default 0.3 */
  temperature: number;
};

/**
 * Default compaction configuration.
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  threshold: 80,
  minPreservedMessages: 6,
  useLLMSummary: true,
  maxSummaryTokens: 200,
  temperature: 0.3,
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

// ============================================================================
// Preservation logic
// ============================================================================

// Note: preservation logic is handled entirely by classifyMessages()
// which has access to the full message array for proper context
// (first user message detection, tool pairing, etc.).

/**
 * Classification result for each message in the array.
 */
type MessageClassification = {
  /** Whether this message should be preserved */
  preserve: boolean;
  /** Reason for the classification (for logging) */
  reason: string;
};

/**
 * Classify all messages into preserve vs. compact-eligible.
 *
 * This is the single source of truth for what survives compaction.
 * It handles tool-message pairing (tool results must stay with their
 * assistant call) and ensures we never break the message sequence.
 */
function classifyMessages(
  messages: Message[],
  minPreserved: number,
): MessageClassification[] {
  const total = messages.length;
  const result: MessageClassification[] = new Array(total);

  // Find the first user message index
  let firstUserIndex = -1;
  for (let i = 0; i < total; i++) {
    if (messages[i]?.role === 'user') {
      firstUserIndex = i;
      break;
    }
  }

  // First pass: apply position-based rules
  for (let i = 0; i < total; i++) {
    const msg = messages[i];
    if (!msg) {
      result[i] = { preserve: false, reason: 'null' };
      continue;
    }

    // System prompt
    if (i === 0 && msg.role === 'system') {
      result[i] = { preserve: true, reason: 'system_prompt' };
      continue;
    }

    // Existing compaction summaries — never re-compact
    if (isCompactionSummary(msg)) {
      result[i] = { preserve: true, reason: 'compaction_summary' };
      continue;
    }

    // First user message
    if (i === firstUserIndex) {
      result[i] = { preserve: true, reason: 'first_user_message' };
      continue;
    }

    // Tail window (recent messages)
    if (i >= total - minPreserved) {
      result[i] = { preserve: true, reason: 'recent' };
      continue;
    }

    // Default: eligible for compaction
    result[i] = { preserve: false, reason: 'eligible' };
  }

  // Second pass: tool-message pairing
  // If an assistant message with tool_calls is preserved, its following
  // tool-result messages must also be preserved (they form a unit).
  // Conversely, if a tool message is in the tail window but its parent
  // assistant message isn't preserved, preserve the parent too.
  for (let i = 0; i < total; i++) {
    const msg = messages[i];
    const cls = result[i];
    if (!msg || !cls) continue;

    // If a preserved assistant message has tool_calls, preserve following tool results
    if (
      cls.preserve &&
      msg.role === 'assistant' &&
      msg.tool_calls &&
      msg.tool_calls.length > 0
    ) {
      // Preserve all immediately following tool messages
      for (let j = i + 1; j < total; j++) {
        const nextMsg = messages[j];
        if (!nextMsg || nextMsg.role !== 'tool') break;
        const nextCls = result[j];
        if (nextCls && !nextCls.preserve) {
          nextCls.preserve = true;
          nextCls.reason = 'tool_pair_forward';
        }
      }
    }

    // If a tool message is preserved, ensure its parent assistant is too
    if (cls.preserve && msg.role === 'tool') {
      // Walk backward to find the assistant message with tool_calls
      for (let j = i - 1; j >= 0; j--) {
        const prevMsg = messages[j];
        if (!prevMsg) continue;
        if (prevMsg.role === 'tool') continue; // Skip other tool results
        if (
          prevMsg.role === 'assistant' &&
          prevMsg.tool_calls &&
          prevMsg.tool_calls.length > 0
        ) {
          const prevCls = result[j];
          if (prevCls && !prevCls.preserve) {
            prevCls.preserve = true;
            prevCls.reason = 'tool_pair_backward';
          }
        }
        break; // Stop at first non-tool message
      }
    }
  }

  return result;
}

// ============================================================================
// Tool output truncation
// ============================================================================

/**
 * Truncate tool output to a maximum number of lines.
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
 * Get max lines for tool output based on compaction level.
 */
function getToolMaxLines(level: CompactionLevel, preserved: boolean): number {
  if (preserved) {
    // Preserved tools get more generous truncation
    return level === 'aggressive' ? 15 : level === 'medium' ? 30 : 50;
  }
  // Non-preserved tool outputs (kept for context but heavily truncated)
  return level === 'aggressive' ? 5 : level === 'medium' ? 10 : 20;
}

// ============================================================================
// LLM Summarization
// ============================================================================

/**
 * Create a summary for a group of messages using the LLM.
 *
 * Returns null on failure — callers must handle the failure case
 * by keeping the original messages (fail-safe).
 */
async function createSummary(
  messages: Message[],
  model: string,
  host: string,
  maxTokens: number,
  temperature: number = 0.3,
): Promise<string | null> {
  // Build a prompt for summarization — give the LLM more context per message
  // than before (1000 chars instead of 500) for better summaries.
  const conversationText = messages
    .map((m) => {
      const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
      const content = m.content?.slice(0, 1000) ?? '[no content]';
      const toolInfo =
        m.tool_calls && m.tool_calls.length > 0
          ? ` [called: ${m.tool_calls.map((tc) => tc.function.name).join(', ')}]`
          : '';
      return `${role}${toolInfo}: ${content}`;
    })
    .join('\n\n');

  const summaryPrompt = `Summarize this conversation segment concisely.
Focus on: what was accomplished, what files were modified, key decisions made, any errors encountered.
Be specific about file names and changes. Do not include greetings or filler.

Conversation:
${conversationText}

Summary:`;

  try {
    const client = new Ollama({ host });
    const response = await client.chat({
      model,
      messages: [{ role: 'user', content: summaryPrompt }],
      options: {
        temperature,
        num_predict: maxTokens,
      },
    });

    const summary = response.message.content?.trim();
    if (!summary) {
      log('LLM returned empty summary');
      return null;
    }

    return summary;
  } catch (error) {
    log('Error creating summary:', error);
    return null;
  }
}

// ============================================================================
// Compaction strategies
// ============================================================================

/**
 * Simple compaction without LLM (truncation + dropping).
 *
 * Uses classifyMessages for deterministic preservation.
 * Non-preserved messages are either truncated (tool) or counted
 * as dropped and replaced with a summary placeholder.
 */
function compactSimple(
  messages: Message[],
  level: CompactionLevel,
  config: CompactionConfig,
): Message[] {
  const classifications = classifyMessages(
    messages,
    config.minPreservedMessages,
  );
  const result: Message[] = [];
  let droppedCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const cls = classifications[i];
    if (!message || !cls) continue;

    if (cls.preserve) {
      // Flush any accumulated dropped count
      if (droppedCount > 0) {
        result.push(
          buildCompactionSummaryMessage(
            `${droppedCount} earlier messages compacted`,
            droppedCount,
          ),
        );
        droppedCount = 0;
      }

      // Preserve the message, truncating tool output if needed
      if (message.role === 'tool') {
        const maxLines = getToolMaxLines(level, true);
        result.push({
          ...message,
          content: truncateToolOutput(message.content ?? '', maxLines),
        });
      } else {
        result.push(message);
      }
    } else if (message.role === 'tool') {
      // Non-preserved tool: still keep it but heavily truncate
      // (removing it entirely would break the assistant→tool pairing)
      const maxLines = getToolMaxLines(level, false);
      result.push({
        ...message,
        content: truncateToolOutput(message.content ?? '', maxLines),
      });
    } else {
      // Non-preserved, non-tool message: count as dropped
      droppedCount++;
    }
  }

  // Flush trailing dropped count
  if (droppedCount > 0) {
    result.push(
      buildCompactionSummaryMessage(
        `${droppedCount} earlier messages compacted`,
        droppedCount,
      ),
    );
  }

  return result;
}

/**
 * Compact messages using LLM summarization.
 *
 * Key design decisions:
 * - Uses classifyMessages for deterministic preservation.
 * - Groups consecutive non-preserved messages for summarization.
 * - If LLM summarization fails for a group, the original messages
 *   are kept (fail-safe — never silently eat messages).
 * - Compaction summaries are always preserved, never re-summarized.
 */
async function compactWithSummary(
  messages: Message[],
  level: CompactionLevel,
  config: CompactionConfig,
  model: string,
  host: string,
): Promise<Message[]> {
  const classifications = classifyMessages(
    messages,
    config.minPreservedMessages,
  );
  const result: Message[] = [];
  const toSummarize: Message[] = [];

  // Process messages, grouping non-preserved ones for summarization
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const cls = classifications[i];
    if (!message || !cls) continue;

    if (cls.preserve) {
      // Flush any pending messages to summarize
      if (toSummarize.length > 0) {
        await flushSummarizeGroup(
          toSummarize,
          result,
          level,
          model,
          host,
          config,
        );
        toSummarize.length = 0;
      }

      // Add preserved message (with tool output truncation)
      if (message.role === 'tool') {
        const maxLines = getToolMaxLines(level, true);
        result.push({
          ...message,
          content: truncateToolOutput(message.content ?? '', maxLines),
        });
      } else {
        result.push(message);
      }
    } else {
      // Queue for summarization
      toSummarize.push(message);
    }
  }

  // Flush any remaining messages to summarize
  if (toSummarize.length > 0) {
    await flushSummarizeGroup(toSummarize, result, level, model, host, config);
  }

  return result;
}

/**
 * Flush a group of non-preserved messages: try LLM summary, fall back
 * to keeping originals with truncation if summary fails (fail-safe).
 */
async function flushSummarizeGroup(
  group: Message[],
  result: Message[],
  level: CompactionLevel,
  model: string,
  host: string,
  config: CompactionConfig,
): Promise<void> {
  // Filter out tool messages — they should be kept (truncated) separately
  // to avoid breaking message pairing. Only non-tool messages get summarized.
  const nonToolMessages = group.filter((m) => m.role !== 'tool');
  const toolMessages = group.filter((m) => m.role === 'tool');

  if (nonToolMessages.length === 0) {
    // Only tool messages in this group — just truncate and keep
    for (const msg of toolMessages) {
      const maxLines = getToolMaxLines(level, false);
      result.push({
        ...msg,
        content: truncateToolOutput(msg.content ?? '', maxLines),
      });
    }
    return;
  }

  // Try LLM summarization for non-tool messages
  const summary = await createSummary(
    nonToolMessages,
    model,
    host,
    config.maxSummaryTokens,
    config.temperature,
  );

  if (summary !== null) {
    // Success: emit summary + truncated tool messages
    result.push(buildCompactionSummaryMessage(summary, nonToolMessages.length));
    for (const msg of toolMessages) {
      const maxLines = getToolMaxLines(level, false);
      result.push({
        ...msg,
        content: truncateToolOutput(msg.content ?? '', maxLines),
      });
    }
  } else {
    // FAIL-SAFE: LLM summary failed — keep ALL original messages
    // (truncate tool outputs but don't lose anything).
    log(
      `Summary failed for ${group.length} messages — keeping originals (fail-safe)`,
    );
    for (const msg of group) {
      if (msg.role === 'tool') {
        const maxLines = getToolMaxLines(level, false);
        result.push({
          ...msg,
          content: truncateToolOutput(msg.content ?? '', maxLines),
        });
      } else {
        result.push(msg);
      }
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compact conversation messages to reduce context size.
 *
 * @param messages - Current conversation messages (system prompt + history)
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

  // Log classification for debugging
  const classifications = classifyMessages(
    messages,
    config.minPreservedMessages,
  );
  const preservedCount = classifications.filter((c) => c.preserve).length;
  const eligibleCount = classifications.filter((c) => !c.preserve).length;
  log(
    `Classification: ${preservedCount} preserved, ${eligibleCount} eligible for compaction`,
  );
  for (let i = 0; i < classifications.length; i++) {
    const cls = classifications[i];
    const msg = messages[i];
    if (cls && msg) {
      log(
        `  [${i}] ${msg.role} ${cls.preserve ? 'KEEP' : 'COMPACT'} (${cls.reason}) content=${(msg.content ?? '').slice(0, 60)}...`,
      );
    }
  }

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
    `Compaction complete: ${originalCount} -> ${compactedMessages.length} messages, ${tokensBefore} -> ${tokensAfter} tokens`,
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

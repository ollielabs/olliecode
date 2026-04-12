/**
 * Context compaction via conversation summarization.
 *
 * Compaction never alters chat history. It creates a summary message
 * that is appended to the conversation. When building model context,
 * everything before the summary is dropped and the summary is sent
 * as context. The full chat history is always preserved for display.
 *
 * Summarization uses a separate Ollama call with a focused system
 * prompt and no tools — it runs on a fresh context, not the
 * nearly-full agent context.
 */

import type { Message } from 'ollama';
import { Ollama } from 'ollama';
import { log } from './logger';

/**
 * Compaction configuration options.
 */
export type CompactionConfig = {
  /** Threshold to trigger compaction (0-100), default 80 */
  threshold: number;
  /** Temperature for summarization LLM calls, default 0.3 */
  temperature: number;
};

/**
 * Default compaction configuration.
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  threshold: 80,
  temperature: 0.3,
};

/**
 * System prompt for the summarizer.
 * Focused on extracting actionable context for the coding agent.
 */
const SUMMARIZER_SYSTEM_PROMPT = `You are a conversation summarizer for an AI coding assistant.
Your job is to create a detailed summary that preserves the essential context needed to continue the conversation.

Produce a structured summary with these sections:

## Task
What the user asked for and the overall goal.

## Completed
What was accomplished, with specific file paths, function names, and changes made.

## Current State
Where things stand right now — what's working, what's partially done.

## Remaining
What still needs to be done, if anything was mentioned.

## Key Decisions
Important choices made and their rationale (if any).

## Errors & Fixes
Any errors encountered and how they were resolved.

Be specific about file paths, function names, and technical details.
Do NOT include greetings, filler, or meta-commentary.
Write in past tense as a factual record.`;

/**
 * Maximum character budget for the conversation text sent to the summarizer.
 * This prevents the summarizer call itself from exceeding the context window.
 * ~60k chars ≈ ~20k tokens, leaving room for system prompt + output.
 */
const MAX_SUMMARIZER_INPUT_CHARS = 60_000;

/**
 * Build a compact text representation of the conversation for the summarizer.
 *
 * Strategy:
 * - User messages: include full content (usually short)
 * - Assistant messages: include full content (reasoning is important)
 * - Tool messages: heavily truncated — the summarizer only needs to know
 *   what tool was called and a brief result, not 200 lines of file content
 * - Assistant tool_calls: list which tools were called with key args
 *
 * If the total exceeds MAX_SUMMARIZER_INPUT_CHARS, progressively truncate
 * from the oldest messages.
 */
function buildSummarizerInput(messages: Message[]): string {
  const parts: string[] = [];

  for (const m of messages) {
    const _role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
    const content = m.content ?? '';

    if (m.role === 'tool') {
      // Tool results: very brief — first 200 chars + line count
      const lineCount = content.split('\n').length;
      const preview = content.slice(0, 200);
      const truncated =
        content.length > 200
          ? `${preview}... (${lineCount} lines total)`
          : preview;
      parts.push(`Tool result: ${truncated}`);
    } else if (
      m.role === 'assistant' &&
      m.tool_calls &&
      m.tool_calls.length > 0
    ) {
      // Assistant with tool calls: show reasoning + which tools were called
      const toolNames = m.tool_calls.map((tc) => {
        const args = tc.function.arguments as Record<string, unknown>;
        // Include key identifying args (path, command, pattern)
        const keyArg =
          args.path ?? args.command ?? args.pattern ?? args.query ?? '';
        const argStr = keyArg ? ` "${String(keyArg).slice(0, 80)}"` : '';
        return `${tc.function.name}${argStr}`;
      });
      const reasoning = content.slice(0, 500);
      parts.push(`Assistant [calls: ${toolNames.join(', ')}]: ${reasoning}`);
    } else if (m.role === 'user') {
      // User messages: include more (usually the task description)
      parts.push(`User: ${content.slice(0, 1000)}`);
    } else if (m.role === 'assistant') {
      // Plain assistant messages: include full reasoning
      parts.push(`Assistant: ${content.slice(0, 1000)}`);
    } else if (m.role === 'system') {
    }
  }

  let result = parts.join('\n\n');

  // If still too large, progressively drop older entries
  if (result.length > MAX_SUMMARIZER_INPUT_CHARS) {
    log(
      `[summarize] Input too large (${result.length} chars), truncating from start`,
    );
    // Keep the first few entries (task context) and the last entries (recent work)
    const keepStart = Math.floor(parts.length * 0.2); // First 20%
    const keepEnd = Math.floor(parts.length * 0.5); // Last 50%
    const startParts = parts.slice(0, keepStart);
    const endParts = parts.slice(parts.length - keepEnd);
    const dropped = parts.length - keepStart - keepEnd;

    result = [
      ...startParts,
      `\n[... ${dropped} messages omitted for brevity ...]\n`,
      ...endParts,
    ].join('\n\n');

    // Final hard cap
    if (result.length > MAX_SUMMARIZER_INPUT_CHARS) {
      result = `${result.slice(0, MAX_SUMMARIZER_INPUT_CHARS)}\n[truncated]`;
    }
  }

  return result;
}

/**
 * Summarize a conversation history using a fresh LLM call.
 *
 * This is the core compaction operation. It sends a compact
 * representation of the conversation to a separate Ollama call
 * (no tools, non-streaming) and returns a structured summary.
 * The caller is responsible for persisting the summary as a message
 * and updating the session's summary pointer.
 *
 * @param messages - Full conversation history in Ollama Message[] format
 * @param model - Model name for the summarization call
 * @param host - Ollama host URL
 * @param temperature - Sampling temperature (default 0.3 for focused output)
 * @returns Summary text, or null if summarization failed
 */
export async function summarizeConversation(
  messages: Message[],
  model: string,
  host: string,
  temperature: number = 0.3,
): Promise<string | null> {
  if (messages.length === 0) return null;

  log(
    `[summarize] Starting summarization of ${messages.length} messages with model ${model}`,
  );

  const conversationText = buildSummarizerInput(messages);
  log(
    `[summarize] Summarizer input: ${conversationText.length} chars from ${messages.length} messages`,
  );

  try {
    const client = new Ollama({ host });
    const response = await client.chat({
      model,
      messages: [
        { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Summarize this coding session conversation:\n\n${conversationText}`,
        },
      ],
      options: {
        temperature,
        num_predict: 2048,
      },
    });

    const summary = response.message.content?.trim();
    if (!summary) {
      log('[summarize] LLM returned empty summary');
      return null;
    }

    log(
      `[summarize] Summary generated: ${summary.length} chars for ${messages.length} messages`,
    );
    return summary;
  } catch (error) {
    log('[summarize] Error during summarization:', error);
    return null;
  }
}

/**
 * Check if compaction is needed based on current usage percentage.
 */
export function needsCompaction(
  usagePercent: number,
  threshold: number = 80,
): boolean {
  return usagePercent >= threshold;
}

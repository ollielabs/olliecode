/**
 * Message conversion utilities.
 * Converts between stored format, Ollama format, and display format.
 */

import type { Message, ToolCall } from 'ollama';
import { COMPACTION_SUMMARY_PREFIX } from '../agent/compaction';
import { TOOL_RESULT_PREFIX } from '../agent/tool-processor';
import type { DisplayMessage } from '../tui/types';
import type {
  CompactionSummaryPart,
  MessagePart,
  StoredMessage,
  ToolPart,
} from './types';

// Re-export DisplayMessage for backward compatibility
export type { DisplayMessage };

/** Regex to match the <attached-files> augmentation block appended by augmentMessageWithFiles */
const ATTACHED_FILES_RE = /\n\n<attached-files>\n([\s\S]*)<\/attached-files>$/;

/** Regex to extract individual file paths from the augmentation block */
const FILE_PATH_RE = /<file path="([^"]+)">/g;

/**
 * Strip the <attached-files> augmentation block from a user message.
 *
 * When @file mentions are persisted with augmented content (file contents
 * baked in), this extracts the clean prompt for display and the file paths
 * for the attachedFiles badge.
 */
export function stripFileAugmentation(content: string): {
  text: string;
  attachedFiles?: string[];
} {
  const match = content.match(ATTACHED_FILES_RE);
  if (!match || match.index === undefined) {
    return { text: content };
  }

  const text = content.slice(0, match.index);
  const filesBlock = match[1] ?? '';
  const files = [...filesBlock.matchAll(FILE_PATH_RE)].map((m) => m[1] ?? '');
  return {
    text,
    attachedFiles: files.length > 0 ? files : undefined,
  };
}

/**
 * Convert stored messages to Ollama format for the agent.
 * This reconstructs the message history that Ollama expects.
 */
export function toOllamaMessages(messages: StoredMessage[]): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      // User messages: combine all text parts
      const textParts = msg.parts.filter(
        (p): p is MessagePart & { type: 'text' } => p.type === 'text',
      );
      const content = textParts.map((p) => p.content).join('\n');
      result.push({ role: 'user', content });
    } else if (msg.role === 'assistant') {
      // Check for compaction summary parts
      const summaryParts = msg.parts.filter(
        (p): p is CompactionSummaryPart => p.type === 'compaction_summary',
      );
      if (summaryParts.length > 0) {
        // Compaction summaries: emit as assistant messages with the prefix
        // so the model sees them as conversation context
        for (const sp of summaryParts) {
          result.push({
            role: 'assistant',
            content: `${COMPACTION_SUMMARY_PREFIX}${sp.compactedCount}]\n${sp.content}`,
          });
        }
        continue;
      }

      // Skip error parts — they're display-only and shouldn't be sent
      // to the model. An error-only message (no text, no tools) is skipped
      // entirely. A message with error + tool parts still emits the tools.
      const hasErrorParts = msg.parts.some((p) => p.type === 'error');

      // Regular assistant messages: extract text and tool parts
      const textParts = msg.parts.filter(
        (p): p is MessagePart & { type: 'text' } => p.type === 'text',
      );
      const toolParts = msg.parts.filter(
        (p): p is ToolPart => p.type === 'tool',
      );

      // If this message only has error parts (no text, no tools), skip it
      if (hasErrorParts && textParts.length === 0 && toolParts.length === 0) {
        continue;
      }

      const content = textParts.map((p) => p.content).join('\n');

      // Convert tool parts to Ollama tool_calls format
      const toolCalls: ToolCall[] = toolParts.map((p) => ({
        function: { name: p.name, arguments: p.args },
      }));

      // Add assistant message with tool calls
      result.push({
        role: 'assistant',
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });

      // Add tool results as separate tool role messages
      for (const tp of toolParts) {
        const state = tp.state;
        let toolContent: string;

        if (state.status === 'completed') {
          toolContent = `${TOOL_RESULT_PREFIX}\n\n${state.output}`;
        } else if (state.status === 'error') {
          toolContent = `Error: ${state.error}`;
        } else if (state.status === 'denied') {
          toolContent = `Error: User denied execution${state.reason ? `: ${state.reason}` : ''}`;
        } else if (state.status === 'blocked') {
          toolContent = `Error: Blocked - ${state.reason}`;
        } else {
          // pending, confirming, executing - shouldn't be stored, but handle gracefully
          toolContent = 'Tool execution incomplete';
        }

        result.push({
          role: 'tool',
          content: toolContent,
        });
      }
    } else if (msg.role === 'system') {
      // System messages: combine all text parts
      const textParts = msg.parts.filter(
        (p): p is MessagePart & { type: 'text' } => p.type === 'text',
      );
      const content = textParts.map((p) => p.content).join('\n');
      result.push({ role: 'system', content });
    }
  }

  return result;
}

/**
 * Convert stored messages to display format for TUI.
 * Each part becomes a separate display message, in stored order.
 */
export function toDisplayMessages(messages: StoredMessage[]): DisplayMessage[] {
  const result: DisplayMessage[] = [];

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'compaction_summary') {
        result.push({
          type: 'compaction_summary',
          content: part.content,
          compactedCount: part.compactedCount,
        });
      } else if (part.type === 'error') {
        result.push({
          type: 'error',
          errorType: part.errorType,
          content: part.content,
        });
      } else if (part.type === 'text' && part.content.trim()) {
        if (msg.role === 'user') {
          // Strip augmented file contents for display, extract file paths
          const { text, attachedFiles } = stripFileAugmentation(part.content);
          result.push({ type: 'user', content: text, attachedFiles });
        } else if (msg.role === 'assistant') {
          result.push({ type: 'assistant', content: part.content });
        }
        // System messages are not displayed in the UI
      } else if (part.type === 'tool') {
        // Unified tool message - pass through directly
        result.push({
          type: 'tool',
          id: part.id,
          name: part.name,
          args: part.args,
          state: part.state,
        });
      }
    }
  }

  return result;
}

/** Regex to parse the compaction summary prefix: `[compaction:N]\n` */
const COMPACTION_PREFIX_RE = /^\[compaction:(\d+)\]\n([\s\S]*)$/;

/** Valid StoredMessage roles */
const VALID_ROLES = new Set<StoredMessage['role']>([
  'user',
  'assistant',
  'system',
]);

/**
 * Parse tool result content back into a ToolState.
 *
 * Reverses the encoding in toOllamaMessages():
 * - `TOOL_RESULT_PREFIX\n\noutput` → completed with output
 * - `Error: User denied...` → denied
 * - `Error: Blocked - ...` → blocked
 * - `Error: ...` → error
 * - anything else → completed (treat as raw output)
 */
function parseToolResultContent(content: string): ToolPart['state'] {
  if (content.startsWith(TOOL_RESULT_PREFIX)) {
    // Strip prefix + the two newlines that follow it
    const output = content
      .slice(TOOL_RESULT_PREFIX.length)
      .replace(/^\n\n/, '');
    return { status: 'completed', output };
  }
  if (content.startsWith('Error: User denied')) {
    return { status: 'denied', reason: content };
  }
  if (content.startsWith('Error: Blocked')) {
    return {
      status: 'blocked',
      reason: content.replace(/^Error: Blocked - /, ''),
    };
  }
  if (content.startsWith('Error: ')) {
    return { status: 'error', error: content.replace(/^Error: /, '') };
  }
  // Fallback: treat as completed output (e.g., truncated tool output after compaction)
  return { status: 'completed', output: content };
}

/**
 * Convert Ollama messages back to StoredMessage format.
 *
 * Used for compaction snapshots — compacted Message[] needs to be stored
 * as StoredMessage[] so it can be loaded via getActiveMessages.
 *
 * This is the inverse of toOllamaMessages(). It:
 * - Detects compaction summaries (via COMPACTION_SUMMARY_PREFIX) and stores
 *   them as CompactionSummaryPart.
 * - Reconstructs ToolParts from assistant messages with tool_calls and
 *   their following role:'tool' result messages. This is critical —
 *   without it, tool call history is silently lost after compaction.
 * - Filters out orphaned role:'tool' messages (those not following an
 *   assistant with tool_calls).
 */
export function fromOllamaMessages(messages: Message[]): StoredMessage[] {
  const baseTimestamp = Date.now();
  const result: StoredMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    if (!msg) {
      i++;
      continue;
    }

    const content = msg.content ?? '';
    const role = msg.role as string;

    // Skip orphaned tool messages (not following an assistant with tool_calls)
    if (role === 'tool') {
      i++;
      continue;
    }

    // Skip invalid roles
    if (!VALID_ROLES.has(role as StoredMessage['role'])) {
      i++;
      continue;
    }

    // --- Compaction summary ---
    if (role === 'assistant') {
      const compactionMatch = content.match(COMPACTION_PREFIX_RE);
      if (compactionMatch) {
        const compactedCount = Number.parseInt(compactionMatch[1] ?? '0', 10);
        const summaryContent = compactionMatch[2] ?? '';
        result.push({
          id: `compacted_${i}`,
          sessionId: '',
          role: 'assistant',
          parts: [
            {
              type: 'compaction_summary',
              content: summaryContent,
              compactedCount,
            },
          ],
          createdAt: baseTimestamp + i,
        });
        i++;
        continue;
      }
    }

    // --- Assistant with tool_calls: reconstruct ToolParts ---
    if (role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const parts: MessagePart[] = [];

      // Consume following role:'tool' messages — one per tool_call
      const toolCalls = msg.tool_calls;
      let toolResultIndex = i + 1;

      for (let tc = 0; tc < toolCalls.length; tc++) {
        const call = toolCalls[tc];
        if (!call) continue;

        const toolName = call.function.name;
        const toolArgs = (call.function.arguments ?? {}) as Record<
          string,
          unknown
        >;

        // Try to find the matching tool result message
        let state: ToolPart['state'];
        const toolResultMsg = messages[toolResultIndex];
        if (toolResultMsg && toolResultMsg.role === 'tool') {
          state = parseToolResultContent(toolResultMsg.content ?? '');
          toolResultIndex++;
        } else {
          // No matching result — mark as completed with empty output
          // (can happen if compaction truncated the tail)
          state = {
            status: 'completed',
            output: '[result unavailable after compaction]',
          };
        }

        parts.push({
          type: 'tool',
          id: `compacted_${i}_tool_${tc}`,
          name: toolName,
          args: toolArgs,
          state,
        });
      }

      // Add text content if present
      if (content.trim()) {
        parts.push({ type: 'text', content });
      }

      result.push({
        id: `compacted_${i}`,
        sessionId: '',
        role: 'assistant',
        parts,
        createdAt: baseTimestamp + i,
      });

      // Advance past the assistant + all consumed tool results
      i = toolResultIndex;
      continue;
    }

    // --- Plain message (user, system, assistant without tool_calls) ---
    result.push({
      id: `compacted_${i}`,
      sessionId: '',
      role: role as StoredMessage['role'],
      parts: [{ type: 'text' as const, content }],
      createdAt: baseTimestamp + i,
    });
    i++;
  }

  return result;
}

/**
 * Create a message parts array from user input text.
 */
export function fromUserInput(content: string): MessagePart[] {
  return [{ type: 'text', content }];
}

/**
 * Create a message parts array from assistant response.
 * Combines tool parts (in call order) and final text.
 */
export function fromAssistantResponse(
  content: string,
  toolParts: ToolPart[] = [],
): MessagePart[] {
  const parts: MessagePart[] = [];

  // Store tool parts first so replay order matches live tool execution
  parts.push(...toolParts);

  // Final assistant text comes after tools
  if (content.trim()) {
    parts.push({ type: 'text', content });
  }

  return parts;
}

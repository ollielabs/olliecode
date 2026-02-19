/**
 * Message conversion utilities.
 * Converts between stored format, Ollama format, and display format.
 */

import type { Message, ToolCall } from 'ollama';
import { TOOL_RESULT_PREFIX } from '../agent/tool-processor';
import type { DisplayMessage } from '../tui/types';
import type { MessagePart, StoredMessage, ToolPart } from './types';

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
      // Assistant messages: extract text and tool parts
      const textParts = msg.parts.filter(
        (p): p is MessagePart & { type: 'text' } => p.type === 'text',
      );
      const toolParts = msg.parts.filter(
        (p): p is ToolPart => p.type === 'tool',
      );

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
      if (part.type === 'text' && part.content.trim()) {
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

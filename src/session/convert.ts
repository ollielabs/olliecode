/**
 * Message conversion utilities.
 * Converts between stored format, Ollama format, and display format.
 */

import type { Message, ToolCall } from "ollama";
import type { StoredMessage, MessagePart } from "./types";

/**
 * Display message type for TUI rendering.
 * Matches the DisplayMessage type in src/tui/index.tsx.
 */
export type DisplayMessage =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string; error?: string };

/**
 * Convert stored messages to Ollama format for the agent.
 * This reconstructs the message history that Ollama expects.
 */
export function toOllamaMessages(messages: StoredMessage[]): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      // User messages: combine all text parts
      const textParts = msg.parts.filter((p): p is MessagePart & { type: "text" } => p.type === "text");
      const content = textParts.map((p) => p.content).join("\n");
      result.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      // Assistant messages: extract text and tool calls
      const textParts = msg.parts.filter((p): p is MessagePart & { type: "text" } => p.type === "text");
      const toolCallParts = msg.parts.filter((p): p is MessagePart & { type: "tool_call" } => p.type === "tool_call");
      const toolResultParts = msg.parts.filter((p): p is MessagePart & { type: "tool_result" } => p.type === "tool_result");

      const content = textParts.map((p) => p.content).join("\n");
      const toolCalls: ToolCall[] = toolCallParts.map((p) => ({
        function: { name: p.name, arguments: p.args },
      }));

      // Add assistant message with tool calls
      result.push({
        role: "assistant",
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });

      // Add tool results as separate tool role messages
      for (const tr of toolResultParts) {
        result.push({
          role: "tool",
          content: tr.error ? `Error: ${tr.error}` : tr.output,
        });
      }
    } else if (msg.role === "system") {
      // System messages: combine all text parts
      const textParts = msg.parts.filter((p): p is MessagePart & { type: "text" } => p.type === "text");
      const content = textParts.map((p) => p.content).join("\n");
      result.push({ role: "system", content });
    }
  }

  return result;
}

/**
 * Convert stored messages to display format for TUI.
 * Each part becomes a separate display message.
 */
export function toDisplayMessages(messages: StoredMessage[]): DisplayMessage[] {
  const result: DisplayMessage[] = [];

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "text" && part.content.trim()) {
        if (msg.role === "user") {
          result.push({ type: "user", content: part.content });
        } else if (msg.role === "assistant") {
          result.push({ type: "assistant", content: part.content });
        }
        // System messages are not displayed in the UI
      } else if (part.type === "tool_call") {
        result.push({
          type: "tool_call",
          name: part.name,
          args: part.args,
        });
      } else if (part.type === "tool_result") {
        result.push({
          type: "tool_result",
          name: part.name,
          output: part.output,
          error: part.error,
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
  return [{ type: "text", content }];
}

/**
 * Create a message parts array from assistant response.
 * Combines text content, tool calls, and tool results into a single parts array.
 */
export function fromAssistantResponse(
  content: string,
  toolCalls?: { name: string; args: Record<string, unknown> }[],
  toolResults?: { name: string; output: string; error?: string }[]
): MessagePart[] {
  const parts: MessagePart[] = [];

  // Add text content if present
  if (content.trim()) {
    parts.push({ type: "text", content });
  }

  // Add tool calls
  if (toolCalls) {
    for (const tc of toolCalls) {
      parts.push({ type: "tool_call", name: tc.name, args: tc.args });
    }
  }

  // Add tool results
  if (toolResults) {
    for (const tr of toolResults) {
      parts.push({
        type: "tool_result",
        name: tr.name,
        output: tr.output,
        error: tr.error,
      });
    }
  }

  return parts;
}

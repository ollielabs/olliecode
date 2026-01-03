/**
 * Message conversion utilities.
 * Converts between stored format, Ollama format, and display format.
 */

import type { Message, ToolCall } from "ollama";
import type { StoredMessage, MessagePart, ToolPart } from "./types";
import type { DisplayMessage } from "../tui/types";

// Re-export DisplayMessage for backward compatibility
export type { DisplayMessage };

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
      // Assistant messages: extract text and tool parts
      const textParts = msg.parts.filter((p): p is MessagePart & { type: "text" } => p.type === "text");
      const toolParts = msg.parts.filter((p): p is ToolPart => p.type === "tool");

      const content = textParts.map((p) => p.content).join("\n");
      
      // Convert tool parts to Ollama tool_calls format
      const toolCalls: ToolCall[] = toolParts.map((p) => ({
        function: { name: p.name, arguments: p.args },
      }));

      // Add assistant message with tool calls
      result.push({
        role: "assistant",
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });

      // Add tool results as separate tool role messages
      for (const tp of toolParts) {
        const state = tp.state;
        let toolContent: string;
        
        if (state.status === "completed") {
          toolContent = state.output;
        } else if (state.status === "error") {
          toolContent = `Error: ${state.error}`;
        } else if (state.status === "denied") {
          toolContent = `Error: User denied execution${state.reason ? `: ${state.reason}` : ""}`;
        } else if (state.status === "blocked") {
          toolContent = `Error: Blocked - ${state.reason}`;
        } else {
          // pending, confirming, executing - shouldn't be stored, but handle gracefully
          toolContent = "Tool execution incomplete";
        }
        
        result.push({
          role: "tool",
          content: toolContent,
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
      } else if (part.type === "tool") {
        // Unified tool message - pass through directly
        result.push({
          type: "tool",
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
  return [{ type: "text", content }];
}

/**
 * Create a message parts array from assistant response.
 * Combines text content and tool parts into a single parts array.
 */
export function fromAssistantResponse(
  content: string,
  toolParts?: ToolPart[]
): MessagePart[] {
  const parts: MessagePart[] = [];

  // Add text content if present
  if (content.trim()) {
    parts.push({ type: "text", content });
  }

  // Add tool parts
  if (toolParts) {
    for (const tp of toolParts) {
      parts.push(tp);
    }
  }

  return parts;
}

/**
 * Shared types for TUI components and hooks.
 */

import type { TextareaRenderable } from "@opentui/core";
import type { Message } from "ollama";
import type { AgentMode } from "../agent/modes";
import type { ConfirmationRequest, ConfirmationResponse } from "../agent/safety/types";
import type { ContextStats } from "../lib/tokenizer";
import type { Session } from "../session";
import type { Todo } from "../session/todo";

/**
 * Status of the agent/UI.
 */
export type Status = "idle" | "thinking" | "error";

/**
 * Display message for TUI rendering.
 * Each message type has a different visual representation.
 */
export type DisplayMessage =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string; error?: string; args?: Record<string, unknown> };

/**
 * Props for the main App component.
 */
export type AppProps = {
  model: string;
  host: string;
  projectPath: string;
  initialSessionId?: string;
  initialTheme?: string;
};

/**
 * Ref type for textarea access.
 */
export type TextareaRef = React.RefObject<TextareaRenderable | null>;

/**
 * Ref type for status access in callbacks.
 */
export type StatusRef = React.RefObject<Status>;

// Re-export commonly used types for convenience
export type {
  Session,
  Todo,
  ContextStats,
  AgentMode,
  ConfirmationRequest,
  ConfirmationResponse,
  Message,
  TextareaRenderable,
};

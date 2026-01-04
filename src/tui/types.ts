/**
 * Shared types for TUI components and hooks.
 */

import type { TextareaRenderable } from "@opentui/core";
import type { Message } from "ollama";
import type { AgentMode } from "../agent/modes";
import type { ConfirmationRequest, ConfirmationResponse, ConfirmationPreview } from "../agent/safety/types";
import type { ContextStats } from "../lib/tokenizer";
import type { Session } from "../session";
import type { Todo } from "../session/todo";

/**
 * Status of the agent/UI.
 */
export type Status = "idle" | "thinking" | "error";

/**
 * State machine for tool execution.
 * A tool progresses through these states during its lifecycle.
 */
export type ToolState =
  | { status: "pending" }
  | { status: "confirming"; preview?: ConfirmationPreview }
  | { status: "executing" }
  | { status: "completed"; output: string; metadata?: ToolMetadata }
  | { status: "error"; error: string }
  | { status: "denied"; reason?: string }
  | { status: "blocked"; reason: string };

/**
 * Metadata for completed tool executions.
 * Tool-specific data that persists for display purposes.
 */
export type ToolMetadata = {
  /** Unified diff string for file operations (edit_file, write_file) */
  diff?: string;
  /** File path for file operations */
  filePath?: string;
  /** Whether this is a new file (write_file) */
  isNewFile?: boolean;
  /** Exit code for run_command */
  exitCode?: number;
  /** Match count for glob/grep */
  matchCount?: number;
  /** Line count for read_file */
  lineCount?: number;
};

/**
 * Unified tool message for display.
 * Represents a single tool operation that evolves through states.
 */
export type ToolDisplayMessage = {
  type: "tool";
  /** Unique identifier for this tool operation */
  id: string;
  /** Tool name (e.g., "edit_file", "run_command") */
  name: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Current state of the tool operation */
  state: ToolState;
};

/**
 * Display message for TUI rendering.
 * Each message type has a different visual representation.
 */
export type DisplayMessage =
  | { type: "user"; content: string; attachedFiles?: string[] }
  | { type: "assistant"; content: string }
  | ToolDisplayMessage;

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

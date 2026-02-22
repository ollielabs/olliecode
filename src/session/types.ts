/**
 * Session persistence types.
 */

import type { AgentMode } from '../agent/modes';
import type { ToolState } from '../tui/types';

/**
 * Unified tool part for storage.
 * Represents a complete tool operation with its final state.
 */
export type ToolPart = {
  type: 'tool';
  /** Unique identifier for this tool operation */
  id: string;
  /** Tool name (e.g., "edit_file", "run_command") */
  name: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Final state of the tool operation */
  state: ToolState;
};

/**
 * Compaction summary part — identifies a message as a compaction artifact.
 * Stored as a distinct part type so it can be identified throughout the
 * pipeline: storage, Ollama conversion, display rendering, and undo-compact.
 */
export type CompactionSummaryPart = {
  type: 'compaction_summary';
  /** The LLM-generated summary content */
  content: string;
  /** Number of messages that were compacted into this summary */
  compactedCount: number;
};

/**
 * Error part — persists agent-level errors as chat history.
 * Stored on assistant messages so errors survive session reload
 * and render inline in the conversation.
 */
export type ErrorPart = {
  type: 'error';
  /** Error category (model_error, max_iterations, loop_detected, tool_error) */
  errorType: string;
  /** Full error message */
  content: string;
};

/**
 * Message part types (stored as JSON in `parts` column).
 * This is the source of truth for both Ollama messages and display UI.
 */
export type MessagePart =
  | { type: 'text'; content: string }
  | ToolPart
  | CompactionSummaryPart
  | ErrorPart;

/**
 * Stored message (maps to DB row).
 */
export type StoredMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  createdAt: number;
};

/**
 * Session (maps to DB row).
 */
export type Session = {
  id: string;
  projectPath: string;
  projectName: string | null;
  title: string | null;
  mode: AgentMode;
  model: string;
  host: string;
  messageCount: number;
  /** ID of the latest compaction summary message, or null if no summary exists */
  summaryMessageId: string | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * Options for creating a new session.
 */
export type CreateSessionOptions = {
  projectPath: string;
  model: string;
  host: string;
  mode: AgentMode;
};

/**
 * Options for listing sessions.
 */
export type ListSessionsOptions = {
  projectPath?: string;
  limit?: number;
};

/**
 * Options for updating a session.
 */
export type UpdateSessionOptions = {
  title?: string;
  mode?: AgentMode;
};

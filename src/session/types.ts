/**
 * Session persistence types.
 */

import type { AgentMode } from "../agent/modes";

/**
 * Message part types (stored as JSON in `parts` column).
 * This is the source of truth for both Ollama messages and display UI.
 */
export type MessagePart =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string; error?: string };

/**
 * Stored message (maps to DB row).
 */
export type StoredMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
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

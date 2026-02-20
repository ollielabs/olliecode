/**
 * Shared types for TUI components and hooks.
 */

import type { TextareaRenderable } from '@opentui/core';
import type { Message } from 'ollama';
import type { AgentMode } from '../agent/modes';
import type {
  ConfirmationPreview,
  ConfirmationRequest,
  ConfirmationResponse,
} from '../agent/safety/types';
import type { ConfigLayer } from '../config/merge';
import type { ResolvedConfig } from '../config/schema';
import type { ContextStats } from '../lib/tokenizer';
import type { Session } from '../session';
import type { Todo } from '../session/todo';

/**
 * Status of the agent/UI.
 */
export type Status = 'idle' | 'thinking' | 'error';

/**
 * State machine for tool execution.
 * A tool progresses through these states during its lifecycle.
 */
export type ToolState =
  | { status: 'pending' }
  | { status: 'confirming'; preview?: ConfirmationPreview }
  | { status: 'executing' }
  | { status: 'completed'; output: string; metadata?: ToolMetadata }
  | { status: 'error'; error: string }
  | { status: 'denied'; reason?: string }
  | { status: 'blocked'; reason: string };

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
  type: 'tool';
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
 * Compaction summary display message.
 * Rendered as a visually distinct separator in the chat with the
 * LLM-generated summary content.
 */
export type CompactionSummaryDisplayMessage = {
  type: 'compaction_summary';
  /** The LLM-generated summary content */
  content: string;
  /** Number of messages that were compacted */
  compactedCount: number;
};

/**
 * Display message for TUI rendering.
 * Each message type has a different visual representation.
 */
export type DisplayMessage =
  | { type: 'user'; content: string; attachedFiles?: string[] }
  | { type: 'assistant'; content: string }
  | ToolDisplayMessage
  | CompactionSummaryDisplayMessage;

/**
 * Props for the main App component.
 */
export type AppProps = {
  config: ResolvedConfig;
  /** Config layers from merge (for /config command) */
  configLayers?: ConfigLayer[];
  /** Config warnings from merge (for /config command) */
  configWarnings?: string[];
  projectPath: string;
  initialSessionId?: string;
};

/**
 * Ref type for textarea access.
 * In Solid, refs are plain variables — no .current wrapper.
 */
export type TextareaRef = TextareaRenderable | undefined;

/**
 * Ref type for status access in callbacks.
 * In Solid, signals always return current values — this type is kept
 * for compatibility but refs are no longer needed for status.
 */
export type StatusRef = Status;

// Re-export commonly used types for convenience
export type {
  ConfigLayer,
  Session,
  Todo,
  ContextStats,
  AgentMode,
  ConfirmationRequest,
  ConfirmationResponse,
  Message,
  TextareaRenderable,
};

/**
 * Type definitions for observational memory.
 *
 * Observations are structured facts extracted from tool call results.
 * Phase 0 uses programmatic extraction only (zero LLM cost).
 * The `source` field future-proofs for LLM-based extraction in a fast-follow.
 */

/**
 * Types of observations that can be extracted from tool calls.
 * Each type maps to one or more tool names.
 */
export type ObservationType =
  | 'file_modified' // edit_file
  | 'file_read' // read_file
  | 'file_created' // write_file
  | 'command_run' // run_command (success)
  | 'command_error' // run_command (non-zero exit or error)
  | 'search_performed' // glob, grep
  | 'todo_updated' // todo_write
  | 'task_delegated'; // task (subagent)

/**
 * A single observation extracted from a tool call result.
 *
 * Observations are standalone facts meaningful without surrounding conversation:
 * - "Modified src/agent/index.ts"
 * - "Ran: bun check:types → exit 0"
 * - "Failed: bun test → exit 1: TypeError..."
 */
export type Observation = {
  /** Unique identifier (randomUUID) */
  id: string;
  /** Session this observation belongs to */
  sessionId: string;
  /** Category of observation */
  type: ObservationType;
  /** Human-readable description */
  content: string;
  /** Structured data (path, command, exitCode, etc.) */
  metadata: Record<string, unknown>;
  /** Importance score 1-10 (hardcoded per extractor in Phase 0) */
  importance: number;
  /** Extraction method — programmatic (Phase 0) or llm (fast-follow) */
  source: 'programmatic' | 'llm';
  /** Epoch milliseconds when extracted */
  createdAt: number;
};

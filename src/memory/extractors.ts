/**
 * Programmatic observation extractors for tool call results.
 *
 * Pure functions that map (toolName, args, result) → Observation[].
 * Zero LLM cost, <1ms per call, deterministic.
 *
 * Each extractor handles one tool type and produces typed observations
 * with hardcoded importance scores.
 */

import { randomUUID } from 'node:crypto';
import type { Observation, ObservationType } from './types';

/** Tool result shape (matches ToolResult from agent/types.ts) */
type ToolResultInput = {
  output: string;
  error?: string;
};

/** Maximum length for error content in observations */
const MAX_ERROR_CONTENT_LENGTH = 200;

/** Create an observation with common defaults */
function createObservation(
  sessionId: string,
  type: ObservationType,
  content: string,
  importance: number,
  metadata: Record<string, unknown>,
): Observation {
  return {
    id: randomUUID(),
    sessionId,
    type,
    content,
    metadata,
    importance,
    source: 'programmatic',
    createdAt: Date.now(),
  };
}

/**
 * Extract observations from an edit_file tool call.
 */
function extractEditFile(
  args: Record<string, unknown>,
  _result: ToolResultInput,
  sessionId: string,
): Observation[] {
  const path = typeof args.path === 'string' ? args.path : 'unknown';
  return [
    createObservation(sessionId, 'file_modified', `Modified ${path}`, 7, {
      path,
      action: 'edit',
    }),
  ];
}

/**
 * Extract observations from a write_file tool call.
 */
function extractWriteFile(
  args: Record<string, unknown>,
  _result: ToolResultInput,
  sessionId: string,
): Observation[] {
  const path = typeof args.path === 'string' ? args.path : 'unknown';
  return [
    createObservation(sessionId, 'file_created', `Created ${path}`, 7, {
      path,
      action: 'write',
    }),
  ];
}

/**
 * Extract observations from a read_file tool call.
 */
function extractReadFile(
  args: Record<string, unknown>,
  _result: ToolResultInput,
  sessionId: string,
): Observation[] {
  const path = typeof args.path === 'string' ? args.path : 'unknown';
  return [
    createObservation(sessionId, 'file_read', `Read ${path}`, 3, { path }),
  ];
}

/**
 * Parse the JSON output from run_command to extract exit code and stderr.
 * The run_command tool returns JSON.stringify({ stdout, stderr, exitCode }).
 */
function parseCommandOutput(output: string): {
  exitCode: number | null;
  stderr: string;
  stdout: string;
} {
  try {
    const parsed = JSON.parse(output) as {
      exitCode?: number;
      stderr?: string;
      stdout?: string;
    };
    return {
      exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : null,
      stderr: typeof parsed.stderr === 'string' ? parsed.stderr : '',
      stdout: typeof parsed.stdout === 'string' ? parsed.stdout : '',
    };
  } catch {
    return { exitCode: null, stderr: '', stdout: '' };
  }
}

/**
 * Extract observations from a run_command tool call.
 * Produces command_run (success) or command_error (failure).
 */
function extractRunCommand(
  args: Record<string, unknown>,
  result: ToolResultInput,
  sessionId: string,
): Observation[] {
  const command = typeof args.command === 'string' ? args.command : 'unknown';

  // Handle tool-level errors (e.g., permission denied, timeout)
  if (result.error) {
    const errorSnippet = result.error.slice(0, MAX_ERROR_CONTENT_LENGTH);
    return [
      createObservation(
        sessionId,
        'command_error',
        `Failed: ${command} — ${errorSnippet}`,
        8,
        { command, error: result.error },
      ),
    ];
  }

  const parsed = parseCommandOutput(result.output);

  if (parsed.exitCode !== null && parsed.exitCode !== 0) {
    const errorText =
      parsed.stderr.trim() || parsed.stdout.slice(0, MAX_ERROR_CONTENT_LENGTH);
    const errorSnippet = errorText.slice(0, MAX_ERROR_CONTENT_LENGTH);
    return [
      createObservation(
        sessionId,
        'command_error',
        `Failed: ${command} → exit ${parsed.exitCode}: ${errorSnippet}`,
        8,
        {
          command,
          exitCode: parsed.exitCode,
          error: errorText,
        },
      ),
    ];
  }

  const exitDisplay =
    parsed.exitCode !== null ? ` → exit ${parsed.exitCode}` : '';
  return [
    createObservation(
      sessionId,
      'command_run',
      `Ran: ${command}${exitDisplay}`,
      4,
      {
        command,
        exitCode: parsed.exitCode,
      },
    ),
  ];
}

/**
 * Count lines in tool output to estimate result count.
 * Glob/grep tools return one result per line.
 */
function countOutputLines(output: string): number {
  if (!output.trim()) return 0;
  return output.trim().split('\n').length;
}

/**
 * Extract observations from a glob tool call.
 */
function extractGlob(
  args: Record<string, unknown>,
  result: ToolResultInput,
  sessionId: string,
): Observation[] {
  const pattern = typeof args.pattern === 'string' ? args.pattern : 'unknown';
  const resultCount = countOutputLines(result.output);
  return [
    createObservation(
      sessionId,
      'search_performed',
      `Glob ${pattern} → ${resultCount} files`,
      3,
      { tool: 'glob', pattern, resultCount },
    ),
  ];
}

/**
 * Extract observations from a grep tool call.
 */
function extractGrep(
  args: Record<string, unknown>,
  result: ToolResultInput,
  sessionId: string,
): Observation[] {
  const pattern = typeof args.pattern === 'string' ? args.pattern : 'unknown';
  const resultCount = countOutputLines(result.output);
  return [
    createObservation(
      sessionId,
      'search_performed',
      `Grep "${pattern}" → ${resultCount} matches`,
      3,
      { tool: 'grep', pattern, resultCount },
    ),
  ];
}

/**
 * Extract observations from a todo_write tool call.
 * Parses the output to summarize todo state changes.
 */
function extractTodoWrite(
  args: Record<string, unknown>,
  _result: ToolResultInput,
  sessionId: string,
): Observation[] {
  // The args contain the full todo list; summarize by status
  const todos = Array.isArray(args.todos) ? args.todos : [];
  const counts: Record<string, number> = {};

  for (const todo of todos) {
    const status =
      typeof (todo as Record<string, unknown>).status === 'string'
        ? ((todo as Record<string, unknown>).status as string)
        : 'unknown';
    counts[status] = (counts[status] ?? 0) + 1;
  }

  const parts = Object.entries(counts)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');

  return [
    createObservation(
      sessionId,
      'todo_updated',
      `Updated todos: ${parts || 'empty'}`,
      5,
      { todoCounts: counts, totalTodos: todos.length },
    ),
  ];
}

/**
 * Extract observations from a task (subagent) tool call.
 */
function extractTask(
  args: Record<string, unknown>,
  _result: ToolResultInput,
  sessionId: string,
): Observation[] {
  const description =
    typeof args.description === 'string'
      ? args.description
      : typeof args.prompt === 'string'
        ? (args.prompt as string).slice(0, 100)
        : 'unknown task';

  return [
    createObservation(
      sessionId,
      'task_delegated',
      `Delegated: ${description}`,
      5,
      {
        description,
        thoroughness:
          typeof args.thoroughness === 'string' ? args.thoroughness : undefined,
      },
    ),
  ];
}

/** Registry mapping tool names to their extractors */
const EXTRACTORS: Record<
  string,
  (
    args: Record<string, unknown>,
    result: ToolResultInput,
    sessionId: string,
  ) => Observation[]
> = {
  edit_file: extractEditFile,
  write_file: extractWriteFile,
  read_file: extractReadFile,
  run_command: extractRunCommand,
  glob: extractGlob,
  grep: extractGrep,
  todo_write: extractTodoWrite,
  task: extractTask,
};

/**
 * Extract observations from a tool call result.
 *
 * Returns an empty array for unrecognized tools or when a tool call
 * was denied/blocked (error containing 'User denied' or 'BLOCKED').
 *
 * @param toolName - The tool that was called
 * @param args - Arguments passed to the tool
 * @param result - Tool result (output and optional error)
 * @param sessionId - Current session ID
 * @returns Array of observations (may be empty)
 */
export function extractObservations(
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResultInput,
  sessionId: string,
): Observation[] {
  // Don't extract observations for denied or blocked tool calls
  if (
    result.error &&
    (result.error.includes('User denied') || result.error.includes('BLOCKED'))
  ) {
    return [];
  }

  const extractor = EXTRACTORS[toolName];
  if (!extractor) {
    return [];
  }

  return extractor(args, result, sessionId);
}

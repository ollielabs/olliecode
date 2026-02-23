/**
 * Unit tests for observational memory.
 *
 * Tests cover:
 * 1. Extractors — pure function tests, no DB needed
 * 2. Store — SQLite round-trip tests with in-memory DB
 * 3. Observation block builder — formatting, deduplication, token budget
 *
 * Run with: bun test ./tests/test-memory.ts
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { extractObservations } from '../src/memory/extractors';
import {
  addObservations,
  clearObservations,
  getLatestObservationTimestamp,
  getObservationsBySession,
  getRecentObservations,
} from '../src/memory/store';
import type { Observation } from '../src/memory/types';
import { buildObservationBlock } from '../src/memory/working-memory';
import { setDatabaseForTesting } from '../src/session/db';

// === Test helpers ===

const SESSION_ID = 'test-session-001';
const SESSION_ID_2 = 'test-session-002';

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: randomUUID(),
    sessionId: SESSION_ID,
    type: 'file_modified',
    content: 'Modified src/test.ts',
    metadata: { path: 'src/test.ts' },
    importance: 7,
    source: 'programmatic',
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Set up an in-memory DB with the required schema for observation tests */
function setupTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      project_name TEXT,
      title TEXT,
      mode TEXT NOT NULL DEFAULT 'build',
      model TEXT NOT NULL,
      host TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      summary_message_id TEXT
    );

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      importance INTEGER NOT NULL DEFAULT 5,
      source TEXT NOT NULL DEFAULT 'programmatic',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_observations_session
      ON observations(session_id);
    CREATE INDEX IF NOT EXISTS idx_observations_session_type
      ON observations(session_id, type);
    CREATE INDEX IF NOT EXISTS idx_observations_session_importance
      ON observations(session_id, importance DESC);
  `);

  const now = Date.now();
  db.run(
    `INSERT INTO sessions (id, project_path, mode, model, host, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [SESSION_ID, '/test', 'build', 'test-model', 'http://localhost', now, now],
  );
  db.run(
    `INSERT INTO sessions (id, project_path, mode, model, host, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      SESSION_ID_2,
      '/test2',
      'build',
      'test-model',
      'http://localhost',
      now,
      now,
    ],
  );

  return db;
}

// === Extractors ===

describe('extractObservations', () => {
  describe('edit_file', () => {
    test('produces file_modified observation', () => {
      const result = extractObservations(
        'edit_file',
        { path: 'src/agent/index.ts', oldString: 'a', newString: 'b' },
        { output: 'File edited successfully' },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('file_modified');
      expect(result[0]!.content).toBe('Modified src/agent/index.ts');
      expect(result[0]!.importance).toBe(7);
      expect(result[0]!.metadata.path).toBe('src/agent/index.ts');
      expect(result[0]!.source).toBe('programmatic');
      expect(result[0]!.sessionId).toBe(SESSION_ID);
    });

    test('generates valid UUID', () => {
      const result = extractObservations(
        'edit_file',
        { path: 'test.ts' },
        { output: 'ok' },
        SESSION_ID,
      );
      expect(result[0]!.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe('write_file', () => {
    test('produces file_created observation', () => {
      const result = extractObservations(
        'write_file',
        { path: 'src/memory/types.ts', content: 'export type Foo = {}' },
        { output: 'File written' },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('file_created');
      expect(result[0]!.content).toBe('Created src/memory/types.ts');
      expect(result[0]!.importance).toBe(7);
    });
  });

  describe('read_file', () => {
    test('produces file_read with importance 3', () => {
      const result = extractObservations(
        'read_file',
        { path: 'src/agent/index.ts' },
        { output: 'file contents...' },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('file_read');
      expect(result[0]!.importance).toBe(3);
    });
  });

  describe('run_command', () => {
    test('success produces command_run with importance 4', () => {
      const result = extractObservations(
        'run_command',
        { command: 'bun check:types' },
        {
          output: JSON.stringify({
            stdout: 'No errors',
            stderr: '',
            exitCode: 0,
          }),
        },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('command_run');
      expect(result[0]!.importance).toBe(4);
      expect(result[0]!.content).toContain('bun check:types');
      expect(result[0]!.content).toContain('exit 0');
    });

    test('failure produces command_error with importance 8', () => {
      const result = extractObservations(
        'run_command',
        { command: 'bun test' },
        {
          output: JSON.stringify({
            stdout: '',
            stderr: 'TypeError: Cannot read property',
            exitCode: 1,
          }),
        },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('command_error');
      expect(result[0]!.importance).toBe(8);
      expect(result[0]!.content).toContain('exit 1');
      expect(result[0]!.content).toContain('TypeError');
    });

    test('tool-level error produces command_error', () => {
      const result = extractObservations(
        'run_command',
        { command: 'rm -rf /' },
        { output: '', error: 'Permission denied' },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('command_error');
      expect(result[0]!.content).toContain('Permission denied');
    });

    test('truncates long error messages in content', () => {
      const longError = 'E'.repeat(500);
      const result = extractObservations(
        'run_command',
        { command: 'fail' },
        { output: '', error: longError },
        SESSION_ID,
      );
      // Content should be truncated but metadata should have full error
      expect(result[0]!.content.length).toBeLessThan(longError.length + 50);
      expect(result[0]!.metadata.error).toBe(longError);
    });
  });

  describe('glob', () => {
    test('produces search_performed with result count', () => {
      const result = extractObservations(
        'glob',
        { pattern: 'src/**/*.ts' },
        { output: 'src/a.ts\nsrc/b.ts\nsrc/c.ts' },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('search_performed');
      expect(result[0]!.content).toContain('3 files');
      expect(result[0]!.importance).toBe(3);
    });

    test('handles empty output', () => {
      const result = extractObservations(
        'glob',
        { pattern: '**/*.xyz' },
        { output: '' },
        SESSION_ID,
      );
      expect(result[0]!.content).toContain('0 files');
    });
  });

  describe('grep', () => {
    test('produces search_performed with match count', () => {
      const result = extractObservations(
        'grep',
        { pattern: 'onToolResult' },
        { output: 'file1.ts:10:match\nfile2.ts:20:match\nfile3.ts:30:match' },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('search_performed');
      expect(result[0]!.content).toContain('3 matches');
    });
  });

  describe('todo_write', () => {
    test('produces todo_updated with status counts', () => {
      const result = extractObservations(
        'todo_write',
        {
          todos: [
            { id: '1', content: 'task 1', status: 'completed' },
            { id: '2', content: 'task 2', status: 'pending' },
            { id: '3', content: 'task 3', status: 'pending' },
          ],
        },
        { output: 'Todos updated' },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('todo_updated');
      expect(result[0]!.importance).toBe(5);
      expect(result[0]!.content).toContain('1 completed');
      expect(result[0]!.content).toContain('2 pending');
    });
  });

  describe('task', () => {
    test('produces task_delegated', () => {
      const result = extractObservations(
        'task',
        { description: 'Explore codebase architecture', prompt: 'full prompt' },
        { output: 'Task completed' },
        SESSION_ID,
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('task_delegated');
      expect(result[0]!.content).toContain('Explore codebase architecture');
      expect(result[0]!.importance).toBe(5);
    });

    test('falls back to prompt if no description', () => {
      const result = extractObservations(
        'task',
        { prompt: 'A very long prompt that should be truncated...' },
        { output: 'done' },
        SESSION_ID,
      );
      expect(result[0]!.content).toContain('A very long prompt');
    });
  });

  describe('edge cases', () => {
    test('unknown tool returns empty array', () => {
      const result = extractObservations(
        'list_dir',
        { path: '.' },
        { output: 'files...' },
        SESSION_ID,
      );
      expect(result).toHaveLength(0);
    });

    test('denied tool call returns empty array', () => {
      const result = extractObservations(
        'edit_file',
        { path: 'test.ts' },
        { output: '', error: 'User denied the operation' },
        SESSION_ID,
      );
      expect(result).toHaveLength(0);
    });

    test('blocked tool call returns empty array', () => {
      const result = extractObservations(
        'run_command',
        { command: 'rm -rf /' },
        { output: '', error: 'BLOCKED: operation not permitted' },
        SESSION_ID,
      );
      expect(result).toHaveLength(0);
    });
  });
});

// === Store ===

describe('observation store', () => {
  let db: Database;
  let previousDb: Database | null;

  beforeEach(() => {
    db = setupTestDb();
    previousDb = setDatabaseForTesting(db);
  });

  afterEach(() => {
    setDatabaseForTesting(previousDb);
    db.close();
  });

  test('addObservations + getObservationsBySession round-trip', () => {
    const obs = [
      makeObservation({ content: 'Modified foo.ts' }),
      makeObservation({
        content: 'Modified bar.ts',
        createdAt: Date.now() + 1,
      }),
    ];
    addObservations(obs);

    const result = getObservationsBySession(SESSION_ID);
    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe('Modified foo.ts');
    expect(result[1]!.content).toBe('Modified bar.ts');
    expect(result[0]!.source).toBe('programmatic');
  });

  test('addObservations with empty array is a no-op', () => {
    addObservations([]);
    const result = getObservationsBySession(SESSION_ID);
    expect(result).toHaveLength(0);
  });

  test('getRecentObservations with type filter', () => {
    addObservations([
      makeObservation({ type: 'file_modified', content: 'mod' }),
      makeObservation({ type: 'command_run', content: 'cmd', importance: 4 }),
      makeObservation({ type: 'file_modified', content: 'mod2' }),
    ]);

    const result = getRecentObservations(SESSION_ID, {
      types: ['file_modified'],
    });
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.type === 'file_modified')).toBe(true);
  });

  test('getRecentObservations with importance filter', () => {
    addObservations([
      makeObservation({ importance: 3, content: 'low' }),
      makeObservation({ importance: 7, content: 'high' }),
      makeObservation({ importance: 8, content: 'higher' }),
    ]);

    const result = getRecentObservations(SESSION_ID, { minImportance: 7 });
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.importance >= 7)).toBe(true);
  });

  test('getRecentObservations with limit', () => {
    addObservations([
      makeObservation({ content: 'a', createdAt: 1000 }),
      makeObservation({ content: 'b', createdAt: 2000 }),
      makeObservation({ content: 'c', createdAt: 3000 }),
    ]);

    const result = getRecentObservations(SESSION_ID, { limit: 2 });
    expect(result).toHaveLength(2);
    // Most recent first (DESC order)
    expect(result[0]!.content).toBe('c');
    expect(result[1]!.content).toBe('b');
  });

  test('clearObservations removes all for session', () => {
    addObservations([makeObservation(), makeObservation()]);
    expect(getObservationsBySession(SESSION_ID)).toHaveLength(2);

    clearObservations(SESSION_ID);
    expect(getObservationsBySession(SESSION_ID)).toHaveLength(0);
  });

  test('observations from different sessions do not leak', () => {
    addObservations([
      makeObservation({ sessionId: SESSION_ID, content: 'session 1' }),
      makeObservation({ sessionId: SESSION_ID_2, content: 'session 2' }),
    ]);

    const s1 = getObservationsBySession(SESSION_ID);
    const s2 = getObservationsBySession(SESSION_ID_2);
    expect(s1).toHaveLength(1);
    expect(s1[0]!.content).toBe('session 1');
    expect(s2).toHaveLength(1);
    expect(s2[0]!.content).toBe('session 2');
  });

  test('getLatestObservationTimestamp returns most recent', () => {
    addObservations([
      makeObservation({ createdAt: 1000 }),
      makeObservation({ createdAt: 3000 }),
      makeObservation({ createdAt: 2000 }),
    ]);

    const latest = getLatestObservationTimestamp(SESSION_ID);
    expect(latest).toBe(3000);
  });

  test('getLatestObservationTimestamp returns null for empty session', () => {
    const latest = getLatestObservationTimestamp(SESSION_ID);
    expect(latest).toBeNull();
  });

  test('metadata round-trips as JSON', () => {
    const obs = makeObservation({
      metadata: { path: 'test.ts', exitCode: 1, nested: { a: true } },
    });
    addObservations([obs]);

    const result = getObservationsBySession(SESSION_ID);
    expect(result[0]!.metadata).toEqual({
      path: 'test.ts',
      exitCode: 1,
      nested: { a: true },
    });
  });
});

// === Observation Block Builder ===

describe('buildObservationBlock', () => {
  let db: Database;
  let previousDb: Database | null;

  beforeEach(() => {
    db = setupTestDb();
    previousDb = setDatabaseForTesting(db);
  });

  afterEach(() => {
    setDatabaseForTesting(previousDb);
    db.close();
  });

  test('returns null for empty session', () => {
    const result = buildObservationBlock(SESSION_ID);
    expect(result).toBeNull();
  });

  test('formats file modifications correctly', () => {
    addObservations([
      makeObservation({
        type: 'file_created',
        content: 'Created src/new.ts',
        metadata: { path: 'src/new.ts' },
        createdAt: 1000,
      }),
      makeObservation({
        type: 'file_modified',
        content: 'Modified src/existing.ts',
        metadata: { path: 'src/existing.ts' },
        createdAt: 2000,
      }),
    ]);

    const block = buildObservationBlock(SESSION_ID);
    expect(block).not.toBeNull();
    expect(block).toContain('<observations>');
    expect(block).toContain('</observations>');
    expect(block).toContain('## Modified Files');
    expect(block).toContain('src/new.ts (created)');
    expect(block).toContain('src/existing.ts (modified)');
  });

  test('deduplicates file modifications by path', () => {
    addObservations([
      makeObservation({
        type: 'file_modified',
        content: 'Modified src/a.ts',
        metadata: { path: 'src/a.ts' },
        createdAt: 1000,
      }),
      makeObservation({
        type: 'file_modified',
        content: 'Modified src/a.ts',
        metadata: { path: 'src/a.ts' },
        createdAt: 2000,
      }),
      makeObservation({
        type: 'file_modified',
        content: 'Modified src/a.ts',
        metadata: { path: 'src/a.ts' },
        createdAt: 3000,
      }),
    ]);

    const block = buildObservationBlock(SESSION_ID)!;
    const fileLines = block.split('\n').filter((l) => l.includes('src/a.ts'));
    expect(fileLines).toHaveLength(1);
    expect(fileLines[0]).toContain('\u00d7 3');
  });

  test('file that was created then modified shows both actions', () => {
    addObservations([
      makeObservation({
        type: 'file_created',
        content: 'Created src/new.ts',
        metadata: { path: 'src/new.ts' },
        createdAt: 1000,
      }),
      makeObservation({
        type: 'file_modified',
        content: 'Modified src/new.ts',
        metadata: { path: 'src/new.ts' },
        createdAt: 2000,
      }),
    ]);

    const block = buildObservationBlock(SESSION_ID)!;
    expect(block).toContain('created');
    expect(block).toContain('modified');
  });

  test('errors are always included', () => {
    addObservations([
      makeObservation({
        type: 'command_error',
        content: 'Failed: bun test \u2192 exit 1: TypeError',
        metadata: { command: 'bun test', exitCode: 1 },
        importance: 8,
        createdAt: 1000,
      }),
    ]);

    const block = buildObservationBlock(SESSION_ID)!;
    expect(block).toContain('## Errors');
    expect(block).toContain('TypeError');
  });

  test('read files are omitted from output', () => {
    addObservations([
      makeObservation({
        type: 'file_read',
        content: 'Read src/agent/index.ts',
        metadata: { path: 'src/agent/index.ts' },
        importance: 3,
      }),
    ]);

    const block = buildObservationBlock(SESSION_ID);
    expect(block).toBeNull();
  });

  test('section ordering is correct', () => {
    addObservations([
      makeObservation({
        type: 'search_performed',
        content: 'Grep "test" \u2192 5 matches',
        metadata: { tool: 'grep', pattern: 'test', resultCount: 5 },
        importance: 3,
        createdAt: 1000,
      }),
      makeObservation({
        type: 'command_error',
        content: 'Failed: bun test',
        metadata: { command: 'bun test' },
        importance: 8,
        createdAt: 2000,
      }),
      makeObservation({
        type: 'file_modified',
        content: 'Modified src/a.ts',
        metadata: { path: 'src/a.ts' },
        createdAt: 3000,
      }),
      makeObservation({
        type: 'command_run',
        content: 'Ran: bun lint \u2192 exit 0',
        metadata: { command: 'bun lint', exitCode: 0 },
        importance: 4,
        createdAt: 4000,
      }),
    ]);

    const block = buildObservationBlock(SESSION_ID)!;
    const filesIdx = block.indexOf('## Modified Files');
    const errorsIdx = block.indexOf('## Errors');
    const commandsIdx = block.indexOf('## Commands');
    const searchesIdx = block.indexOf('## Searches');

    expect(filesIdx).toBeLessThan(errorsIdx);
    expect(errorsIdx).toBeLessThan(commandsIdx);
    expect(commandsIdx).toBeLessThan(searchesIdx);
  });

  test('deduplicates commands by command string', () => {
    addObservations([
      makeObservation({
        type: 'command_run',
        content: 'Ran: bun lint \u2192 exit 0',
        metadata: { command: 'bun lint', exitCode: 0 },
        importance: 4,
        createdAt: 1000,
      }),
      makeObservation({
        type: 'command_run',
        content: 'Ran: bun lint \u2192 exit 0',
        metadata: { command: 'bun lint', exitCode: 0 },
        importance: 4,
        createdAt: 2000,
      }),
    ]);

    const block = buildObservationBlock(SESSION_ID)!;
    const cmdLines = block.split('\n').filter((l) => l.includes('bun lint'));
    expect(cmdLines).toHaveLength(1);
  });

  test('deduplicates searches by pattern', () => {
    addObservations([
      makeObservation({
        type: 'search_performed',
        content: 'Grep "foo" \u2192 3 matches',
        metadata: { tool: 'grep', pattern: 'foo', resultCount: 3 },
        importance: 3,
        createdAt: 1000,
      }),
      makeObservation({
        type: 'search_performed',
        content: 'Grep "foo" \u2192 5 matches',
        metadata: { tool: 'grep', pattern: 'foo', resultCount: 5 },
        importance: 3,
        createdAt: 2000,
      }),
    ]);

    const block = buildObservationBlock(SESSION_ID)!;
    const grepLines = block.split('\n').filter((l) => l.includes('Grep "foo"'));
    expect(grepLines).toHaveLength(1);
    expect(grepLines[0]).toContain('5 matches');
  });

  test('todo shows latest state only', () => {
    addObservations([
      makeObservation({
        type: 'todo_updated',
        content: 'Updated todos: 3 pending',
        metadata: { todoCounts: { pending: 3 }, totalTodos: 3 },
        importance: 5,
        createdAt: 1000,
      }),
      makeObservation({
        type: 'todo_updated',
        content: 'Updated todos: 1 completed, 2 pending',
        metadata: { todoCounts: { completed: 1, pending: 2 }, totalTodos: 3 },
        importance: 5,
        createdAt: 2000,
      }),
    ]);

    const block = buildObservationBlock(SESSION_ID)!;
    expect(block).toContain('1 completed, 2 pending');
    expect(block).not.toContain('3 pending');
  });
});

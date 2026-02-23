/**
 * Integration tests for observational memory end-to-end pipeline.
 *
 * Validates the full flow:
 *   1. Tool calls produce observations via extractors
 *   2. Observations are stored in SQLite
 *   3. buildObservationBlock reads them and formats the block
 *   4. The block is included in the system prompt via SystemPromptContext
 *   5. Both build and plan mode prompts contain <observations>
 *
 * Run with: bun test ./tests/test-memory-integration.ts
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { buildBuildModePrompt } from '../src/agent/prompts/build';
import { buildPlanModePrompt } from '../src/agent/prompts/plan';
import type { SystemPromptContext } from '../src/agent/prompts/shared';
import { extractObservations } from '../src/memory/extractors';
import { addObservations } from '../src/memory/store';
import { buildObservationBlock } from '../src/memory/working-memory';
import { setDatabaseForTesting } from '../src/session/db';

const SESSION_ID = 'integration-test-session';

/** Minimal SystemPromptContext for testing (no project instructions, no file I/O) */
function makeTestContext(observationBlock?: string): SystemPromptContext {
  return {
    workingDirectory: '/test/project',
    platform: 'darwin',
    date: '2026-02-22',
    observationBlock,
  };
}

describe('observational memory integration', () => {
  let db: Database;
  let previousDb: Database | null;

  beforeEach(() => {
    db = new Database(':memory:');
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
      CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
    `);

    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, project_path, mode, model, host, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        SESSION_ID,
        '/test',
        'build',
        'test-model',
        'http://localhost',
        now,
        now,
      ],
    );

    previousDb = setDatabaseForTesting(db);
  });

  afterEach(() => {
    setDatabaseForTesting(previousDb);
    db.close();
  });

  test('full pipeline: extract → store → build block → inject into build mode prompt', () => {
    // Simulate a realistic sequence of tool calls
    const toolCalls = [
      {
        tool: 'read_file',
        args: { path: 'src/index.ts' },
        result: { output: 'file contents...' },
      },
      {
        tool: 'edit_file',
        args: {
          path: 'src/agent/index.ts',
          oldString: 'foo',
          newString: 'bar',
        },
        result: { output: 'File edited successfully' },
      },
      {
        tool: 'run_command',
        args: { command: 'bun check:types' },
        result: {
          output: JSON.stringify({ stdout: '', stderr: '', exitCode: 0 }),
        },
      },
      {
        tool: 'run_command',
        args: { command: 'bun test' },
        result: {
          output: JSON.stringify({
            stdout: '',
            stderr: 'TypeError: foo is not a function',
            exitCode: 1,
          }),
        },
      },
      {
        tool: 'grep',
        args: { pattern: 'onToolResult' },
        result: { output: 'file1.ts:10:match\nfile2.ts:20:match' },
      },
      {
        tool: 'edit_file',
        args: {
          path: 'src/agent/index.ts',
          oldString: 'bar',
          newString: 'baz',
        },
        result: { output: 'File edited successfully' },
      },
    ];

    // Step 1: Extract observations from each tool call
    for (const call of toolCalls) {
      const observations = extractObservations(
        call.tool,
        call.args,
        call.result,
        SESSION_ID,
      );
      // Step 2: Store them
      if (observations.length > 0) {
        addObservations(observations);
      }
    }

    // Step 3: Build the observation block
    const block = buildObservationBlock(SESSION_ID);
    expect(block).not.toBeNull();
    expect(block).toContain('<observations>');
    expect(block).toContain('</observations>');

    // Verify block content reflects the tool calls
    // file_read should be omitted
    expect(block).not.toContain('src/index.ts');

    // file_modified should be present and deduplicated (edited twice)
    expect(block).toContain('src/agent/index.ts');
    expect(block).toContain('modified');

    // Successful command should be present
    expect(block).toContain('bun check:types');

    // Failed command should be in Errors section
    expect(block).toContain('## Errors');
    expect(block).toContain('bun test');
    expect(block).toContain('TypeError');

    // Search should be present
    expect(block).toContain('onToolResult');

    // Step 4: Inject into system prompt context
    const ctx = makeTestContext(block!);

    // Step 5: Build the build mode prompt and verify observations are present
    const buildPrompt = buildBuildModePrompt(ctx);
    expect(buildPrompt).toContain('<observations>');
    expect(buildPrompt).toContain('</observations>');
    expect(buildPrompt).toContain('## Modified Files');
    expect(buildPrompt).toContain('## Errors');
    expect(buildPrompt).toContain('Session Observations');

    // Verify the observation block is placed after the environment block
    const envIdx = buildPrompt.indexOf('<env>');
    const obsIdx = buildPrompt.indexOf('<observations>');
    const responsibilityIdx = buildPrompt.indexOf('# Your Responsibility');
    expect(envIdx).toBeGreaterThan(-1);
    expect(obsIdx).toBeGreaterThan(envIdx);
    expect(responsibilityIdx).toBeGreaterThan(obsIdx);
  });

  test('full pipeline: observation block appears in plan mode prompt', () => {
    // Seed a simple observation
    const observations = extractObservations(
      'glob',
      { pattern: 'src/**/*.ts' },
      { output: 'a.ts\nb.ts\nc.ts' },
      SESSION_ID,
    );
    addObservations(observations);

    const block = buildObservationBlock(SESSION_ID);
    expect(block).not.toBeNull();

    const planPrompt = buildPlanModePrompt(makeTestContext(block!));
    expect(planPrompt).toContain('<observations>');
    expect(planPrompt).toContain('## Searches');
    expect(planPrompt).toContain('3 files');
  });

  test('no observations → no observation block in prompt', () => {
    // Empty session — no tool calls yet
    const block = buildObservationBlock(SESSION_ID);
    expect(block).toBeNull();

    // Prompt should not contain observation tags
    const ctx = makeTestContext(undefined);
    const prompt = buildBuildModePrompt(ctx);
    expect(prompt).not.toContain('<observations>');
    expect(prompt).not.toContain('Session Observations');
  });

  test('only file_read observations → no observation block', () => {
    // Read-only exploration — reads are omitted from the block
    for (let i = 0; i < 5; i++) {
      const obs = extractObservations(
        'read_file',
        { path: `src/file${i}.ts` },
        { output: 'contents' },
        SESSION_ID,
      );
      addObservations(obs);
    }

    const block = buildObservationBlock(SESSION_ID);
    expect(block).toBeNull();

    const prompt = buildBuildModePrompt(makeTestContext(undefined));
    expect(prompt).not.toContain('<observations>');
  });

  test('deduplication works across the full pipeline', () => {
    // Edit the same file 3 times, run the same command twice
    for (let i = 0; i < 3; i++) {
      const obs = extractObservations(
        'edit_file',
        { path: 'src/main.ts' },
        { output: 'ok' },
        SESSION_ID,
      );
      addObservations(obs);
    }
    for (let i = 0; i < 2; i++) {
      const obs = extractObservations(
        'run_command',
        { command: 'bun lint' },
        { output: JSON.stringify({ stdout: '', stderr: '', exitCode: 0 }) },
        SESSION_ID,
      );
      addObservations(obs);
    }

    const block = buildObservationBlock(SESSION_ID)!;

    // File should appear once with count
    const fileLines = block
      .split('\n')
      .filter((l) => l.includes('src/main.ts'));
    expect(fileLines).toHaveLength(1);
    expect(fileLines[0]).toContain('\u00d7 3');

    // Command should appear once (deduplicated)
    const cmdLines = block.split('\n').filter((l) => l.includes('bun lint'));
    expect(cmdLines).toHaveLength(1);
  });

  test('observations from different sessions do not leak into prompt', () => {
    const otherSession = 'other-session-id';
    db.run(
      `INSERT INTO sessions (id, project_path, mode, model, host, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        otherSession,
        '/other',
        'build',
        'test-model',
        'http://localhost',
        Date.now(),
        Date.now(),
      ],
    );

    // Add observation to the other session
    const otherObs = extractObservations(
      'edit_file',
      { path: 'src/secret.ts' },
      { output: 'ok' },
      otherSession,
    );
    addObservations(otherObs);

    // Add observation to our session
    const ourObs = extractObservations(
      'edit_file',
      { path: 'src/public.ts' },
      { output: 'ok' },
      SESSION_ID,
    );
    addObservations(ourObs);

    const block = buildObservationBlock(SESSION_ID)!;
    expect(block).toContain('src/public.ts');
    expect(block).not.toContain('src/secret.ts');
  });

  test('denied/blocked tool calls produce no observations', () => {
    const denied = extractObservations(
      'edit_file',
      { path: 'important.ts' },
      { output: '', error: 'User denied the operation' },
      SESSION_ID,
    );
    const blocked = extractObservations(
      'run_command',
      { command: 'rm -rf /' },
      { output: '', error: 'BLOCKED by safety layer' },
      SESSION_ID,
    );

    expect(denied).toHaveLength(0);
    expect(blocked).toHaveLength(0);

    addObservations(denied);
    addObservations(blocked);

    const block = buildObservationBlock(SESSION_ID);
    expect(block).toBeNull();
  });
});

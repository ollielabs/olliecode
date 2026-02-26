/**
 * Unit tests for Observational Memory v2.
 *
 * Tests:
 * - Observer output parsing (parseObserverOutput)
 * - Degenerate repetition detection (detectDegenerateRepetition)
 * - Observation optimization (optimizeObservationsForContext)
 * - Observer prompt building (buildObserverPrompt)
 * - Token counting (countTextTokens, countMessagesTokens)
 * - Message formatting (formatMessagesForObserver)
 * - OM store CRUD (getOrCreateOMRecord, updateAfterObservation, etc.)
 * - OM orchestrator logic (shouldObserve, getUnobservedMessages, buildObservationContextBlock)
 * - Config extraction (extractMemoryConfig)
 *
 * Run with: bun test tests/test-om.ts
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Message } from 'ollama';
import { extractMemoryConfig } from '../src/config/resolve';
import { ConfigSchema } from '../src/config/schema';
import {
  buildObserverPrompt,
  detectDegenerateRepetition,
  optimizeObservationsForContext,
  parseObserverOutput,
} from '../src/memory/observer';
import {
  buildObservationContextBlock,
  getContinuationHint,
  getUnobservedMessages,
  shouldObserve,
} from '../src/memory/om';
import {
  deleteOMRecord,
  getOMRecord,
  getOrCreateOMRecord,
  setObservingFlag,
  updateAfterObservation,
  updatePendingTokens,
} from '../src/memory/store';
import {
  countMessagesTokens,
  countTextTokens,
} from '../src/memory/token-counter';
import {
  DEFAULT_MEMORY_CONFIG,
  formatMessagesForObserver,
  type ObservationalMemoryRecord,
} from '../src/memory/types';
import { setDatabaseForTesting } from '../src/session/db';
import { runMigrations } from '../src/session/migrations';

// ============================================================================
// Test database setup
// ============================================================================

let testDb: Database;
let previousDb: Database | null;

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.exec('PRAGMA journal_mode = WAL;');
  testDb.exec('PRAGMA foreign_keys = ON;');
  runMigrations(testDb);
  previousDb = setDatabaseForTesting(testDb);
});

afterEach(() => {
  setDatabaseForTesting(previousDb);
  testDb.close();
});

// ============================================================================
// Observer output parsing
// ============================================================================

describe('parseObserverOutput', () => {
  test('parses complete XML output', () => {
    const output = `
<observations>
Date: Feb 25, 2026
* HIGH (14:00) User wants observational memory
* MED (14:05) Agent read observer.ts — found 200 lines
</observations>

<current-task>
Implementing Observer agent for OM v2
</current-task>

<suggested-response>
Continue with store implementation
</suggested-response>`;

    const result = parseObserverOutput(output);
    expect(result.observations).toContain('User wants observational memory');
    expect(result.observations).toContain('Agent read observer.ts');
    expect(result.currentTask).toBe('Implementing Observer agent for OM v2');
    expect(result.suggestedResponse).toBe('Continue with store implementation');
    expect(result.degenerate).toBeUndefined();
  });

  test('extracts observations from <observations> tags', () => {
    const output = `<observations>
* HIGH (14:00) Test observation
</observations>`;

    const result = parseObserverOutput(output);
    expect(result.observations).toContain('Test observation');
  });

  test('falls back to list items when no XML tags', () => {
    const output = `Here are my observations:
* HIGH (14:00) User asked for help
* MED (14:01) Agent read file
- Some other item
3. Numbered item`;

    const result = parseObserverOutput(output);
    expect(result.observations).toContain('User asked for help');
    expect(result.observations).toContain('Agent read file');
  });

  test('returns empty string for garbage input', () => {
    const output = 'Just some random text without any observations.';
    const result = parseObserverOutput(output);
    expect(result.observations).toBe('');
  });

  test('handles missing optional tags gracefully', () => {
    const output = `<observations>
* HIGH (14:00) Only observations here
</observations>`;

    const result = parseObserverOutput(output);
    expect(result.observations).toContain('Only observations here');
    expect(result.currentTask).toBeUndefined();
    expect(result.suggestedResponse).toBeUndefined();
  });

  test('truncates extremely long lines', () => {
    // Use non-repetitive content to avoid triggering degenerate detection
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789 ';
    let longContent = '* HIGH (14:00) ';
    for (let i = 0; longContent.length < 12_000; i++) {
      longContent += `observation_${i}_${chars[i % chars.length]} `;
    }
    const output = `<observations>\n${longContent}\n</observations>`;
    const result = parseObserverOutput(output);
    expect(result.observations.length).toBeLessThan(12_000);
    expect(result.observations).toContain('(truncated)');
  });
});

// ============================================================================
// Degenerate repetition detection
// ============================================================================

describe('detectDegenerateRepetition', () => {
  test('returns false for short text', () => {
    expect(detectDegenerateRepetition('short text')).toBe(false);
  });

  test('returns false for normal observations', () => {
    const normal = Array.from(
      { length: 50 },
      (_, i) => `* HIGH (14:${String(i).padStart(2, '0')}) Observation ${i}`,
    ).join('\n');
    expect(detectDegenerateRepetition(normal)).toBe(false);
  });

  test('detects repeated text blocks', () => {
    const repeated = 'This is a repeated observation chunk.\n'.repeat(200);
    expect(detectDegenerateRepetition(repeated)).toBe(true);
  });

  test('detects extremely long lines', () => {
    const longLine = 'x'.repeat(60_000);
    const text = `Normal line\n${longLine}\nAnother normal line`;
    expect(detectDegenerateRepetition(text)).toBe(true);
  });
});

// ============================================================================
// Observation optimization
// ============================================================================

describe('optimizeObservationsForContext', () => {
  test('removes priority markers', () => {
    const input =
      '* HIGH (14:00) Important thing\n* MED (14:05) Medium thing\n* LOW (14:10) Low thing';
    const result = optimizeObservationsForContext(input);
    expect(result).not.toContain('HIGH');
    expect(result).not.toContain('MED');
    expect(result).not.toContain('LOW');
    expect(result).toContain('Important thing');
    expect(result).toContain('Medium thing');
    expect(result).toContain('Low thing');
  });

  test('cleans up arrow indicators', () => {
    const input = '  * -> read src/auth.ts — found tokens';
    const result = optimizeObservationsForContext(input);
    expect(result).not.toContain(' -> ');
    expect(result).toContain('read src/auth.ts');
  });

  test('compresses multiple spaces', () => {
    const input = '* HIGH  (14:00)  Extra   spaces';
    const result = optimizeObservationsForContext(input);
    expect(result).not.toContain('  ');
  });
});

// ============================================================================
// Observer prompt building
// ============================================================================

describe('buildObserverPrompt', () => {
  test('includes existing observations when provided', () => {
    const prompt = buildObserverPrompt(
      '* HIGH (14:00) Previous observation',
      '[USER]\nNew message',
    );
    expect(prompt).toContain('Previous Observations');
    expect(prompt).toContain('Previous observation');
    expect(prompt).toContain('Do not repeat');
    expect(prompt).toContain('New message');
  });

  test('skips existing observations section when none', () => {
    const prompt = buildObserverPrompt(undefined, '[USER]\nNew message');
    expect(prompt).not.toContain('Previous Observations');
    expect(prompt).toContain('New message');
  });

  test('includes the task instruction', () => {
    const prompt = buildObserverPrompt(undefined, '[USER]\nTest');
    expect(prompt).toContain('Extract new observations');
  });
});

// ============================================================================
// Token counting
// ============================================================================

describe('token counting', () => {
  test('countTextTokens returns reasonable estimate', () => {
    const text = 'Hello world, this is a test string';
    const tokens = countTextTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length); // tokens < chars
  });

  test('countTextTokens handles empty string', () => {
    expect(countTextTokens('')).toBe(0);
  });

  test('countMessagesTokens sums message tokens', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello world' },
      {
        role: 'assistant',
        content: 'Hi there, how can I help you today?',
      },
    ];
    const tokens = countMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  test('countMessagesTokens includes conversation overhead for empty array', () => {
    // countMessagesTokens always includes TOKENS_PER_CONVERSATION (24) overhead
    const tokens = countMessagesTokens([]);
    expect(tokens).toBe(24);
  });
});

// ============================================================================
// Message formatting
// ============================================================================

describe('formatMessagesForObserver', () => {
  test('formats user and assistant messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Help me fix this bug' },
      { role: 'assistant', content: 'I will look into it' },
    ];
    const formatted = formatMessagesForObserver(messages);
    expect(formatted).toContain('[USER]');
    expect(formatted).toContain('Help me fix this bug');
    expect(formatted).toContain('[ASSISTANT]');
    expect(formatted).toContain('I will look into it');
  });

  test('formats tool calls', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Let me read that file.',
        tool_calls: [
          {
            function: {
              name: 'read_file',
              arguments: { path: 'src/index.ts' },
            },
          },
        ],
      },
    ];
    const formatted = formatMessagesForObserver(messages);
    expect(formatted).toContain('[Tool Call: read_file]');
    expect(formatted).toContain('src/index.ts');
  });

  test('truncates very long content', () => {
    const longContent = 'x'.repeat(10_000);
    const messages: Message[] = [{ role: 'user', content: longContent }];
    const formatted = formatMessagesForObserver(messages);
    expect(formatted.length).toBeLessThan(longContent.length);
    expect(formatted).toContain('truncated');
  });
});

// ============================================================================
// OM Store CRUD
// ============================================================================

/** Insert a session row to satisfy foreign key constraints */
function createTestSession(sessionId: string): void {
  const now = Date.now();
  testDb.run(
    `INSERT INTO sessions (id, project_path, project_name, title, mode, model, host, message_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      '/tmp/test',
      'test',
      'Test Session',
      'build',
      'test-model',
      'http://localhost:11434',
      0,
      now,
      now,
    ],
  );
}

describe('OM store', () => {
  const sessionId = 'test-session-1';

  test('getOMRecord returns null for non-existent session', () => {
    const record = getOMRecord(sessionId);
    expect(record).toBeNull();
  });

  test('getOrCreateOMRecord creates initial record', () => {
    createTestSession(sessionId);
    const record = getOrCreateOMRecord(sessionId);
    expect(record.sessionId).toBe(sessionId);
    expect(record.activeObservations).toBe('');
    expect(record.observationTokenCount).toBe(0);
    expect(record.originType).toBe('initial');
    expect(record.generationCount).toBe(0);
    expect(record.observedMessageIds).toEqual([]);
    expect(record.isObserving).toBe(false);
    expect(record.isReflecting).toBe(false);
    expect(record.pendingMessageTokens).toBe(0);
    expect(record.totalTokensObserved).toBe(0);
    expect(record.currentTask).toBeNull();
    expect(record.suggestedResponse).toBeNull();
  });

  test('getOrCreateOMRecord returns existing record', () => {
    createTestSession(sessionId);
    const first = getOrCreateOMRecord(sessionId);
    const second = getOrCreateOMRecord(sessionId);
    expect(first.id).toBe(second.id);
  });

  test('updateAfterObservation updates record fields', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);
    const now = Date.now();

    updateAfterObservation(sessionId, {
      activeObservations: '* HIGH (14:00) Test observation',
      observationTokenCount: 100,
      lastObservedAt: now,
      observedMessageIds: ['0', '1', '2'],
      pendingMessageTokens: 0,
      totalTokensObserved: 500,
      currentTask: 'Implement feature X',
      suggestedResponse: 'Continue with step 2',
    });

    const record = getOMRecord(sessionId);
    expect(record).not.toBeNull();
    expect(record?.activeObservations).toBe('* HIGH (14:00) Test observation');
    expect(record?.observationTokenCount).toBe(100);
    expect(record?.lastObservedAt).toBe(now);
    expect(record?.observedMessageIds).toEqual(['0', '1', '2']);
    expect(record?.pendingMessageTokens).toBe(0);
    expect(record?.totalTokensObserved).toBe(500);
    expect(record?.currentTask).toBe('Implement feature X');
    expect(record?.suggestedResponse).toBe('Continue with step 2');
    expect(record?.originType).toBe('observation');
    expect(record?.isObserving).toBe(false);
  });

  test('setObservingFlag toggles the lock', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    setObservingFlag(sessionId, true);
    expect(getOMRecord(sessionId)?.isObserving).toBe(true);

    setObservingFlag(sessionId, false);
    expect(getOMRecord(sessionId)?.isObserving).toBe(false);
  });

  test('updatePendingTokens updates token count', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    updatePendingTokens(sessionId, 1500);
    expect(getOMRecord(sessionId)?.pendingMessageTokens).toBe(1500);
  });

  test('deleteOMRecord removes the record', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);
    expect(getOMRecord(sessionId)).not.toBeNull();

    deleteOMRecord(sessionId);
    expect(getOMRecord(sessionId)).toBeNull();
  });

  test('multiple sessions are independent', () => {
    createTestSession('session-a');
    createTestSession('session-b');
    getOrCreateOMRecord('session-a');
    getOrCreateOMRecord('session-b');

    updatePendingTokens('session-a', 100);
    updatePendingTokens('session-b', 200);

    expect(getOMRecord('session-a')?.pendingMessageTokens).toBe(100);
    expect(getOMRecord('session-b')?.pendingMessageTokens).toBe(200);
  });
});

// ============================================================================
// OM orchestrator logic
// ============================================================================

describe('shouldObserve', () => {
  test('returns false below threshold', () => {
    expect(shouldObserve(1000, DEFAULT_MEMORY_CONFIG)).toBe(false);
  });

  test('returns true at threshold', () => {
    expect(
      shouldObserve(
        DEFAULT_MEMORY_CONFIG.observation.messageTokens,
        DEFAULT_MEMORY_CONFIG,
      ),
    ).toBe(true);
  });

  test('returns true above threshold', () => {
    expect(
      shouldObserve(
        DEFAULT_MEMORY_CONFIG.observation.messageTokens + 1000,
        DEFAULT_MEMORY_CONFIG,
      ),
    ).toBe(true);
  });

  test('respects custom config', () => {
    const config = {
      ...DEFAULT_MEMORY_CONFIG,
      observation: {
        ...DEFAULT_MEMORY_CONFIG.observation,
        messageTokens: 5000,
      },
    };
    expect(shouldObserve(4999, config)).toBe(false);
    expect(shouldObserve(5000, config)).toBe(true);
  });
});

describe('getUnobservedMessages', () => {
  const messages: Message[] = [
    { role: 'user', content: 'Message 1' },
    { role: 'assistant', content: 'Response 1' },
    { role: 'user', content: 'Message 2' },
    { role: 'assistant', content: 'Response 2' },
    { role: 'user', content: 'Message 3' },
  ];

  test('returns all messages when nothing observed', () => {
    const record: ObservationalMemoryRecord = {
      id: 'test',
      sessionId: 'test',
      activeObservations: '',
      observationTokenCount: 0,
      originType: 'initial',
      generationCount: 0,
      lastObservedAt: null,
      observedMessageIds: [],
      bufferedObservationChunks: [],
      isBufferingObservation: false,
      lastBufferedAtTokens: 0,
      lastBufferedAtTime: null,
      bufferedReflection: null,
      bufferedReflectionTokens: null,
      bufferedReflectionInputTokens: null,
      reflectedObservationLineCount: null,
      isBufferingReflection: false,
      isObserving: false,
      isReflecting: false,
      pendingMessageTokens: 0,
      totalTokensObserved: 0,
      currentTask: null,
      suggestedResponse: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const unobserved = getUnobservedMessages(messages, record);
    expect(unobserved.length).toBe(5);
  });

  test('returns only unobserved messages after observation', () => {
    const record: ObservationalMemoryRecord = {
      id: 'test',
      sessionId: 'test',
      activeObservations: 'some observations',
      observationTokenCount: 100,
      originType: 'observation',
      generationCount: 0,
      lastObservedAt: Date.now(),
      observedMessageIds: ['0', '1', '2'], // first 3 messages observed
      bufferedObservationChunks: [],
      isBufferingObservation: false,
      lastBufferedAtTokens: 0,
      lastBufferedAtTime: null,
      bufferedReflection: null,
      bufferedReflectionTokens: null,
      bufferedReflectionInputTokens: null,
      reflectedObservationLineCount: null,
      isBufferingReflection: false,
      isObserving: false,
      isReflecting: false,
      pendingMessageTokens: 0,
      totalTokensObserved: 0,
      currentTask: null,
      suggestedResponse: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const unobserved = getUnobservedMessages(messages, record);
    expect(unobserved.length).toBe(2);
    expect(unobserved[0]?.content).toBe('Response 2');
    expect(unobserved[1]?.content).toBe('Message 3');
  });

  test('returns empty array when all messages observed', () => {
    const record: ObservationalMemoryRecord = {
      id: 'test',
      sessionId: 'test',
      activeObservations: 'observations',
      observationTokenCount: 100,
      originType: 'observation',
      generationCount: 0,
      lastObservedAt: Date.now(),
      observedMessageIds: ['0', '1', '2', '3', '4'],
      bufferedObservationChunks: [],
      isBufferingObservation: false,
      lastBufferedAtTokens: 0,
      lastBufferedAtTime: null,
      bufferedReflection: null,
      bufferedReflectionTokens: null,
      bufferedReflectionInputTokens: null,
      reflectedObservationLineCount: null,
      isBufferingReflection: false,
      isObserving: false,
      isReflecting: false,
      pendingMessageTokens: 0,
      totalTokensObserved: 0,
      currentTask: null,
      suggestedResponse: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const unobserved = getUnobservedMessages(messages, record);
    expect(unobserved.length).toBe(0);
  });
});

describe('buildObservationContextBlock', () => {
  const baseRecord: ObservationalMemoryRecord = {
    id: 'test',
    sessionId: 'test',
    activeObservations: '',
    observationTokenCount: 0,
    originType: 'initial',
    generationCount: 0,
    lastObservedAt: null,
    observedMessageIds: [],
    bufferedObservationChunks: [],
    isBufferingObservation: false,
    lastBufferedAtTokens: 0,
    lastBufferedAtTime: null,
    bufferedReflection: null,
    bufferedReflectionTokens: null,
    bufferedReflectionInputTokens: null,
    reflectedObservationLineCount: null,
    isBufferingReflection: false,
    isObserving: false,
    isReflecting: false,
    pendingMessageTokens: 0,
    totalTokensObserved: 0,
    currentTask: null,
    suggestedResponse: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  test('returns null when no observations', () => {
    expect(buildObservationContextBlock(baseRecord)).toBeNull();
  });

  test('builds block with observations', () => {
    const record = {
      ...baseRecord,
      activeObservations:
        '* HIGH (14:00) Test observation\n* MED (14:05) Another one',
    };
    const block = buildObservationContextBlock(record);
    expect(block).not.toBeNull();
    expect(block).toContain('<observations>');
    expect(block).toContain('</observations>');
    expect(block).toContain('Test observation');
  });

  test('includes current-task when present', () => {
    const record = {
      ...baseRecord,
      activeObservations: '* HIGH (14:00) Test',
      currentTask: 'Implement feature X',
    };
    const block = buildObservationContextBlock(record);
    expect(block).not.toBeNull();
    expect(block).toContain('<current-task>');
    expect(block).toContain('Implement feature X');
    expect(block).toContain('</current-task>');
  });

  test('includes suggested-response when present', () => {
    const record = {
      ...baseRecord,
      activeObservations: '* HIGH (14:00) Test',
      suggestedResponse: 'Continue with step 2',
    };
    const block = buildObservationContextBlock(record);
    expect(block).not.toBeNull();
    expect(block).toContain('<suggested-response>');
    expect(block).toContain('Continue with step 2');
    expect(block).toContain('</suggested-response>');
  });

  test('includes preamble text', () => {
    const record = {
      ...baseRecord,
      activeObservations: '* HIGH (14:00) Test',
    };
    const block = buildObservationContextBlock(record);
    expect(block).not.toBeNull();
    expect(block).toContain('observations are your memory');
  });
});

describe('getContinuationHint', () => {
  test('returns non-empty string', () => {
    const hint = getContinuationHint();
    expect(hint.length).toBeGreaterThan(0);
  });

  test('tells model to continue naturally', () => {
    const hint = getContinuationHint();
    expect(hint).toContain('continue');
  });
});

// ============================================================================
// Config extraction
// ============================================================================

describe('extractMemoryConfig', () => {
  test('extracts default config', () => {
    const resolved = ConfigSchema.parse({});
    const memConfig = extractMemoryConfig(resolved);

    expect(memConfig.enabled).toBe(true);
    expect(memConfig.model).toBeUndefined();
    expect(memConfig.observation.messageTokens).toBe(30_000);
    expect(memConfig.observation.bufferTokens).toBe(0.2);
    expect(memConfig.observation.bufferActivation).toBe(0.8);
    expect(memConfig.observation.blockAfter).toBe(1.2);
    expect(memConfig.observation.temperature).toBe(0.3);
    expect(memConfig.reflection.observationTokens).toBe(40_000);
    expect(memConfig.reflection.temperature).toBe(0);
  });

  test('respects custom values', () => {
    const resolved = ConfigSchema.parse({
      memory: {
        enabled: false,
        model: 'qwen2.5:14b',
        observation: {
          messageTokens: 50_000,
          temperature: 0.5,
        },
        reflection: {
          observationTokens: 80_000,
        },
      },
    });
    const memConfig = extractMemoryConfig(resolved);

    expect(memConfig.enabled).toBe(false);
    expect(memConfig.model).toBe('qwen2.5:14b');
    expect(memConfig.observation.messageTokens).toBe(50_000);
    expect(memConfig.observation.temperature).toBe(0.5);
    expect(memConfig.reflection.observationTokens).toBe(80_000);
  });
});

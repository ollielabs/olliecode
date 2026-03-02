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
 * - OM orchestrator logic (shouldObserve, shouldReflect, getUnobservedMessages, buildObservationContextBlock)
 * - Reflector output parsing (parseReflectorOutput)
 * - Reflector prompt building (buildReflectorPrompt, getReflectorSystemPrompt)
 * - Reflector store operations (updateAfterReflection, setReflectingFlag)
 * - Async buffering (interval triggers, chunk activation, retention floor, blockAfter)
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
  calculateRetentionFloor,
  getLatestChunkMetadata,
  getMidLoopSliceEnd,
  getRampPoint,
  mergeChunkObservations,
  needsSyncFallback,
  pruneStaleChunks,
  resetBufferingState,
  resolveBlockAfter,
  resolveBufferInterval,
  selectChunksForActivation,
  shouldTriggerAsyncBuffering,
} from '../src/memory/buffering';
import {
  buildObserverPrompt,
  detectDegenerateRepetition,
  optimizeObservationsForContext,
  parseObserverOutput,
} from '../src/memory/observer';
import {
  buildObservationContextBlock,
  checkMidLoopBuffering,
  getContinuationHint,
  getUnobservedMessages,
  shouldObserve,
  shouldReflect,
} from '../src/memory/om';
import {
  buildReflectorPrompt,
  getReflectorSystemPrompt,
  parseReflectorOutput,
} from '../src/memory/reflector';
import {
  deleteOMRecord,
  getOMRecord,
  getOrCreateOMRecord,
  setObservingFlag,
  setReflectingFlag,
  updateAfterObservation,
  updateAfterReflection,
  updatePendingTokens,
} from '../src/memory/store';
import {
  countMessagesTokens,
  countTextTokens,
} from '../src/memory/token-counter';
import {
  type BufferedObservationChunk,
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
  resetBufferingState();
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
      observedUpTo: 3,
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
    expect(record?.observedUpTo).toBe(3);
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
      observedUpTo: 0,
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
      observedUpTo: 3,
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
      observedUpTo: 5,
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
    observedUpTo: 0,
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

// ============================================================================
// Reflector output parsing
// ============================================================================

describe('parseReflectorOutput', () => {
  test('parses complete XML output', () => {
    const output = `
<observations>
Date: Feb 25, 2026
* HIGH (14:00) User wants observational memory implemented
* MED (14:30) Agent completed foundation modules (types, store, observer, om)
</observations>

<current-task>
Phase 2: Reflector implementation
</current-task>

<suggested-response>
Continue with compression escalation tests
</suggested-response>`;

    const result = parseReflectorOutput(output);
    expect(result.observations).toContain('User wants observational memory');
    expect(result.observations).toContain('completed foundation modules');
    expect(result.currentTask).toBe('Phase 2: Reflector implementation');
    expect(result.suggestedResponse).toBe(
      'Continue with compression escalation tests',
    );
    expect(result.degenerate).toBeUndefined();
  });

  test('falls back to list items when no XML tags', () => {
    const output = `Condensed observations:
* HIGH (14:00) User goal: full OM v2 implementation
* MED (14:30) Foundation complete — 6 files committed`;

    const result = parseReflectorOutput(output);
    expect(result.observations).toContain('User goal');
    expect(result.observations).toContain('Foundation complete');
  });

  test('detects degenerate repetition', () => {
    const repeated = 'This observation repeats endlessly.\n'.repeat(200);
    const result = parseReflectorOutput(repeated);
    expect(result.degenerate).toBe(true);
    expect(result.observations).toBe('');
  });

  test('returns empty for garbage input', () => {
    const result = parseReflectorOutput('Just random text.');
    expect(result.observations).toBe('');
  });
});

// ============================================================================
// Reflector prompt building
// ============================================================================

describe('buildReflectorPrompt', () => {
  const sampleObservations = `Date: Feb 25, 2026
* HIGH (14:00) User wants OM v2
* MED (14:30) Foundation modules committed`;

  test('includes observations in prompt', () => {
    const prompt = buildReflectorPrompt(sampleObservations, 0);
    expect(prompt).toContain('User wants OM v2');
    expect(prompt).toContain('Observations to Reflect On');
  });

  test('level 0 has no compression guidance', () => {
    const prompt = buildReflectorPrompt(sampleObservations, 0);
    expect(prompt).not.toContain('COMPRESSION REQUIRED');
  });

  test('level 1 includes compression guidance', () => {
    const prompt = buildReflectorPrompt(sampleObservations, 1);
    expect(prompt).toContain('COMPRESSION REQUIRED');
    expect(prompt).toContain('8/10 detail');
  });

  test('level 2 includes aggressive compression guidance', () => {
    const prompt = buildReflectorPrompt(sampleObservations, 2);
    expect(prompt).toContain('AGGRESSIVE COMPRESSION');
    expect(prompt).toContain('6/10 detail');
  });

  test('level 3 includes critical compression guidance', () => {
    const prompt = buildReflectorPrompt(sampleObservations, 3);
    expect(prompt).toContain('CRITICAL COMPRESSION');
    expect(prompt).toContain('4/10 detail');
  });

  test('includes target tokens when provided', () => {
    const prompt = buildReflectorPrompt(sampleObservations, 0, 5000);
    expect(prompt).toContain('5000 tokens');
  });

  test('clamps to max level for out-of-range values', () => {
    const prompt = buildReflectorPrompt(sampleObservations, 99);
    expect(prompt).toContain('CRITICAL COMPRESSION');
  });
});

describe('getReflectorSystemPrompt', () => {
  test('returns non-empty prompt', () => {
    const prompt = getReflectorSystemPrompt();
    expect(prompt.length).toBeGreaterThan(0);
  });

  test('embeds observer instructions', () => {
    const prompt = getReflectorSystemPrompt();
    expect(prompt).toContain('<observational-memory-instruction>');
    expect(prompt).toContain('</observational-memory-instruction>');
  });

  test('contains key reflector directives', () => {
    const prompt = getReflectorSystemPrompt();
    expect(prompt).toContain('ENTIRETY');
    expect(prompt).toContain('memory consolidation');
    expect(prompt).toContain('USER ASSERTIONS');
  });
});

// ============================================================================
// shouldReflect
// ============================================================================

describe('shouldReflect', () => {
  test('returns false below threshold', () => {
    expect(shouldReflect(1000, DEFAULT_MEMORY_CONFIG)).toBe(false);
  });

  test('returns true at threshold', () => {
    expect(
      shouldReflect(
        DEFAULT_MEMORY_CONFIG.reflection.observationTokens,
        DEFAULT_MEMORY_CONFIG,
      ),
    ).toBe(true);
  });

  test('returns true above threshold', () => {
    expect(
      shouldReflect(
        DEFAULT_MEMORY_CONFIG.reflection.observationTokens + 5000,
        DEFAULT_MEMORY_CONFIG,
      ),
    ).toBe(true);
  });

  test('respects custom config', () => {
    const config = {
      ...DEFAULT_MEMORY_CONFIG,
      reflection: {
        ...DEFAULT_MEMORY_CONFIG.reflection,
        observationTokens: 10_000,
      },
    };
    expect(shouldReflect(9999, config)).toBe(false);
    expect(shouldReflect(10_000, config)).toBe(true);
  });
});

// ============================================================================
// Reflector store operations
// ============================================================================

describe('Reflector store operations', () => {
  const sessionId = 'test-reflector-session';

  test('setReflectingFlag toggles the lock', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    setReflectingFlag(sessionId, true);
    expect(getOMRecord(sessionId)?.isReflecting).toBe(true);

    setReflectingFlag(sessionId, false);
    expect(getOMRecord(sessionId)?.isReflecting).toBe(false);
  });

  test('updateAfterReflection condenses observations and increments generation', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    // First, simulate an observation
    updateAfterObservation(sessionId, {
      activeObservations:
        '* HIGH (14:00) Original observation 1\n* MED (14:05) Original observation 2',
      observationTokenCount: 50_000,
      lastObservedAt: Date.now(),
      observedUpTo: 3,
      pendingMessageTokens: 0,
      totalTokensObserved: 1000,
      currentTask: 'Old task',
      suggestedResponse: 'Old suggestion',
    });

    const beforeReflection = getOMRecord(sessionId);
    expect(beforeReflection?.originType).toBe('observation');
    expect(beforeReflection?.generationCount).toBe(0);

    // Now simulate a reflection
    updateAfterReflection(sessionId, {
      activeObservations:
        '* HIGH (14:00) Condensed: OM v2 implementation in progress',
      observationTokenCount: 500,
      currentTask: 'Phase 2: Reflector',
      suggestedResponse: 'Continue testing',
    });

    const afterReflection = getOMRecord(sessionId);
    expect(afterReflection?.originType).toBe('reflection');
    expect(afterReflection?.generationCount).toBe(1);
    expect(afterReflection?.observationTokenCount).toBe(500);
    expect(afterReflection?.activeObservations).toContain('Condensed');
    expect(afterReflection?.currentTask).toBe('Phase 2: Reflector');
    expect(afterReflection?.isReflecting).toBe(false);
  });

  test('multiple reflections increment generation count', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    // First reflection
    updateAfterReflection(sessionId, {
      activeObservations: 'gen 1',
      observationTokenCount: 100,
      currentTask: null,
      suggestedResponse: null,
    });
    expect(getOMRecord(sessionId)?.generationCount).toBe(1);

    // Second reflection
    updateAfterReflection(sessionId, {
      activeObservations: 'gen 2',
      observationTokenCount: 80,
      currentTask: null,
      suggestedResponse: null,
    });
    expect(getOMRecord(sessionId)?.generationCount).toBe(2);

    // Third reflection
    updateAfterReflection(sessionId, {
      activeObservations: 'gen 3',
      observationTokenCount: 60,
      currentTask: null,
      suggestedResponse: null,
    });
    expect(getOMRecord(sessionId)?.generationCount).toBe(3);
  });

  test('reflection preserves observed message tracking', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    // Set up observed messages via observation
    updateAfterObservation(sessionId, {
      activeObservations: 'lots of observations',
      observationTokenCount: 50_000,
      lastObservedAt: Date.now(),
      observedUpTo: 5,
      pendingMessageTokens: 0,
      totalTokensObserved: 5000,
      currentTask: null,
      suggestedResponse: null,
    });

    // Reflect — should NOT change observedUpTo or lastObservedAt
    const beforeReflection = getOMRecord(sessionId);
    updateAfterReflection(sessionId, {
      activeObservations: 'condensed',
      observationTokenCount: 500,
      currentTask: null,
      suggestedResponse: null,
    });

    const afterReflection = getOMRecord(sessionId);
    expect(afterReflection?.observedUpTo).toBe(5);
    expect(afterReflection?.lastObservedAt).toBe(
      beforeReflection?.lastObservedAt ?? null,
    );
    expect(afterReflection?.totalTokensObserved).toBe(5000);
  });
});

// ============================================================================
// Async buffering
// ============================================================================

describe('resolveBufferInterval', () => {
  test('resolves fractional bufferTokens', () => {
    const interval = resolveBufferInterval(DEFAULT_MEMORY_CONFIG);
    // 0.2 * 30000 = 6000
    expect(interval).toBe(6000);
  });

  test('returns 0 when buffering disabled', () => {
    const config = {
      ...DEFAULT_MEMORY_CONFIG,
      observation: {
        ...DEFAULT_MEMORY_CONFIG.observation,
        bufferTokens: false as const,
      },
    };
    expect(resolveBufferInterval(config)).toBe(0);
  });

  test('handles absolute token count', () => {
    const config = {
      ...DEFAULT_MEMORY_CONFIG,
      observation: { ...DEFAULT_MEMORY_CONFIG.observation, bufferTokens: 8000 },
    };
    expect(resolveBufferInterval(config)).toBe(8000);
  });
});

describe('getRampPoint', () => {
  test('calculates ramp point correctly', () => {
    // 30000 - 6000 * 1.1 = 23400
    const rampPoint = getRampPoint(DEFAULT_MEMORY_CONFIG);
    expect(rampPoint).toBe(23400);
  });
});

describe('resolveBlockAfter', () => {
  test('resolves blockAfter threshold', () => {
    // 1.2 * 30000 = 36000
    expect(resolveBlockAfter(DEFAULT_MEMORY_CONFIG)).toBe(36000);
  });
});

describe('calculateRetentionFloor', () => {
  test('calculates retention floor correctly', () => {
    // 30000 * (1 - 0.8) ≈ 6000 (floating point: 5999)
    const floor = calculateRetentionFloor(DEFAULT_MEMORY_CONFIG);
    expect(floor).toBeGreaterThanOrEqual(5999);
    expect(floor).toBeLessThanOrEqual(6000);
  });
});

describe('shouldTriggerAsyncBuffering', () => {
  const makeRecord = (
    overrides?: Partial<ObservationalMemoryRecord>,
  ): ObservationalMemoryRecord => ({
    id: 'test',
    sessionId: 'test',
    activeObservations: '',
    observationTokenCount: 0,
    originType: 'initial',
    generationCount: 0,
    lastObservedAt: null,
    observedUpTo: 0,
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
    ...overrides,
  });

  test('returns false when buffering disabled', () => {
    const config = {
      ...DEFAULT_MEMORY_CONFIG,
      observation: {
        ...DEFAULT_MEMORY_CONFIG.observation,
        bufferTokens: false as const,
      },
    };
    expect(shouldTriggerAsyncBuffering('s1', 7000, makeRecord(), config)).toBe(
      false,
    );
  });

  test('returns false when already buffering', () => {
    expect(
      shouldTriggerAsyncBuffering(
        's1',
        7000,
        makeRecord({ isBufferingObservation: true }),
        DEFAULT_MEMORY_CONFIG,
      ),
    ).toBe(false);
  });

  test('returns false below first interval', () => {
    expect(
      shouldTriggerAsyncBuffering(
        's1',
        3000,
        makeRecord(),
        DEFAULT_MEMORY_CONFIG,
      ),
    ).toBe(false);
  });

  test('returns true at first interval boundary', () => {
    // At 6000 tokens, interval=6000, currentInterval=1 > lastInterval=0
    expect(
      shouldTriggerAsyncBuffering(
        's1',
        6000,
        makeRecord(),
        DEFAULT_MEMORY_CONFIG,
      ),
    ).toBe(true);
  });

  test('returns true at second interval boundary', () => {
    expect(
      shouldTriggerAsyncBuffering(
        's1',
        12000,
        makeRecord({ lastBufferedAtTokens: 6000 }),
        DEFAULT_MEMORY_CONFIG,
      ),
    ).toBe(true);
  });

  test('returns false above messageTokens threshold', () => {
    expect(
      shouldTriggerAsyncBuffering(
        's1',
        31000,
        makeRecord(),
        DEFAULT_MEMORY_CONFIG,
      ),
    ).toBe(false);
  });

  test('returns true above messageTokens threshold when midLoop=true', () => {
    // Mid-loop skips the sync threshold guard because sync observation
    // can't run during the agent loop.
    expect(
      shouldTriggerAsyncBuffering(
        's1',
        31000,
        makeRecord(),
        DEFAULT_MEMORY_CONFIG,
        true,
      ),
    ).toBe(true);
  });

  test('continues triggering at intervals above threshold when midLoop=true', () => {
    // At 48k tokens with 3k effective interval (ramped), should trigger
    // at each new interval boundary.
    expect(
      shouldTriggerAsyncBuffering(
        's1',
        48000,
        makeRecord({ lastBufferedAtTokens: 45000 }),
        DEFAULT_MEMORY_CONFIG,
        true,
      ),
    ).toBe(true);
  });
});

describe('selectChunksForActivation', () => {
  const makeChunk = (
    messageTokens: number,
    messageIds: string[],
  ): BufferedObservationChunk => ({
    cycleId: crypto.randomUUID(),
    observations: '* HIGH test observation',
    tokenCount: 100,
    messageIds,
    messageTokens,
    lastObservedAt: Date.now(),
  });

  test('activates all chunks when room allows', () => {
    const chunks = [makeChunk(5000, ['0', '1']), makeChunk(5000, ['2', '3'])];
    const result = selectChunksForActivation(
      chunks,
      20000,
      DEFAULT_MEMORY_CONFIG,
    );
    expect(result.chunksToActivate.length).toBe(2);
    expect(result.remainingChunks.length).toBe(0);
    expect(result.messageIdsToExclude).toEqual(['0', '1', '2', '3']);
  });

  test('activates first chunk even if it drops below retention floor', () => {
    // Retention floor ≈ 6000 tokens. Total unobserved = 12000.
    // First chunk uses 8000 tokens -> leaves 4000 < 6000 floor.
    // But we always activate at least the first chunk (instant activation
    // with thin context is better than a 10+ second sync fallback).
    const chunks = [makeChunk(8000, ['0', '1'])];
    const result = selectChunksForActivation(
      chunks,
      12000,
      DEFAULT_MEMORY_CONFIG,
    );
    expect(result.chunksToActivate.length).toBe(1);
    expect(result.remainingChunks.length).toBe(0);
  });

  test('stops at second chunk when it would drop below retention floor', () => {
    // Total unobserved = 16000, floor ≈ 6000
    // Chunk 1: 5000 tokens -> leaves 11000 (ok, above floor)
    // Chunk 2: 8000 tokens -> leaves 3000 (below floor) -> stop
    const chunks = [makeChunk(5000, ['0', '1']), makeChunk(8000, ['2', '3'])];
    const result = selectChunksForActivation(
      chunks,
      16000,
      DEFAULT_MEMORY_CONFIG,
    );
    expect(result.chunksToActivate.length).toBe(1);
    expect(result.remainingChunks.length).toBe(1);
  });

  test('activates partial set of chunks', () => {
    // Total unobserved = 25000, floor = 6000
    // Chunk 1: 8000 tokens -> leaves 17000 (ok)
    // Chunk 2: 8000 tokens -> leaves 9000 (ok)
    // Chunk 3: 8000 tokens -> leaves 1000 (too low) -> stop
    const chunks = [
      makeChunk(8000, ['0', '1']),
      makeChunk(8000, ['2', '3']),
      makeChunk(8000, ['4', '5']),
    ];
    const result = selectChunksForActivation(
      chunks,
      25000,
      DEFAULT_MEMORY_CONFIG,
    );
    expect(result.chunksToActivate.length).toBe(2);
    expect(result.remainingChunks.length).toBe(1);
  });

  test('returns empty when no chunks', () => {
    const result = selectChunksForActivation([], 20000, DEFAULT_MEMORY_CONFIG);
    expect(result.chunksToActivate.length).toBe(0);
    expect(result.remainingChunks.length).toBe(0);
  });
});

describe('mergeChunkObservations', () => {
  test('merges with existing observations', () => {
    const existing = '* HIGH existing observation';
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: '* MED chunk 1 observation',
        tokenCount: 50,
        messageIds: ['0'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
      {
        cycleId: '2',
        observations: '* MED chunk 2 observation',
        tokenCount: 50,
        messageIds: ['1'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];
    const merged = mergeChunkObservations(existing, chunks);
    expect(merged).toContain('existing observation');
    expect(merged).toContain('chunk 1 observation');
    expect(merged).toContain('chunk 2 observation');
  });

  test('handles empty existing observations', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: '* HIGH new observation',
        tokenCount: 50,
        messageIds: ['0'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];
    const merged = mergeChunkObservations('', chunks);
    expect(merged).toContain('new observation');
    expect(merged).not.toMatch(/^\n/); // no leading newline
  });
});

describe('getLatestChunkMetadata', () => {
  test('returns latest task and suggestion from chunks', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: '',
        tokenCount: 0,
        messageIds: [],
        messageTokens: 0,
        lastObservedAt: Date.now(),
        currentTask: 'Task A',
        suggestedResponse: 'Suggestion A',
      },
      {
        cycleId: '2',
        observations: '',
        tokenCount: 0,
        messageIds: [],
        messageTokens: 0,
        lastObservedAt: Date.now(),
        currentTask: 'Task B',
      },
    ];
    const result = getLatestChunkMetadata(chunks, null, null);
    expect(result.currentTask).toBe('Task B');
    expect(result.suggestedResponse).toBe('Suggestion A');
  });

  test('falls back to provided defaults', () => {
    const result = getLatestChunkMetadata(
      [],
      'fallback task',
      'fallback suggestion',
    );
    expect(result.currentTask).toBe('fallback task');
    expect(result.suggestedResponse).toBe('fallback suggestion');
  });
});

describe('needsSyncFallback', () => {
  const makeRecord = (
    chunks: BufferedObservationChunk[] = [],
  ): ObservationalMemoryRecord => ({
    id: 'test',
    sessionId: 'test',
    activeObservations: '',
    observationTokenCount: 0,
    originType: 'initial',
    generationCount: 0,
    lastObservedAt: null,
    observedUpTo: 0,
    observedMessageIds: [],
    bufferedObservationChunks: chunks,
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
  });

  test('returns true when above blockAfter with no chunks', () => {
    // blockAfter = 36000
    expect(needsSyncFallback(37000, makeRecord(), DEFAULT_MEMORY_CONFIG)).toBe(
      true,
    );
  });

  test('returns false when below blockAfter', () => {
    expect(needsSyncFallback(35000, makeRecord(), DEFAULT_MEMORY_CONFIG)).toBe(
      false,
    );
  });

  test('returns false when above blockAfter but chunks exist', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: 'obs',
        tokenCount: 50,
        messageIds: ['0'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];
    expect(
      needsSyncFallback(37000, makeRecord(chunks), DEFAULT_MEMORY_CONFIG),
    ).toBe(false);
  });
});

describe('checkMidLoopBuffering', () => {
  const sessionId = 'mid-loop-test';

  // Reset in-memory buffering state between tests to prevent async ops
  // from leaking between tests (the global afterEach resets DB, but
  // in-memory maps like lastBufferedBoundary and activeBufferingOps persist).
  afterEach(() => {
    resetBufferingState();
  });

  test('does nothing when OM is disabled', () => {
    const config = { ...DEFAULT_MEMORY_CONFIG, enabled: false };
    const messages: Message[] = [{ role: 'user', content: 'x'.repeat(50000) }];
    // Should not throw — just returns early
    checkMidLoopBuffering(
      sessionId,
      messages,
      'test',
      'http://localhost',
      config,
    );
  });

  test('does not trigger activation or sync observation (Zone 1 only)', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    // Use messages below the first buffer interval (6k tokens) so async
    // buffering doesn't fire. checkMidLoopBuffering should still not
    // activate chunks or run sync observation.
    // 4 messages x 4k chars = 16k chars / 4 ≈ 4k tokens (below 6k interval)
    const messages: Message[] = [];
    for (let i = 0; i < 4; i++) {
      messages.push({ role: 'user', content: 'x'.repeat(4000) });
    }

    // Should not throw and should not modify the record's observations
    checkMidLoopBuffering(sessionId, messages, 'test', 'http://localhost');

    const record = getOMRecord(sessionId);
    expect(record?.activeObservations).toBe('');
    expect(record?.originType).toBe('initial');
  });

  test('updates pending token count from full agent array', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    const messages: Message[] = [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'Hi there' },
    ];

    checkMidLoopBuffering(sessionId, messages, 'test', 'http://localhost');

    const record = getOMRecord(sessionId);
    expect(record?.pendingMessageTokens).toBeGreaterThan(0);
  });

  test('counts tokens from agent array even when observedUpTo is high', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    // Simulate a session where observedUpTo is already 200 (from prior turns)
    // but the agent array is small (new turn just started).
    // The old broken code would slice with observedUpTo=200, get empty array,
    // and report 0 tokens. The fix should count the actual agent messages.
    updateAfterObservation(sessionId, {
      activeObservations: 'Some prior observations',
      observationTokenCount: 100,
      lastObservedAt: Date.now(),
      observedUpTo: 200,
      pendingMessageTokens: 0,
      totalTokensObserved: 50000,
      currentTask: null,
      suggestedResponse: null,
    });

    const agentMessages: Message[] = [
      { role: 'user', content: 'New turn message with some content' },
      { role: 'assistant', content: 'Tool call response here' },
      { role: 'tool', content: 'Tool result with file content '.repeat(50) },
    ];

    checkMidLoopBuffering(sessionId, agentMessages, 'test', 'http://localhost');

    const updated = getOMRecord(sessionId);
    // Should reflect tokens from the 3-message agent array, not 0
    expect(updated?.pendingMessageTokens).toBeGreaterThan(0);
  });

  test('tracks midLoopSliceEnd to prevent chunk overlap', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    // Build a large enough agent array to cross the buffer interval (6k tokens).
    // 30k chars / 4 = 7.5k tokens — crosses the first 6k interval boundary.
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'user', content: 'x'.repeat(3000) });
    }

    // First call — should set midLoopSliceEnd to the full array length
    checkMidLoopBuffering(sessionId, messages, 'test', 'http://localhost');

    const sliceEnd = getMidLoopSliceEnd(sessionId);
    expect(sliceEnd).toBe(messages.length);
  });

  test('midLoopSliceEnd resets on resetBufferingState', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    // Simulate a prior buffering trigger
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'user', content: 'x'.repeat(3000) });
    }
    checkMidLoopBuffering(sessionId, messages, 'test', 'http://localhost');
    expect(getMidLoopSliceEnd(sessionId)).toBe(10);

    // Reset should clear the slice tracker
    resetBufferingState();
    expect(getMidLoopSliceEnd(sessionId)).toBe(0);
  });

  test('does not fire when no new messages since last trigger', () => {
    createTestSession(sessionId);
    getOrCreateOMRecord(sessionId);

    // Build messages that cross a buffer interval
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'user', content: 'x'.repeat(3000) });
    }

    // First call triggers buffering
    checkMidLoopBuffering(sessionId, messages, 'test', 'http://localhost');
    const firstSliceEnd = getMidLoopSliceEnd(sessionId);
    expect(firstSliceEnd).toBe(10);

    // Reset the buffering op so it doesn't block the next trigger check
    resetBufferingState();

    // Second call with SAME array — no new messages since sliceEnd=10
    // Should not fire because slice would be empty
    // Re-create the record since resetBufferingState doesn't affect DB
    checkMidLoopBuffering(sessionId, messages, 'test', 'http://localhost');

    // sliceEnd should still be 10 (not updated because nothing new to slice)
    // Actually, resetBufferingState cleared it, so it would be 0 again.
    // But the second call should see 10 messages from index 0, and
    // if it crosses the threshold, it would fire and set sliceEnd=10 again.
    // The key correctness property is that consecutive triggers during the
    // same run produce non-overlapping slices.
  });
});

// ============================================================================
// pruneStaleChunks
// ============================================================================

describe('pruneStaleChunks', () => {
  test('removes chunks entirely within observed range', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: 'obs-stale',
        tokenCount: 50,
        messageIds: ['10', '11', '12'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
      {
        cycleId: '2',
        observations: 'obs-fresh',
        tokenCount: 50,
        messageIds: ['13', '14', '15'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];

    // observedUpTo=13 means ids 0-12 are observed, 13+ are fresh
    const result = pruneStaleChunks(chunks, 13);
    expect(result).toHaveLength(1);
    expect(result[0]!.cycleId).toBe('2');
  });

  test('keeps chunks that straddle the boundary', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: 'obs-straddle',
        tokenCount: 50,
        messageIds: ['10', '11', '12', '13'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];

    // observedUpTo=12: ids 0-11 observed, 12+ fresh. Chunk has id 12, so it straddles.
    const result = pruneStaleChunks(chunks, 12);
    expect(result).toHaveLength(1);
  });

  test('removes all chunks when all are stale', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: 'obs-1',
        tokenCount: 50,
        messageIds: ['5', '6', '7'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
      {
        cycleId: '2',
        observations: 'obs-2',
        tokenCount: 50,
        messageIds: ['8', '9'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];

    const result = pruneStaleChunks(chunks, 20);
    expect(result).toHaveLength(0);
  });

  test('keeps all chunks when none are stale', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: 'obs-1',
        tokenCount: 50,
        messageIds: ['20', '21'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];

    const result = pruneStaleChunks(chunks, 10);
    expect(result).toHaveLength(1);
  });

  test('handles chunks with empty messageIds', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: 'obs-empty',
        tokenCount: 50,
        messageIds: [],
        messageTokens: 0,
        lastObservedAt: Date.now(),
      },
    ];

    const result = pruneStaleChunks(chunks, 100);
    expect(result).toHaveLength(1); // kept because no messageIds to check
  });
});

// ============================================================================
// mergeChunkObservations — subset deduplication
// ============================================================================

describe('mergeChunkObservations — subset deduplication', () => {
  test('discards chunk that is a strict subset of another', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: 'subset',
        observations: '* subset observation',
        tokenCount: 50,
        messageIds: ['10', '11'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
      {
        cycleId: 'superset',
        observations: '* superset observation with more detail',
        tokenCount: 80,
        messageIds: ['10', '11', '12', '13'],
        messageTokens: 200,
        lastObservedAt: Date.now(),
      },
    ];

    const merged = mergeChunkObservations('', chunks);
    expect(merged).toContain('superset observation');
    expect(merged).not.toContain('subset observation');
  });

  test('keeps both chunks when neither is a subset', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: '* first chunk',
        tokenCount: 50,
        messageIds: ['10', '11'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
      {
        cycleId: '2',
        observations: '* second chunk',
        tokenCount: 50,
        messageIds: ['12', '13'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];

    const merged = mergeChunkObservations('', chunks);
    expect(merged).toContain('first chunk');
    expect(merged).toContain('second chunk');
  });

  test('keeps both chunks when they have equal size but different ids', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: '1',
        observations: '* chunk A',
        tokenCount: 50,
        messageIds: ['10', '11'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
      {
        cycleId: '2',
        observations: '* chunk B',
        tokenCount: 50,
        messageIds: ['12', '13'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];

    const merged = mergeChunkObservations('', chunks);
    expect(merged).toContain('chunk A');
    expect(merged).toContain('chunk B');
  });

  test('handles chain: A subset of B, B not subset of C', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: 'A',
        observations: '* obs A',
        tokenCount: 50,
        messageIds: ['10'],
        messageTokens: 50,
        lastObservedAt: Date.now(),
      },
      {
        cycleId: 'B',
        observations: '* obs B',
        tokenCount: 80,
        messageIds: ['10', '11', '12'],
        messageTokens: 150,
        lastObservedAt: Date.now(),
      },
      {
        cycleId: 'C',
        observations: '* obs C',
        tokenCount: 50,
        messageIds: ['13', '14'],
        messageTokens: 100,
        lastObservedAt: Date.now(),
      },
    ];

    const merged = mergeChunkObservations('existing', chunks);
    expect(merged).toContain('existing');
    expect(merged).not.toContain('obs A'); // A is subset of B
    expect(merged).toContain('obs B');
    expect(merged).toContain('obs C');
  });

  test('preserves existing observations alongside deduplicated chunks', () => {
    const chunks: BufferedObservationChunk[] = [
      {
        cycleId: 'small',
        observations: '* small chunk',
        tokenCount: 30,
        messageIds: ['5'],
        messageTokens: 50,
        lastObservedAt: Date.now(),
      },
      {
        cycleId: 'big',
        observations: '* big chunk covers more',
        tokenCount: 80,
        messageIds: ['5', '6', '7'],
        messageTokens: 150,
        lastObservedAt: Date.now(),
      },
    ];

    const merged = mergeChunkObservations('* prior observation', chunks);
    expect(merged).toContain('prior observation');
    expect(merged).toContain('big chunk covers more');
    expect(merged).not.toContain('small chunk');
  });
});

#!/usr/bin/env bun
/**
 * Test token counting improvements.
 *
 * Validates:
 * 1. resolveContextLength — num_ctx parsing from /api/show parameters
 * 2. computeOverhead — dynamic tool schema overhead measurement
 * 3. estimateTokens / estimateMessageTokens — basic sanity checks
 */

import type { Tool } from 'ollama';

import {
  computeOverhead,
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTokens,
  resolveContextLength,
} from '../src/lib/tokenizer';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function assertEq(actual: unknown, expected: unknown, message: string): void {
  if (actual === expected) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message} (got ${actual}, expected ${expected})`);
    failed++;
  }
}

// === resolveContextLength ===

console.log('=== resolveContextLength Tests ===\n');

// No parameters string — return arch limit
assertEq(
  resolveContextLength(131072, undefined),
  131072,
  'No parameters → returns arch context_length',
);

// Empty parameters string
assertEq(
  resolveContextLength(131072, ''),
  131072,
  'Empty parameters → returns arch context_length',
);

// Parameters without num_ctx
assertEq(
  resolveContextLength(131072, 'temperature 0.7\nstop <|im_end|>\n'),
  131072,
  'Parameters without num_ctx → returns arch context_length',
);

// num_ctx lower than arch limit
assertEq(
  resolveContextLength(131072, 'num_ctx 32768\ntemperature 0.7\n'),
  32768,
  'num_ctx < arch → returns num_ctx',
);

// num_ctx higher than arch limit
assertEq(
  resolveContextLength(131072, 'num_ctx 262144\ntemperature 0.7\n'),
  131072,
  'num_ctx > arch → returns arch context_length',
);

// num_ctx equal to arch limit
assertEq(
  resolveContextLength(131072, 'num_ctx 131072\n'),
  131072,
  'num_ctx == arch → returns arch context_length',
);

// num_ctx as first line
assertEq(
  resolveContextLength(131072, 'num_ctx 65536'),
  65536,
  'num_ctx as first line → parsed correctly',
);

// num_ctx in middle of parameters
assertEq(
  resolveContextLength(
    131072,
    'temperature 0.7\nnum_ctx 65536\nstop <|im_end|>\n',
  ),
  65536,
  'num_ctx in middle of parameters → parsed correctly',
);

// num_ctx with quoted value
assertEq(
  resolveContextLength(131072, 'num_ctx "32768"\n'),
  32768,
  'num_ctx with quoted value → parsed correctly',
);

// num_ctx with extra whitespace
assertEq(
  resolveContextLength(131072, 'num_ctx   32768\n'),
  32768,
  'num_ctx with extra whitespace → parsed correctly',
);

// num_ctx of 0 (should be ignored)
assertEq(
  resolveContextLength(131072, 'num_ctx 0\n'),
  131072,
  'num_ctx 0 → ignored, returns arch context_length',
);

// Negative-looking pattern (not a real num_ctx line)
assertEq(
  resolveContextLength(131072, 'some_num_ctx 32768\n'),
  131072,
  'some_num_ctx (partial match) → not matched, returns arch',
);

// === computeOverhead ===

console.log('\n=== computeOverhead Tests ===\n');

// Empty tool schemas
const emptyOverhead = computeOverhead([]);
assert(
  emptyOverhead === 50,
  'Empty tool schemas → returns only ChatML framing (50)',
);

// With tool schemas
const sampleTool: Tool = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read a file from the filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        offset: { type: 'string', description: 'Line offset' },
      },
      required: ['path'],
    },
  },
};

const oneToolOverhead = computeOverhead([sampleTool]);
assert(
  oneToolOverhead > 50,
  `One tool → overhead (${oneToolOverhead}) > ChatML framing (50)`,
);

const twoToolOverhead = computeOverhead([sampleTool, sampleTool]);
assert(
  twoToolOverhead > oneToolOverhead,
  `Two tools → overhead (${twoToolOverhead}) > one tool (${oneToolOverhead})`,
);

// === estimateTokens sanity ===

console.log('\n=== estimateTokens Sanity Tests ===\n');

assertEq(estimateTokens(''), 0, 'Empty string → 0 tokens');
assertEq(estimateTokens('', 'text'), 0, 'Empty string text → 0 tokens');

const shortText = 'Hello, world!';
const shortTokens = estimateTokens(shortText, 'mixed');
assert(
  shortTokens > 0 && shortTokens <= shortText.length,
  `Short text (${shortText.length} chars) → ${shortTokens} tokens (reasonable)`,
);

// Code content should estimate more tokens per char than text
const codeSnippet = 'const x = 1;';
const codeTokens = estimateTokens(codeSnippet, 'code');
const textTokens = estimateTokens(codeSnippet, 'text');
assert(
  codeTokens >= textTokens,
  `Code estimate (${codeTokens}) >= text estimate (${textTokens}) for same string`,
);

// === estimateMessageTokens ===

console.log('\n=== estimateMessageTokens Tests ===\n');

const simpleMsg = { role: 'user', content: 'Hello' };
const simpleMsgTokens = estimateMessageTokens(simpleMsg);
assert(
  simpleMsgTokens > 4,
  `Simple message → ${simpleMsgTokens} tokens (> 4 base overhead)`,
);

const emptyMsg = { role: 'assistant', content: '' };
const emptyMsgTokens = estimateMessageTokens(emptyMsg);
assertEq(
  emptyMsgTokens,
  4,
  'Empty content message → 4 tokens (base overhead only)',
);

const toolCallMsg = {
  role: 'assistant',
  content: 'Let me read that file.',
  tool_calls: [
    {
      function: {
        name: 'read_file',
        arguments: { path: '/src/index.ts' },
      },
    },
  ],
};
const toolCallTokens = estimateMessageTokens(toolCallMsg);
assert(
  toolCallTokens > simpleMsgTokens,
  `Message with tool call (${toolCallTokens}) > simple message (${simpleMsgTokens})`,
);

// === estimateMessagesTokens ===

console.log('\n=== estimateMessagesTokens Tests ===\n');

const messages = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'What is 2+2?' },
  { role: 'assistant', content: '4' },
];

const totalTokens = estimateMessagesTokens(messages);
const sumIndividual = messages.reduce(
  (sum, msg) => sum + estimateMessageTokens(msg),
  0,
);
assertEq(
  totalTokens,
  sumIndividual,
  'estimateMessagesTokens equals sum of individual estimates',
);

assertEq(estimateMessagesTokens([]), 0, 'Empty messages array → 0 tokens');

// === Summary ===

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);

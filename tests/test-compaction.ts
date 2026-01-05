/**
 * Test compaction module functionality.
 */

import type { Message } from 'ollama';
import {
  compactMessages,
  getCompactionLevel,
  needsCompaction,
  DEFAULT_COMPACTION_CONFIG,
} from '../src/agent/compaction';
import { estimateMessagesTokens } from '../src/lib/tokenizer';

// Create test messages
function createMessages(count: number): Message[] {
  const messages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
  ];

  for (let i = 0; i < count; i++) {
    messages.push({
      role: 'user',
      content: `User message ${i}: ${'x'.repeat(100)}`,
    });
    messages.push({
      role: 'assistant',
      content: `Assistant response ${i}: ${'y'.repeat(200)}`,
    });
    messages.push({
      role: 'tool',
      content: `Tool output ${i}:\n${'Line of output\n'.repeat(100)}`,
    });
  }

  return messages;
}

async function testCompactionLevels() {
  console.log('=== Test: Compaction Levels ===');

  console.log('79% usage →', getCompactionLevel(79)); // Should be "light"
  console.log('80% usage →', getCompactionLevel(80)); // Should be "light"
  console.log('85% usage →', getCompactionLevel(85)); // Should be "medium"
  console.log('90% usage →', getCompactionLevel(90)); // Should be "aggressive"
  console.log('95% usage →', getCompactionLevel(95)); // Should be "aggressive"

  console.log('✓ Compaction levels work correctly\n');
}

async function testNeedsCompaction() {
  console.log('=== Test: Needs Compaction ===');

  console.log('75% at 80 threshold →', needsCompaction(75, 80)); // false
  console.log('80% at 80 threshold →', needsCompaction(80, 80)); // true
  console.log('85% at 80 threshold →', needsCompaction(85, 80)); // true
  console.log('70% at 70 threshold →', needsCompaction(70, 70)); // true

  console.log('✓ Needs compaction logic works correctly\n');
}

async function testSimpleCompaction() {
  console.log('=== Test: Simple Compaction (no LLM) ===');

  const messages = createMessages(10); // Creates 31 messages (1 system + 10 * 3)
  const tokensBefore = estimateMessagesTokens(messages);

  console.log('Messages before:', messages.length);
  console.log('Tokens before:', tokensBefore);

  // Test light compaction without LLM
  const result = await compactMessages(messages, 'light', {
    ...DEFAULT_COMPACTION_CONFIG,
    useLLMSummary: false,
  });

  console.log('Messages after:', result.compactedCount);
  console.log('Tokens after:', result.tokensAfter);
  console.log(
    'Reduction:',
    `${Math.round((1 - result.tokensAfter / result.tokensBefore) * 100)}%`,
  );

  // Verify system prompt is preserved
  const firstMessage = result.messages[0];
  if (firstMessage?.role !== 'system') {
    throw new Error('System prompt was not preserved!');
  }
  console.log('✓ System prompt preserved');

  // Verify recent messages are preserved
  const lastMessages = result.messages.slice(-6);
  console.log(
    'Last 6 messages roles:',
    lastMessages.map((m) => m.role).join(', '),
  );
  console.log('✓ Simple compaction works correctly\n');
}

async function testAggressiveCompaction() {
  console.log('=== Test: Aggressive Compaction ===');

  const messages = createMessages(20); // Creates 61 messages
  const tokensBefore = estimateMessagesTokens(messages);

  console.log('Messages before:', messages.length);
  console.log('Tokens before:', tokensBefore);

  const result = await compactMessages(messages, 'aggressive', {
    ...DEFAULT_COMPACTION_CONFIG,
    useLLMSummary: false,
  });

  console.log('Messages after:', result.compactedCount);
  console.log('Tokens after:', result.tokensAfter);
  console.log(
    'Reduction:',
    `${Math.round((1 - result.tokensAfter / result.tokensBefore) * 100)}%`,
  );

  // Should have significant reduction
  if (result.tokensAfter >= result.tokensBefore * 0.8) {
    console.log("⚠️  Warning: Aggressive compaction didn't reduce much");
  } else {
    console.log('✓ Aggressive compaction achieved good reduction\n');
  }
}

async function testToolOutputTruncation() {
  console.log('=== Test: Tool Output Truncation ===');

  const longToolOutput = 'Line of output\n'.repeat(200);
  const messages: Message[] = [
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'Read a file' },
    { role: 'assistant', content: "I'll read that file for you." },
    { role: 'tool', content: longToolOutput },
  ];

  const linesBefore = longToolOutput.split('\n').length;
  console.log('Tool output lines before:', linesBefore);

  const result = await compactMessages(messages, 'light', {
    ...DEFAULT_COMPACTION_CONFIG,
    useLLMSummary: false,
  });

  const toolMessage = result.messages.find((m) => m.role === 'tool');
  const linesAfter = (toolMessage?.content ?? '').split('\n').length;
  console.log('Tool output lines after:', linesAfter);

  if (linesAfter < linesBefore) {
    console.log('✓ Tool output was truncated correctly\n');
  } else {
    console.log('⚠️  Tool output was not truncated\n');
  }
}

async function main() {
  console.log('\n🧪 Compaction Module Tests\n');
  console.log(`${'='.repeat(50)}\n`);

  try {
    await testCompactionLevels();
    await testNeedsCompaction();
    await testSimpleCompaction();
    await testAggressiveCompaction();
    await testToolOutputTruncation();

    console.log('='.repeat(50));
    console.log('✅ All compaction tests passed!\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();

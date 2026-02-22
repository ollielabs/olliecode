/**
 * Test compaction module functionality.
 *
 * Note: summarizeConversation() requires a live Ollama instance
 * and is tested manually. This file tests the pure utility functions.
 */

import {
  DEFAULT_COMPACTION_CONFIG,
  needsCompaction,
} from '../src/agent/compaction';

async function testNeedsCompaction() {
  console.log('=== Test: Needs Compaction ===');

  console.log('75% at 80 threshold →', needsCompaction(75, 80)); // false
  console.log('80% at 80 threshold →', needsCompaction(80, 80)); // true
  console.log('85% at 80 threshold →', needsCompaction(85, 80)); // true
  console.log('70% at 70 threshold →', needsCompaction(70, 70)); // true

  if (needsCompaction(75, 80)) throw new Error('75% should not trigger at 80');
  if (!needsCompaction(80, 80)) throw new Error('80% should trigger at 80');
  if (!needsCompaction(85, 80)) throw new Error('85% should trigger at 80');

  console.log('✓ Needs compaction logic works correctly\n');
}

async function testDefaultConfig() {
  console.log('=== Test: Default Config ===');

  console.log('threshold:', DEFAULT_COMPACTION_CONFIG.threshold);
  console.log('temperature:', DEFAULT_COMPACTION_CONFIG.temperature);

  if (DEFAULT_COMPACTION_CONFIG.threshold !== 80)
    throw new Error('Default threshold should be 80');
  if (DEFAULT_COMPACTION_CONFIG.temperature !== 0.3)
    throw new Error('Default temperature should be 0.3');

  console.log('✓ Default config is correct\n');
}

async function main() {
  console.log('\n Compaction Module Tests\n');
  console.log(`${'='.repeat(50)}\n`);

  try {
    await testNeedsCompaction();
    await testDefaultConfig();

    console.log('='.repeat(50));
    console.log('All compaction tests passed!\n');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();

#!/usr/bin/env bun
/**
 * Test loop detection functions.
 *
 * Validates that:
 * 1. detectConsecutiveLoop only triggers on truly consecutive calls
 * 2. detectNotFoundPattern detects futile searches
 * 3. detectDoomLoop catches various loop patterns
 * 4. isProgressBeingMade correctly assesses progress
 */

import {
  detectLoop,
  detectLoopExtended,
  detectConsecutiveLoop,
  detectNotFoundPattern,
  detectDoomLoop,
  isProgressBeingMade,
} from '../src/agent/loop-detector';
import type { AgentStep } from '../src/agent/types';

/**
 * Helper to create an agent step with given tool calls and results.
 */
function createStep(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
  results: Array<{ output: string; error?: string }>,
): AgentStep {
  return {
    thought: '',
    actions: calls.map((c) => ({
      function: {
        name: c.name,
        arguments: c.args,
      },
    })),
    observations: results.map((r, i) => ({
      tool: calls[i]?.name ?? 'unknown',
      output: r.output,
      error: r.error,
    })),
    durationMs: 0,
  };
}

async function runTests(): Promise<void> {
  console.log('=== Loop Detector Tests ===\n');

  let passed = 0;
  let failed = 0;

  // ============================================================
  // detectConsecutiveLoop Tests
  // ============================================================

  // Test 1: Truly consecutive identical calls should trigger
  console.log(
    'Test 1: detectConsecutiveLoop - triggers on truly consecutive calls',
  );
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'read_file', args: { path: 'a.ts' } }],
        [{ output: 'content' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'a.ts' } }],
        [{ output: 'content' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'a.ts' } }],
        [{ output: 'content' }],
      ),
    ];

    const result = detectConsecutiveLoop(steps, 3);

    if (result.detected && result.action === 'read_file') {
      console.log('  ✅ PASS: Detected consecutive identical calls');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected detected=true, action=read_file, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // Test 2: read → edit → read pattern should NOT trigger (different tools between)
  console.log(
    '\nTest 2: detectConsecutiveLoop - allows read→edit→read pattern',
  );
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'read_file', args: { path: 'a.ts' } }],
        [{ output: 'content' }],
      ),
      createStep(
        [
          {
            name: 'edit_file',
            args: { path: 'a.ts', oldString: 'x', newString: 'y' },
          },
        ],
        [{ output: 'edited' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'a.ts' } }],
        [{ output: 'updated content' }],
      ),
    ];

    const result = detectConsecutiveLoop(steps, 3);

    if (!result.detected) {
      console.log('  ✅ PASS: Did not trigger on interleaved pattern');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Should not trigger, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // Test 3: Multiple different reads should not trigger
  console.log(
    '\nTest 3: detectConsecutiveLoop - allows reads of different files',
  );
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'read_file', args: { path: 'a.ts' } }],
        [{ output: 'content a' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'b.ts' } }],
        [{ output: 'content b' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'c.ts' } }],
        [{ output: 'content c' }],
      ),
    ];

    const result = detectConsecutiveLoop(steps, 3);

    if (!result.detected) {
      console.log('  ✅ PASS: Did not trigger on different files');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Should not trigger, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // Test 4: Threshold respected
  console.log('\nTest 4: detectConsecutiveLoop - respects threshold');
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'grep', args: { pattern: 'foo' } }],
        [{ output: 'match' }],
      ),
      createStep(
        [{ name: 'grep', args: { pattern: 'foo' } }],
        [{ output: 'match' }],
      ),
    ];

    // threshold=3, only 2 consecutive - should not trigger
    const result = detectConsecutiveLoop(steps, 3);

    if (!result.detected) {
      console.log('  ✅ PASS: Did not trigger below threshold');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Should not trigger with only 2 calls, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // ============================================================
  // detectNotFoundPattern Tests
  // ============================================================

  // Test 5: Detects repeated empty search results
  console.log(
    '\nTest 5: detectNotFoundPattern - detects repeated empty searches',
  );
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'grep', args: { pattern: 'nonExistentFunction' } }],
        [{ output: 'No matches found' }],
      ),
      createStep(
        [{ name: 'glob', args: { pattern: '**/nonexistent*.ts' } }],
        [{ output: '[]' }],
      ),
      createStep(
        [{ name: 'grep', args: { pattern: 'nonExistentFunction' } }],
        [{ output: '0 matches' }],
      ),
    ];

    const result = detectNotFoundPattern(steps, 3);

    if (result.detected && result.searchTerm?.includes('nonExistentFunction')) {
      console.log(
        `  ✅ PASS: Detected not-found pattern for "${result.searchTerm}"`,
      );
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected to detect not-found pattern, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // Test 6: Does not trigger when searches succeed
  console.log(
    '\nTest 6: detectNotFoundPattern - does not trigger on successful searches',
  );
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'grep', args: { pattern: 'export' } }],
        [{ output: 'src/index.ts:1:export const foo' }],
      ),
      createStep(
        [{ name: 'glob', args: { pattern: '*.ts' } }],
        [{ output: '["src/index.ts", "src/utils.ts"]' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'src/index.ts' } }],
        [{ output: 'file content here' }],
      ),
    ];

    const result = detectNotFoundPattern(steps, 3);

    if (!result.detected) {
      console.log('  ✅ PASS: Did not trigger on successful searches');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Should not trigger, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // Test 7: Detects file not found errors
  console.log('\nTest 7: detectNotFoundPattern - detects ENOENT errors');
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'read_file', args: { path: 'missing1.ts' } }],
        [{ output: 'ENOENT: no such file or directory' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'missing2.ts' } }],
        [{ output: 'file does not exist' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'missing3.ts' } }],
        [{ output: 'no such file' }],
      ),
    ];

    const result = detectNotFoundPattern(steps, 3);

    if (result.detected && result.tools?.includes('read_file')) {
      console.log('  ✅ PASS: Detected file not found pattern');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected to detect ENOENT pattern, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // ============================================================
  // detectDoomLoop Tests
  // ============================================================

  // Test 8: Detects oscillating pattern (A→B→A→B)
  console.log('\nTest 8: detectDoomLoop - detects oscillating pattern');
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'read_file', args: { path: 'a.ts' } }],
        [{ output: 'x' }],
      ),
      createStep(
        [{ name: 'edit_file', args: { path: 'a.ts' } }],
        [{ output: 'y' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'a.ts' } }],
        [{ output: 'x' }],
      ),
      createStep(
        [{ name: 'edit_file', args: { path: 'a.ts' } }],
        [{ output: 'y' }],
      ),
    ];

    const result = detectDoomLoop(steps, 4);

    if (result.detected && result.type === 'oscillating') {
      console.log('  ✅ PASS: Detected oscillating doom loop');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected oscillating detection, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // Test 9: Detects error pattern
  console.log('\nTest 9: detectDoomLoop - detects error pattern');
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'run_command', args: { command: 'test1' } }],
        [{ output: '', error: 'command failed' }],
      ),
      createStep(
        [{ name: 'run_command', args: { command: 'test2' } }],
        [{ output: '', error: 'command failed' }],
      ),
      createStep(
        [{ name: 'run_command', args: { command: 'test3' } }],
        [{ output: '', error: 'command failed' }],
      ),
      createStep(
        [{ name: 'run_command', args: { command: 'test4' } }],
        [{ output: '', error: 'command failed' }],
      ),
    ];

    const result = detectDoomLoop(steps, 4);

    if (
      result.detected &&
      result.type === 'error_pattern' &&
      result.tool === 'run_command'
    ) {
      console.log('  ✅ PASS: Detected error pattern doom loop');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected error_pattern, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // Test 10: No doom loop when making progress
  console.log('\nTest 10: detectDoomLoop - no detection when making progress');
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'glob', args: { pattern: '*.ts' } }],
        [{ output: '[...]' }],
      ),
      createStep(
        [{ name: 'read_file', args: { path: 'a.ts' } }],
        [{ output: 'content' }],
      ),
      createStep(
        [{ name: 'edit_file', args: { path: 'a.ts' } }],
        [{ output: 'edited' }],
      ),
      createStep(
        [{ name: 'grep', args: { pattern: 'foo' } }],
        [{ output: 'matches' }],
      ),
    ];

    const result = detectDoomLoop(steps, 4);

    if (!result.detected) {
      console.log('  ✅ PASS: No doom loop detected during progress');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Should not detect loop, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // ============================================================
  // isProgressBeingMade Tests
  // ============================================================

  // Test 11: Progress when using variety of tools
  console.log(
    '\nTest 11: isProgressBeingMade - detects progress with tool variety',
  );
  {
    const steps: AgentStep[] = [
      createStep([{ name: 'glob', args: {} }], [{ output: 'files' }]),
      createStep([{ name: 'read_file', args: {} }], [{ output: 'content' }]),
      createStep([{ name: 'edit_file', args: {} }], [{ output: 'edited' }]),
      createStep([{ name: 'grep', args: {} }], [{ output: 'matches' }]),
      createStep([{ name: 'list_dir', args: {} }], [{ output: 'dirs' }]),
    ];

    const result = isProgressBeingMade(steps, 5);

    if (result) {
      console.log('  ✅ PASS: Detected progress with tool variety');
      passed++;
    } else {
      console.log('  ❌ FAIL: Should detect progress');
      failed++;
    }
  }

  // Test 12: No progress with single tool returning same results
  console.log(
    '\nTest 12: isProgressBeingMade - detects stuck with single tool + same results',
  );
  {
    const steps: AgentStep[] = [
      createStep([{ name: 'grep', args: {} }], [{ output: 'same output' }]),
      createStep([{ name: 'grep', args: {} }], [{ output: 'same output' }]),
      createStep([{ name: 'grep', args: {} }], [{ output: 'same output' }]),
      createStep([{ name: 'grep', args: {} }], [{ output: 'same output' }]),
      createStep([{ name: 'grep', args: {} }], [{ output: 'same output' }]),
    ];

    const result = isProgressBeingMade(steps, 5);

    if (!result) {
      console.log('  ✅ PASS: Detected no progress (stuck)');
      passed++;
    } else {
      console.log('  ❌ FAIL: Should detect no progress');
      failed++;
    }
  }

  // Test 13: No progress with high error rate
  console.log(
    '\nTest 13: isProgressBeingMade - detects no progress with high error rate',
  );
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'read_file', args: {} }],
        [{ output: '', error: 'err' }],
      ),
      createStep(
        [{ name: 'edit_file', args: {} }],
        [{ output: '', error: 'err' }],
      ),
      createStep([{ name: 'grep', args: {} }], [{ output: '', error: 'err' }]),
      createStep([{ name: 'glob', args: {} }], [{ output: '', error: 'err' }]),
      createStep(
        [{ name: 'run_command', args: {} }],
        [{ output: '', error: 'err' }],
      ),
    ];

    const result = isProgressBeingMade(steps, 5);

    if (!result) {
      console.log('  ✅ PASS: Detected no progress (high error rate)');
      passed++;
    } else {
      console.log('  ❌ FAIL: Should detect no progress');
      failed++;
    }
  }

  // ============================================================
  // detectLoop (original) Tests
  // ============================================================

  // Test 14: Original detectLoop still works for step-level detection
  console.log('\nTest 14: detectLoop - detects repeated first action per step');
  {
    const steps: AgentStep[] = [
      createStep(
        [{ name: 'grep', args: { pattern: 'foo' } }],
        [{ output: 'x' }],
      ),
      createStep(
        [{ name: 'grep', args: { pattern: 'foo' } }],
        [{ output: 'x' }],
      ),
      createStep(
        [{ name: 'grep', args: { pattern: 'foo' } }],
        [{ output: 'x' }],
      ),
    ];

    const result = detectLoop(steps, 3);

    if (result.detected && result.action === 'grep') {
      console.log('  ✅ PASS: Original detectLoop works');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected detection, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // Test 15: detectLoopExtended checks all actions in a step
  console.log('\nTest 15: detectLoopExtended - checks all actions in step');
  {
    const steps: AgentStep[] = [
      createStep(
        [
          { name: 'read_file', args: { path: 'a.ts' } },
          { name: 'read_file', args: { path: 'b.ts' } },
        ],
        [{ output: 'a' }, { output: 'b' }],
      ),
      createStep(
        [
          { name: 'read_file', args: { path: 'a.ts' } },
          { name: 'read_file', args: { path: 'b.ts' } },
        ],
        [{ output: 'a' }, { output: 'b' }],
      ),
      createStep(
        [
          { name: 'read_file', args: { path: 'a.ts' } },
          { name: 'read_file', args: { path: 'b.ts' } },
        ],
        [{ output: 'a' }, { output: 'b' }],
      ),
    ];

    const result = detectLoopExtended(steps, 3);

    if (result.detected) {
      console.log('  ✅ PASS: detectLoopExtended catches multi-action loops');
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected detection, got ${JSON.stringify(result)}`,
      );
      failed++;
    }
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);

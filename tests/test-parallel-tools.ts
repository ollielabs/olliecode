#!/usr/bin/env bun
/**
 * Test parallel tool execution.
 *
 * Validates that:
 * 1. Safe tools run in parallel when called together
 * 2. Unsafe tools run sequentially
 * 3. Results maintain correct ordering
 * 4. Partial failures are handled gracefully
 */

import { processToolCalls } from '../src/agent/tool-processor';
import type { SafetyLayer } from '../src/agent/safety';
import type { ToolCall } from 'ollama';
import type { ToolResult } from '../src/agent/types';

// Mock safety layer that always allows
const mockSafetyLayer = {
  checkToolCall: async () => ({ status: 'allowed' as const }),
  recordExecution: async () => {},
  recordDenied: async () => {},
  recordRejected: async () => {},
  handleConfirmationResponse: () => {},
} as unknown as SafetyLayer;

// Track execution order
const executionLog: string[] = [];

function createToolCall(
  name: string,
  args: Record<string, unknown> = {},
): ToolCall {
  return {
    function: {
      name,
      arguments: args,
    },
  };
}

async function runParallelTest(): Promise<void> {
  console.log('=== Parallel Tool Execution Tests ===\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Multiple safe tools should run in parallel
  console.log(
    'Test 1: Multiple safe tools (read_file, glob, grep) run in parallel',
  );
  {
    executionLog.length = 0;
    const startTime = Date.now();

    const toolCalls: ToolCall[] = [
      createToolCall('read_file', { path: 'package.json' }),
      createToolCall('glob', { pattern: '*.ts' }),
      createToolCall('grep', { pattern: 'export' }),
    ];

    const results: ToolResult[] = [];
    const result = await processToolCalls(
      toolCalls,
      'build',
      mockSafetyLayer,
      {
        onToolResult: (r) => results.push(r),
        onToolBlocked: () => {},
      },
      new AbortController().signal,
    );

    const elapsed = Date.now() - startTime;

    if (result.parallelCount === 3 && result.sequentialCount === 0) {
      console.log(
        `  ✅ PASS: ${result.parallelCount} tools ran in parallel (${elapsed}ms)`,
      );
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected 3 parallel, got ${result.parallelCount} parallel, ${result.sequentialCount} sequential`,
      );
      failed++;
    }
  }

  // Test 2: Unsafe tools should run sequentially
  console.log(
    '\nTest 2: Unsafe tools (run_command, write_file) run sequentially',
  );
  {
    const toolCalls: ToolCall[] = [
      createToolCall('run_command', { command: 'echo test' }),
      createToolCall('write_file', { path: 'test.txt', content: 'test' }),
    ];

    const results: ToolResult[] = [];
    const result = await processToolCalls(
      toolCalls,
      'build',
      mockSafetyLayer,
      {
        onToolResult: (r) => results.push(r),
        onToolBlocked: () => {},
      },
      new AbortController().signal,
    );

    if (result.sequentialCount === 2 && result.parallelCount === 0) {
      console.log(
        `  ✅ PASS: ${result.sequentialCount} tools ran sequentially`,
      );
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected 2 sequential, got ${result.parallelCount} parallel, ${result.sequentialCount} sequential`,
      );
      failed++;
    }
  }

  // Test 3: Mixed safe/unsafe tools
  console.log('\nTest 3: Mixed safe and unsafe tools');
  {
    const toolCalls: ToolCall[] = [
      createToolCall('read_file', { path: 'package.json' }), // safe
      createToolCall('glob', { pattern: '*.ts' }), // safe
      createToolCall('run_command', { command: 'echo test' }), // unsafe
      createToolCall('grep', { pattern: 'export' }), // safe
    ];

    const result = await processToolCalls(
      toolCalls,
      'build',
      mockSafetyLayer,
      {
        onToolResult: () => {},
        onToolBlocked: () => {},
      },
      new AbortController().signal,
    );

    if (result.parallelCount === 3 && result.sequentialCount === 1) {
      console.log(
        `  ✅ PASS: ${result.parallelCount} parallel, ${result.sequentialCount} sequential`,
      );
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected 3 parallel + 1 sequential, got ${result.parallelCount} parallel, ${result.sequentialCount} sequential`,
      );
      failed++;
    }
  }

  // Test 4: Results maintain correct ordering
  console.log('\nTest 4: Results maintain original order');
  {
    const toolCalls: ToolCall[] = [
      createToolCall('read_file', { path: 'package.json' }),
      createToolCall('glob', { pattern: '*.ts' }),
      createToolCall('list_dir', { path: '.' }),
    ];

    const results: ToolResult[] = [];
    await processToolCalls(
      toolCalls,
      'build',
      mockSafetyLayer,
      {
        onToolResult: (r) => results.push(r),
        onToolBlocked: () => {},
      },
      new AbortController().signal,
    );

    // Check that results are in the same order as tool calls
    const expectedOrder = ['read_file', 'glob', 'list_dir'];
    const actualOrder = results.map((r) => r.tool);

    const orderCorrect = expectedOrder.every(
      (name, i) => actualOrder[i] === name,
    );

    if (orderCorrect) {
      console.log(
        `  ✅ PASS: Results in correct order: ${actualOrder.join(', ')}`,
      );
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected ${expectedOrder.join(', ')}, got ${actualOrder.join(', ')}`,
      );
      failed++;
    }
  }

  // Test 5: Partial failures handled gracefully
  console.log('\nTest 5: Partial failures handled gracefully');
  {
    const toolCalls: ToolCall[] = [
      createToolCall('read_file', { path: 'package.json' }), // should succeed
      createToolCall('read_file', { path: 'nonexistent.txt' }), // should fail
      createToolCall('glob', { pattern: '*.ts' }), // should succeed
    ];

    const result = await processToolCalls(
      toolCalls,
      'build',
      mockSafetyLayer,
      {
        onToolResult: () => {},
        onToolBlocked: () => {},
      },
      new AbortController().signal,
    );

    // We should have results for all 3 tools, even with one failure
    if (result.observations.length === 3) {
      const failures = result.observations.filter((o) => o.error);
      console.log(
        `  ✅ PASS: All 3 tools returned results (${failures.length} with errors)`,
      );
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected 3 observations, got ${result.observations.length}`,
      );
      failed++;
    }
  }

  // Test 6: task tool runs in parallel (it's safe)
  console.log('\nTest 6: task tool categorized as safe (parallel)');
  {
    const toolCalls: ToolCall[] = [
      createToolCall('task', {
        description: 'test',
        prompt: 'test prompt',
        thoroughness: 'quick',
      }),
      createToolCall('read_file', { path: 'package.json' }),
    ];

    const result = await processToolCalls(
      toolCalls,
      'build',
      mockSafetyLayer,
      {
        onToolResult: () => {},
        onToolBlocked: () => {},
      },
      new AbortController().signal,
    );

    if (result.parallelCount === 2) {
      console.log(
        `  ✅ PASS: task tool runs in parallel with other safe tools`,
      );
      passed++;
    } else {
      console.log(
        `  ❌ FAIL: Expected 2 parallel, got ${result.parallelCount} parallel, ${result.sequentialCount} sequential`,
      );
      failed++;
    }
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runParallelTest().catch(console.error);

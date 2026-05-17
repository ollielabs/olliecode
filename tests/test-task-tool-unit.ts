/**
 * Unit tests for the task tool rewrite (Story 5).
 *
 * Tests agent resolution, permission checks, maxIterations resolution,
 * and dynamic description building. Does NOT test actual subagent execution
 * (that requires Ollama) — focuses on the logic before runAgent() is called.
 */

import { describe, it, expect } from 'bun:test';
import { AgentRegistry } from '../src/agent/agents/registry';
import { ITERATION_PRESETS } from '../src/agent/agents/schema';
import type { ResolvedAgent } from '../src/agent/agents/schema';
import type { PermissionConfig } from '../src/agent/permission/types';
import { DEFAULT_SAFETY_CONFIG } from '../src/agent/safety/types';
import {
  buildTaskToolDescription,
  resolveMaxIterations,
  MAX_DELEGATION_DEPTH,
  taskTool,
} from '../src/agent/tools/task';

const TEST_SAFETY_CONFIG = { ...DEFAULT_SAFETY_CONFIG, projectRoot: '/tmp' };

/** Mock runSubagent that always throws (simulates network failure). */
const mockRunSubagent = async () => {
  throw new Error('Connection refused (mock)');
};

// ============================================================================
// Test Fixtures
// ============================================================================

const exploreAgent: ResolvedAgent = {
  name: 'explore',
  description: 'Fast codebase search specialist',
  mode: 'subagent',
  disabled: false,
  maxIterations: 'medium',
  permission: {
    '*': 'deny',
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
  },
  systemPrompt: '',
  source: { type: 'builtin' },
};

const reviewerAgent: ResolvedAgent = {
  name: 'reviewer',
  description: 'Code review specialist',
  mode: 'subagent',
  disabled: false,
  maxIterations: 'thorough',
  permission: {
    '*': 'deny',
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
  },
  systemPrompt: 'You are a code reviewer. Analyze code for issues.',
  source: { type: 'project', path: '/project/.ollie/agents/reviewer.md' },
};

const buildAgent: ResolvedAgent = {
  name: 'build',
  description: 'Full-power implementation mode',
  mode: 'primary',
  disabled: false,
  permission: { '*': 'allow' },
  systemPrompt: '',
  source: { type: 'builtin' },
};

const allModeAgent: ResolvedAgent = {
  name: 'helper',
  description: 'General helper that works in any context',
  mode: 'all',
  disabled: false,
  maxIterations: 10,
  permission: { '*': 'allow' },
  systemPrompt: 'You are a general helper.',
  source: { type: 'global', path: '/home/.config/ollie/agents/helper.md' },
};

function createRegistry(agents: ResolvedAgent[] = []): AgentRegistry {
  return new AgentRegistry([
    exploreAgent,
    reviewerAgent,
    buildAgent,
    allModeAgent,
    ...agents,
  ]);
}

// ============================================================================
// buildTaskToolDescription
// ============================================================================

describe('buildTaskToolDescription', () => {
  it('lists available agents', () => {
    const desc = buildTaskToolDescription([
      { name: 'explore', description: 'Search specialist' },
      { name: 'reviewer', description: 'Code reviewer' },
    ]);

    expect(desc).toContain('- explore: Search specialist');
    expect(desc).toContain('- reviewer: Code reviewer');
  });

  it('produces valid description with single agent', () => {
    const desc = buildTaskToolDescription([
      { name: 'explore', description: 'Search specialist' },
    ]);

    expect(desc).toContain('Available agents:');
    expect(desc).toContain('- explore: Search specialist');
    expect(desc).toContain('agent (required)');
  });

  it('produces valid description with no agents', () => {
    const desc = buildTaskToolDescription([]);

    expect(desc).toContain('Available agents:');
  });
});

// ============================================================================
// Task tool execute — agent resolution
// ============================================================================

describe('task tool — agent resolution', () => {
  it('returns error for unknown agent name', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'nonexistent', description: 'test', prompt: 'do something' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockRunSubagent,
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown agent');
    expect(result.output).toContain('nonexistent');
    expect(result.agent).toBe('nonexistent');
  });

  it('returns error for primary-only agent', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'build', description: 'test', prompt: 'do something' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockRunSubagent,
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('primary agent');
    expect(result.output).toContain('cannot be invoked as a subagent');
    expect(result.agent).toBe('build');
  });

  it('allows agents with mode "all"', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'helper', description: 'test', prompt: 'do something' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockRunSubagent,
      },
    );

    // Will fail at mock level, not at resolution
    expect(result.success).toBe(false);
    expect(result.output).toContain('Task execution failed');
    expect(result.output).not.toContain('Unknown agent');
    expect(result.output).not.toContain('primary agent');
    expect(result.agent).toBe('helper');
  });

  it('returns error when registry is missing from context', async () => {
    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'do something' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('agentRegistry');
  });

  it('returns error when model/host/safetyConfig missing', async () => {
    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'do something' },
      undefined,
      {},
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('requires model, host, and safetyConfig');
  });
});

// ============================================================================
// Task tool execute — permission checks
// ============================================================================

describe('task tool — permission checks', () => {
  it('allows invocation when no caller permission (default allow)', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        callerPermission: undefined,
        runSubagent: mockRunSubagent,
      },
    );

    // Passes permission check, fails at mock level
    expect(result.output).not.toContain('Permission denied');
  });

  it('denies invocation when caller task permission denies agent', async () => {
    const registry = createRegistry();
    const callerPermission: PermissionConfig = {
      task: { '*': 'deny' },
    };

    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        callerPermission,
        runSubagent: mockRunSubagent,
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('Permission denied');
    expect(result.output).toContain('explore');
  });

  it('allows specific agent when task permission uses pattern', async () => {
    const registry = createRegistry();
    const callerPermission: PermissionConfig = {
      task: { '*': 'deny', explore: 'allow' },
    };

    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        callerPermission,
        runSubagent: mockRunSubagent,
      },
    );

    // Passes permission, fails at mock level
    expect(result.output).not.toContain('Permission denied');
  });

  it('denies non-allowed agent when task permission uses pattern', async () => {
    const registry = createRegistry();
    const callerPermission: PermissionConfig = {
      task: { '*': 'deny', explore: 'allow' },
    };

    const result = await taskTool.execute(
      { agent: 'reviewer', description: 'test', prompt: 'review code' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        callerPermission,
        runSubagent: mockRunSubagent,
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('Permission denied');
    expect(result.output).toContain('reviewer');
  });
});

// ============================================================================
// maxIterations resolution
// ============================================================================

describe('task tool — maxIterations resolution', () => {
  it('accepts numeric maxIterations', () => {
    const result = taskTool.parameters.safeParse({
      agent: 'explore',
      description: 'test',
      prompt: 'find files',
      maxIterations: 20,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxIterations).toBe(20);
    }
  });

  it('accepts preset string maxIterations', () => {
    const result = taskTool.parameters.safeParse({
      agent: 'explore',
      description: 'test',
      prompt: 'find files',
      maxIterations: 'thorough',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxIterations).toBe('thorough');
    }
  });

  it('maxIterations is optional', () => {
    const result = taskTool.parameters.safeParse({
      agent: 'explore',
      description: 'test',
      prompt: 'find files',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxIterations).toBeUndefined();
    }
  });

  it('rejects invalid preset string', () => {
    const result = taskTool.parameters.safeParse({
      agent: 'explore',
      description: 'test',
      prompt: 'find files',
      maxIterations: 'ultra',
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero iterations', () => {
    const result = taskTool.parameters.safeParse({
      agent: 'explore',
      description: 'test',
      prompt: 'find files',
      maxIterations: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative iterations', () => {
    const result = taskTool.parameters.safeParse({
      agent: 'explore',
      description: 'test',
      prompt: 'find files',
      maxIterations: -5,
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Schema validation
// ============================================================================

describe('task tool — schema validation', () => {
  it('requires agent field', () => {
    const result = taskTool.parameters.safeParse({
      description: 'test',
      prompt: 'find files',
    });
    expect(result.success).toBe(false);
  });

  it('requires prompt field', () => {
    const result = taskTool.parameters.safeParse({
      agent: 'explore',
      description: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('requires description field', () => {
    const result = taskTool.parameters.safeParse({
      agent: 'explore',
      prompt: 'find files',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty agent name', () => {
    const result = taskTool.parameters.safeParse({
      agent: '',
      description: 'test',
      prompt: 'find files',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid full input', () => {
    const result = taskTool.parameters.safeParse({
      agent: 'explore',
      description: 'find auth logic',
      prompt: 'Search for authentication and authorization code in the project',
      maxIterations: 'thorough',
    });
    expect(result.success).toBe(true);
  });

  it('output schema includes agent field', () => {
    const result = taskTool.outputSchema.safeParse({
      success: true,
      output: 'found some files',
      agent: 'explore',
      filesExplored: ['/src/auth.ts'],
      iterations: 3,
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Dynamic description with registry integration
// ============================================================================

describe('task tool — dynamic description via registry', () => {
  it('registry.listForTask returns subagent and all-mode agents', () => {
    const registry = createRegistry();
    const agents = registry.listForTask();

    const names = agents.map((a) => a.name);
    expect(names).toContain('explore');
    expect(names).toContain('reviewer');
    expect(names).toContain('helper'); // mode: 'all'
    expect(names).not.toContain('build'); // mode: 'primary'
  });

  it('registry.listForTask respects caller permission', () => {
    const registry = createRegistry();
    const callerPermission: PermissionConfig = {
      task: { '*': 'deny', explore: 'allow' },
    };

    const agents = registry.listForTask(callerPermission);
    const names = agents.map((a) => a.name);
    expect(names).toContain('explore');
    expect(names).not.toContain('reviewer');
    expect(names).not.toContain('helper');
  });

  it('buildTaskToolDescription from registry agents', () => {
    const registry = createRegistry();
    const agents = registry.listForTask();
    const desc = buildTaskToolDescription(agents);

    expect(desc).toContain('- explore: Fast codebase search specialist');
    expect(desc).toContain('- reviewer: Code review specialist');
    expect(desc).toContain('- helper: General helper');
    expect(desc).not.toContain('- build:');
  });
});

// ============================================================================
// resolveMaxIterations (direct tests)
// ============================================================================

describe('resolveMaxIterations', () => {
  it('uses call override when provided (number)', () => {
    expect(resolveMaxIterations(20, 'medium')).toBe(20);
  });

  it('uses call override when provided (preset)', () => {
    expect(resolveMaxIterations('thorough', 'quick')).toBe(
      ITERATION_PRESETS.thorough,
    );
  });

  it('falls back to agent config when no call override', () => {
    expect(resolveMaxIterations(undefined, 'quick')).toBe(
      ITERATION_PRESETS.quick,
    );
  });

  it('falls back to agent config number when no call override', () => {
    expect(resolveMaxIterations(undefined, 12)).toBe(12);
  });

  it('falls back to default when both are undefined', () => {
    expect(resolveMaxIterations(undefined, undefined)).toBe(
      ITERATION_PRESETS.medium,
    );
  });

  it('caps at MAX_SUBAGENT_ITERATIONS (50)', () => {
    expect(resolveMaxIterations(100, undefined)).toBe(50);
  });

  it('caps agent config at MAX_SUBAGENT_ITERATIONS', () => {
    expect(resolveMaxIterations(undefined, 999)).toBe(50);
  });

  it('call override of exactly 50 is not capped', () => {
    expect(resolveMaxIterations(50, undefined)).toBe(50);
  });
});

// ============================================================================
// Delegation depth guard
// ============================================================================

describe('task tool — delegation depth guard', () => {
  it('allows delegation at depth 0', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockRunSubagent,
        delegationDepth: 0,
      },
    );

    // Passes depth check, fails at mock level
    expect(result.output).not.toContain('delegation depth');
  });

  it('allows delegation at depth below max', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockRunSubagent,
        delegationDepth: MAX_DELEGATION_DEPTH - 1,
      },
    );

    // Passes depth check, fails at mock level
    expect(result.output).not.toContain('delegation depth');
  });

  it('rejects delegation at max depth', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockRunSubagent,
        delegationDepth: MAX_DELEGATION_DEPTH,
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('delegation depth');
    expect(result.output).toContain(`${MAX_DELEGATION_DEPTH}`);
  });

  it('rejects delegation beyond max depth', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockRunSubagent,
        delegationDepth: MAX_DELEGATION_DEPTH + 5,
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('delegation depth');
  });

  it('defaults depth to 0 when not provided', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockRunSubagent,
        // no delegationDepth — should default to 0
      },
    );

    // Passes depth check, fails at mock level
    expect(result.output).not.toContain('delegation depth');
  });
});

// ============================================================================
// runSubagent integration
// ============================================================================

describe('task tool — runSubagent integration', () => {
  it('returns success when runSubagent returns a valid result', async () => {
    const registry = createRegistry();
    const mockSuccess = async () => ({
      finalAnswer: 'Found 3 relevant files in src/auth/',
      steps: [],
      messages: [],
      stats: { totalIterations: 4, totalToolCalls: 6, totalDurationMs: 1200 },
    });

    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find auth files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockSuccess,
      },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('Found 3 relevant files in src/auth/');
    expect(result.agent).toBe('explore');
    expect(result.iterations).toBe(4);
  });

  it('returns error when runSubagent returns an AgentError', async () => {
    const registry = createRegistry();
    const mockError = async () => ({
      type: 'max_iterations' as const,
      iterations: 15,
      lastThought: 'Still searching...',
      messages: [],
    });

    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find auth files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockError,
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('Subagent error');
    expect(result.output).toContain('max_iterations');
  });

  it('catches thrown errors from runSubagent', async () => {
    const registry = createRegistry();
    const result = await taskTool.execute(
      { agent: 'explore', description: 'test', prompt: 'find files' },
      undefined,
      {
        model: 'llama3',
        host: 'http://localhost:11434',
        safetyConfig: TEST_SAFETY_CONFIG,
        agentRegistry: registry,
        runSubagent: mockRunSubagent, // throws
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('Task execution failed');
    expect(result.output).toContain('Connection refused');
  });
});

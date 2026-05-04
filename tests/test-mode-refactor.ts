import { describe, expect, it } from 'bun:test';
import type { Tool } from 'ollama';

import {
  BUILTIN_BUILD_AGENT,
  BUILTIN_EXPLORE_AGENT,
  BUILTIN_PLAN_AGENT,
} from '../src/agent/agents/builtins';
import type { ResolvedAgent } from '../src/agent/agents/schema';
import type { PermissionConfig } from '../src/agent/permission/types';
import {
  getSystemPromptForAgent,
  getSystemPromptForMode,
} from '../src/agent/prompts/index';
import { getDefaultContext } from '../src/agent/prompts/shared';
import {
  getToolsForAgent,
  getToolsForMode,
  isToolAllowedByPermission,
} from '../src/agent/tools/index';

// ─── Helper ───────────────────────────────────────────────────────────

/** Extract tool names from Ollama Tool[] format */
function toolNames(tools: Tool[]): string[] {
  return tools.map((t) => t.function.name ?? '').sort();
}

// ─── isToolAllowedByPermission ────────────────────────────────────────

describe('isToolAllowedByPermission', () => {
  it('allows all tools with wildcard allow', () => {
    const perm: PermissionConfig = { '*': 'allow' };
    expect(isToolAllowedByPermission('read_file', perm)).toBe(true);
    expect(isToolAllowedByPermission('edit_file', perm)).toBe(true);
    expect(isToolAllowedByPermission('run_command', perm)).toBe(true);
  });

  it('denies all tools with wildcard deny', () => {
    const perm: PermissionConfig = { '*': 'deny' };
    expect(isToolAllowedByPermission('read_file', perm)).toBe(false);
    expect(isToolAllowedByPermission('edit_file', perm)).toBe(false);
    expect(isToolAllowedByPermission('run_command', perm)).toBe(false);
  });

  it('allows specific tools while denying others', () => {
    const perm: PermissionConfig = {
      '*': 'deny',
      read: 'allow',
      glob: 'allow',
    };
    expect(isToolAllowedByPermission('read_file', perm)).toBe(true);
    expect(isToolAllowedByPermission('glob', perm)).toBe(true);
    expect(isToolAllowedByPermission('edit_file', perm)).toBe(false);
    expect(isToolAllowedByPermission('write_file', perm)).toBe(false);
    expect(isToolAllowedByPermission('run_command', perm)).toBe(false);
  });

  it('denies edit tools (edit_file and write_file) when edit is denied', () => {
    const perm: PermissionConfig = { edit: 'deny' };
    expect(isToolAllowedByPermission('edit_file', perm)).toBe(false);
    expect(isToolAllowedByPermission('write_file', perm)).toBe(false);
    // Other tools still allowed (default-allow)
    expect(isToolAllowedByPermission('read_file', perm)).toBe(true);
    expect(isToolAllowedByPermission('run_command', perm)).toBe(true);
  });

  it('handles MCP tools via mcp permission key', () => {
    const perm: PermissionConfig = {
      '*': 'deny',
      mcp: { '*': 'deny', 'mcp__github__*': 'allow' },
    };
    expect(isToolAllowedByPermission('mcp__github__create_pr', perm)).toBe(
      true,
    );
    expect(isToolAllowedByPermission('mcp__slack__send', perm)).toBe(false);
  });

  it('ask permission is not a deny', () => {
    const perm: PermissionConfig = { bash: 'ask' };
    expect(isToolAllowedByPermission('run_command', perm)).toBe(true);
  });
});

// ─── getToolsForAgent ─────────────────────────────────────────────────

describe('getToolsForAgent', () => {
  it('returns all tools when no permission config', () => {
    const tools = getToolsForAgent(undefined);
    const names = toolNames(tools);
    expect(names).toContain('read_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('write_file');
    expect(names).toContain('run_command');
    expect(names).toContain('task');
  });

  it('returns all tools for build agent (wildcard allow)', () => {
    const tools = getToolsForAgent(BUILTIN_BUILD_AGENT.permission);
    const names = toolNames(tools);
    expect(names).toContain('read_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('write_file');
    expect(names).toContain('run_command');
    expect(names).toContain('task');
  });

  it('excludes edit tools for plan agent', () => {
    const tools = getToolsForAgent(BUILTIN_PLAN_AGENT.permission);
    const names = toolNames(tools);
    // Plan has edit: deny — so edit_file and write_file excluded
    expect(names).toContain('read_file');
    expect(names).toContain('glob');
    expect(names).toContain('grep');
    expect(names).toContain('run_command');
    expect(names).toContain('task');
    expect(names).not.toContain('edit_file');
    expect(names).not.toContain('write_file');
  });

  it('explore agent only gets allowed tools', () => {
    const tools = getToolsForAgent(BUILTIN_EXPLORE_AGENT.permission);
    const names = toolNames(tools);
    expect(names).toContain('read_file');
    expect(names).toContain('glob');
    expect(names).toContain('grep');
    expect(names).toContain('list_dir');
    expect(names).toContain('run_command');
    expect(names).toContain('web_fetch');
    expect(names).toContain('todo_write');
    expect(names).toContain('todo_read');
    // Denied tools
    expect(names).not.toContain('edit_file');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('task');
  });

  it('matches current plan mode tool set exactly (regression)', () => {
    // The old MODE_TOOLS.plan had these tools:
    const expectedPlanTools = [
      'glob',
      'grep',
      'list_dir',
      'read_file',
      'run_command',
      'task',
      'todo_read',
      'todo_write',
      'web_fetch',
    ];
    const tools = getToolsForAgent(BUILTIN_PLAN_AGENT.permission);
    const names = toolNames(tools);
    expect(names).toEqual(expectedPlanTools);
  });

  it('matches current build mode tool set exactly (regression)', () => {
    // The old MODE_TOOLS.build had these tools:
    const expectedBuildTools = [
      'edit_file',
      'glob',
      'grep',
      'list_dir',
      'read_file',
      'run_command',
      'task',
      'todo_read',
      'todo_write',
      'web_fetch',
      'write_file',
    ];
    const tools = getToolsForAgent(BUILTIN_BUILD_AGENT.permission);
    const names = toolNames(tools);
    expect(names).toEqual(expectedBuildTools);
  });
});

// ─── getToolsForMode (backward compat) ────────────────────────────────

describe('getToolsForMode (backward compat)', () => {
  it('plan mode matches getToolsForAgent with plan permissions', () => {
    const modeTools = toolNames(getToolsForMode('plan'));
    const agentTools = toolNames(
      getToolsForAgent(BUILTIN_PLAN_AGENT.permission),
    );
    expect(modeTools).toEqual(agentTools);
  });

  it('build mode matches getToolsForAgent with build permissions', () => {
    const modeTools = toolNames(getToolsForMode('build'));
    const agentTools = toolNames(
      getToolsForAgent(BUILTIN_BUILD_AGENT.permission),
    );
    expect(modeTools).toEqual(agentTools);
  });
});

// ─── getSystemPromptForAgent ──────────────────────────────────────────

describe('getSystemPromptForAgent', () => {
  const ctx = getDefaultContext();

  it('resolves build agent to build prompt', () => {
    const prompt = getSystemPromptForAgent(BUILTIN_BUILD_AGENT, ctx);
    expect(prompt).toContain('build mode');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('resolves plan agent to plan prompt', () => {
    const prompt = getSystemPromptForAgent(BUILTIN_PLAN_AGENT, ctx);
    expect(prompt).toContain('planning mode');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('resolves explore agent to empty (handled by task tool)', () => {
    const prompt = getSystemPromptForAgent(BUILTIN_EXPLORE_AGENT, ctx);
    expect(prompt).toBe('');
  });

  it('resolves user-defined agent with systemPrompt', () => {
    const agent: ResolvedAgent = {
      name: 'reviewer',
      description: 'Code review specialist',
      mode: 'subagent',
      disabled: false,
      systemPrompt: 'You are a code reviewer. Be thorough.',
      source: { type: 'project', path: '/agents/reviewer.md' },
    };
    const prompt = getSystemPromptForAgent(agent, ctx);
    expect(prompt).toBe('You are a code reviewer. Be thorough.');
  });

  it('generates fallback prompt for user agent without systemPrompt', () => {
    const agent: ResolvedAgent = {
      name: 'linter',
      description: 'Lint code for style issues',
      mode: 'subagent',
      disabled: false,
      systemPrompt: '',
      source: { type: 'config' },
    };
    const prompt = getSystemPromptForAgent(agent, ctx);
    expect(prompt).toContain('linter');
    expect(prompt).toContain('Lint code for style issues');
  });

  it('matches getSystemPromptForMode for backward compat', () => {
    const buildAgentPrompt = getSystemPromptForAgent(BUILTIN_BUILD_AGENT, ctx);
    const buildModePrompt = getSystemPromptForMode('build', ctx);
    expect(buildAgentPrompt).toBe(buildModePrompt);

    const planAgentPrompt = getSystemPromptForAgent(BUILTIN_PLAN_AGENT, ctx);
    const planModePrompt = getSystemPromptForMode('plan', ctx);
    expect(planAgentPrompt).toBe(planModePrompt);
  });
});

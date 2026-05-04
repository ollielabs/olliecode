import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { AgentRegistry } from '../src/agent/agents/registry';
import {
  BUILTIN_AGENTS,
  BUILTIN_BUILD_AGENT,
  BUILTIN_EXPLORE_AGENT,
  BUILTIN_PLAN_AGENT,
  buildAgentRegistry,
} from '../src/agent/agents/index';
import type { ResolvedAgent } from '../src/agent/agents/schema';
import type { PermissionConfig } from '../src/agent/permission/types';

// ─── Test helpers ─────────────────────────────────────────────────────

function makeAgent(
  overrides: Partial<ResolvedAgent> & { name: string },
): ResolvedAgent {
  return {
    description: 'Test agent',
    mode: 'subagent',
    disabled: false,
    systemPrompt: '',
    source: { type: 'builtin' },
    ...overrides,
  };
}

// ─── Built-in agents ──────────────────────────────────────────────────

describe('Built-in agents', () => {
  it('defines three built-in agents', () => {
    expect(BUILTIN_AGENTS).toHaveLength(3);
  });

  it('build agent has correct properties', () => {
    expect(BUILTIN_BUILD_AGENT.name).toBe('build');
    expect(BUILTIN_BUILD_AGENT.mode).toBe('primary');
    expect(BUILTIN_BUILD_AGENT.permission).toEqual({ '*': 'allow' });
    expect(BUILTIN_BUILD_AGENT.source).toEqual({ type: 'builtin' });
    expect(BUILTIN_BUILD_AGENT.disabled).toBe(false);
  });

  it('plan agent has correct properties', () => {
    expect(BUILTIN_PLAN_AGENT.name).toBe('plan');
    expect(BUILTIN_PLAN_AGENT.mode).toBe('primary');
    expect(BUILTIN_PLAN_AGENT.permission).toEqual({ edit: 'deny' });
    expect(BUILTIN_PLAN_AGENT.source).toEqual({ type: 'builtin' });
  });

  it('explore agent has correct properties', () => {
    expect(BUILTIN_EXPLORE_AGENT.name).toBe('explore');
    expect(BUILTIN_EXPLORE_AGENT.mode).toBe('subagent');
    expect(BUILTIN_EXPLORE_AGENT.maxIterations).toBe('medium');
    expect(BUILTIN_EXPLORE_AGENT.permission).toBeDefined();
    expect(BUILTIN_EXPLORE_AGENT.permission!['*']).toBe('deny');
    expect(BUILTIN_EXPLORE_AGENT.permission!['read']).toBe('allow');
    expect(BUILTIN_EXPLORE_AGENT.source).toEqual({ type: 'builtin' });
  });
});

// ─── AgentRegistry ────────────────────────────────────────────────────

describe('AgentRegistry', () => {
  describe('constructor and basic operations', () => {
    it('creates empty registry', () => {
      const registry = new AgentRegistry([]);
      expect(registry.size).toBe(0);
    });

    it('creates registry from agent array', () => {
      const registry = new AgentRegistry(BUILTIN_AGENTS);
      expect(registry.size).toBe(3);
    });

    it('deduplicates agents by name (last wins)', () => {
      const agent1 = makeAgent({ name: 'test', description: 'First' });
      const agent2 = makeAgent({ name: 'test', description: 'Second' });
      const registry = new AgentRegistry([agent1, agent2]);
      expect(registry.size).toBe(1);
      expect(registry.get('test')?.description).toBe('Second');
    });
  });

  describe('get()', () => {
    const registry = new AgentRegistry(BUILTIN_AGENTS);

    it('returns agent by name', () => {
      const agent = registry.get('build');
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('build');
    });

    it('returns undefined for unknown name', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('has()', () => {
    const registry = new AgentRegistry(BUILTIN_AGENTS);

    it('returns true for registered agent', () => {
      expect(registry.has('build')).toBe(true);
      expect(registry.has('plan')).toBe(true);
      expect(registry.has('explore')).toBe(true);
    });

    it('returns false for unregistered agent', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('list()', () => {
    const agents = [
      ...BUILTIN_AGENTS,
      makeAgent({ name: 'reviewer', mode: 'subagent' }),
      makeAgent({ name: 'analyzer', mode: 'all' }),
    ];
    const registry = new AgentRegistry(agents);

    it('lists all agents sorted alphabetically', () => {
      const all = registry.list();
      expect(all.map((a) => a.name)).toEqual([
        'analyzer',
        'build',
        'explore',
        'plan',
        'reviewer',
      ]);
    });

    it('filters by primary mode', () => {
      const primary = registry.list({ mode: 'primary' });
      const names = primary.map((a) => a.name);
      expect(names).toContain('build');
      expect(names).toContain('plan');
      expect(names).toContain('analyzer'); // mode: 'all' included
      expect(names).not.toContain('explore');
      expect(names).not.toContain('reviewer');
    });

    it('filters by subagent mode', () => {
      const subagents = registry.list({ mode: 'subagent' });
      const names = subagents.map((a) => a.name);
      expect(names).toContain('explore');
      expect(names).toContain('reviewer');
      expect(names).toContain('analyzer'); // mode: 'all' included
      expect(names).not.toContain('build');
      expect(names).not.toContain('plan');
    });

    it('returns empty array when no agents match filter', () => {
      const emptyRegistry = new AgentRegistry([
        makeAgent({ name: 'primary-only', mode: 'primary' }),
      ]);
      const subagents = emptyRegistry.list({ mode: 'subagent' });
      expect(subagents).toEqual([]);
    });
  });

  describe('listForTask()', () => {
    const agents = [
      ...BUILTIN_AGENTS,
      makeAgent({ name: 'reviewer', mode: 'subagent' }),
      makeAgent({ name: 'deployer', mode: 'subagent' }),
    ];
    const registry = new AgentRegistry(agents);

    it('returns all subagents when no caller permission', () => {
      const available = registry.listForTask();
      const names = available.map((a) => a.name);
      expect(names).toContain('explore');
      expect(names).toContain('reviewer');
      expect(names).toContain('deployer');
      // Primary agents excluded
      expect(names).not.toContain('build');
      expect(names).not.toContain('plan');
    });

    it('returns all subagents when caller has no task restriction', () => {
      const permission: PermissionConfig = { '*': 'allow' };
      const available = registry.listForTask(permission);
      expect(available.map((a) => a.name)).toContain('explore');
      expect(available.map((a) => a.name)).toContain('reviewer');
    });

    it('filters subagents by task permission (deny all, allow specific)', () => {
      const permission: PermissionConfig = {
        '*': 'deny',
        task: { '*': 'deny', explore: 'allow' },
      };
      const available = registry.listForTask(permission);
      const names = available.map((a) => a.name);
      expect(names).toEqual(['explore']);
    });

    it('denies all subagents when task is fully denied', () => {
      const permission: PermissionConfig = {
        task: 'deny',
      };
      const available = registry.listForTask(permission);
      expect(available).toEqual([]);
    });

    it('allows subagents matching glob pattern', () => {
      const permission: PermissionConfig = {
        task: { '*': 'deny', 'review*': 'allow', explore: 'allow' },
      };
      const available = registry.listForTask(permission);
      const names = available.map((a) => a.name);
      expect(names).toContain('reviewer');
      expect(names).toContain('explore');
      expect(names).not.toContain('deployer');
    });

    it('ask permission is not denied (agent is listed)', () => {
      const permission: PermissionConfig = {
        task: 'ask',
      };
      const available = registry.listForTask(permission);
      expect(available.length).toBeGreaterThan(0);
    });

    it('includes mode: "all" agents in task listing', () => {
      const withAll = new AgentRegistry([
        ...BUILTIN_AGENTS,
        makeAgent({ name: 'helper', mode: 'all' }),
      ]);
      const available = withAll.listForTask();
      const names = available.map((a) => a.name);
      expect(names).toContain('explore'); // subagent
      expect(names).toContain('helper'); // mode: 'all'
      expect(names).not.toContain('build'); // primary only
    });

    it('results are sorted alphabetically', () => {
      const available = registry.listForTask();
      const names = available.map((a) => a.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });
  });
});

// ─── buildAgentRegistry (integration) ─────────────────────────────────

const TEST_DIR = path.join(import.meta.dir, '.test-registry-agents');
const GLOBAL_DIR = path.join(TEST_DIR, 'global');
const PROJECT_DIR = path.join(TEST_DIR, 'project');

describe('buildAgentRegistry', () => {
  beforeAll(() => {
    fs.mkdirSync(GLOBAL_DIR, { recursive: true });
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('includes built-in agents with no files or config', async () => {
    const emptyGlobal = path.join(TEST_DIR, 'empty-global');
    const emptyProject = path.join(TEST_DIR, 'empty-project');

    const { registry, warnings } = await buildAgentRegistry({
      globalDir: emptyGlobal,
      projectDir: emptyProject,
    });

    expect(warnings).toEqual([]);
    expect(registry.size).toBe(3);
    expect(registry.has('build')).toBe(true);
    expect(registry.has('plan')).toBe(true);
    expect(registry.has('explore')).toBe(true);
  });

  it('adds user-defined agents from markdown files', async () => {
    const dir = path.join(TEST_DIR, 'user-agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'reviewer.md'),
      `---
description: Reviews code
mode: subagent
---

You are a code reviewer.`,
    );

    const { registry } = await buildAgentRegistry({
      globalDir: path.join(TEST_DIR, 'nonexistent'),
      projectDir: dir,
    });

    expect(registry.size).toBe(4); // 3 built-in + 1 user
    expect(registry.has('reviewer')).toBe(true);
    expect(registry.get('reviewer')?.description).toBe('Reviews code');
  });

  it('project file overrides built-in agent', async () => {
    const dir = path.join(TEST_DIR, 'override-builtin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'explore.md'),
      `---
description: Custom explore agent
mode: subagent
maxIterations: 30
---

You are a custom explore agent.`,
    );

    const { registry } = await buildAgentRegistry({
      globalDir: path.join(TEST_DIR, 'nonexistent'),
      projectDir: dir,
    });

    expect(registry.size).toBe(3);
    const explore = registry.get('explore');
    expect(explore?.description).toBe('Custom explore agent');
    expect(explore?.maxIterations).toBe(30);
    expect(explore?.source.type).toBe('project');
  });

  it('global file overrides built-in, project overrides global', async () => {
    const globalDir = path.join(TEST_DIR, 'precedence-global');
    const projectDir = path.join(TEST_DIR, 'precedence-project');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    fs.writeFileSync(
      path.join(globalDir, 'explore.md'),
      `---
description: Global explore
mode: subagent
---

Global explore prompt.`,
    );

    fs.writeFileSync(
      path.join(projectDir, 'explore.md'),
      `---
description: Project explore
mode: subagent
---

Project explore prompt.`,
    );

    const { registry } = await buildAgentRegistry({
      globalDir,
      projectDir,
    });

    const explore = registry.get('explore');
    expect(explore?.description).toBe('Project explore');
    expect(explore?.source.type).toBe('project');
  });

  it('JSON config agents override file-based agents', async () => {
    const dir = path.join(TEST_DIR, 'config-override');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'reviewer.md'),
      `---
description: File reviewer
mode: subagent
---

File reviewer prompt.`,
    );

    const { registry } = await buildAgentRegistry({
      globalDir: path.join(TEST_DIR, 'nonexistent'),
      projectDir: dir,
      configAgents: {
        reviewer: {
          description: 'Config reviewer',
          mode: 'subagent',
          disabled: false,
        },
      },
    });

    const reviewer = registry.get('reviewer');
    expect(reviewer?.description).toBe('Config reviewer');
    expect(reviewer?.source.type).toBe('config');
  });

  it('disabled agent in config suppresses built-in', async () => {
    const { registry } = await buildAgentRegistry({
      globalDir: path.join(TEST_DIR, 'nonexistent'),
      projectDir: path.join(TEST_DIR, 'nonexistent'),
      configAgents: {
        explore: {
          description: 'Disabled explore',
          mode: 'subagent',
          disabled: true,
        },
      },
    });

    expect(registry.has('explore')).toBe(false);
    expect(registry.size).toBe(2); // build + plan only
  });

  it('disabled agent in project file suppresses built-in', async () => {
    const dir = path.join(TEST_DIR, 'disabled-file');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'explore.md'),
      `---
description: Disabled explore
mode: subagent
disabled: true
---

Disabled.`,
    );

    const { registry } = await buildAgentRegistry({
      globalDir: path.join(TEST_DIR, 'nonexistent'),
      projectDir: dir,
    });

    expect(registry.has('explore')).toBe(false);
    expect(registry.size).toBe(2);
  });

  it('warns on invalid config agent name', async () => {
    const { registry, warnings } = await buildAgentRegistry({
      globalDir: path.join(TEST_DIR, 'nonexistent'),
      projectDir: path.join(TEST_DIR, 'nonexistent'),
      configAgents: {
        'INVALID-NAME': {
          description: 'Bad name',
          mode: 'subagent',
          disabled: false,
        },
      },
    });

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.message).toContain('INVALID-NAME');
    expect(registry.has('INVALID-NAME')).toBe(false);
  });

  it('full pipeline: built-in + global + project + config', async () => {
    const globalDir = path.join(TEST_DIR, 'full-global');
    const projectDir = path.join(TEST_DIR, 'full-project');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    // Global: adds a linter agent
    fs.writeFileSync(
      path.join(globalDir, 'linter.md'),
      `---
description: Global linter
mode: subagent
---

Lint code.`,
    );

    // Project: adds a reviewer, overrides explore
    fs.writeFileSync(
      path.join(projectDir, 'reviewer.md'),
      `---
description: Project reviewer
mode: subagent
---

Review code.`,
    );
    fs.writeFileSync(
      path.join(projectDir, 'explore.md'),
      `---
description: Project explore
mode: subagent
---

Custom explore.`,
    );

    // Config: overrides linter, adds deployer
    const { registry, warnings } = await buildAgentRegistry({
      globalDir,
      projectDir,
      configAgents: {
        linter: {
          description: 'Config linter',
          mode: 'subagent',
          disabled: false,
        },
        deployer: {
          description: 'Deploy specialist',
          mode: 'subagent',
          disabled: false,
        },
      },
    });

    expect(warnings).toEqual([]);
    // build, plan, explore(project), linter(config), reviewer(project), deployer(config)
    expect(registry.size).toBe(6);

    expect(registry.get('build')?.source.type).toBe('builtin');
    expect(registry.get('plan')?.source.type).toBe('builtin');
    expect(registry.get('explore')?.source.type).toBe('project');
    expect(registry.get('explore')?.description).toBe('Project explore');
    expect(registry.get('linter')?.source.type).toBe('config');
    expect(registry.get('linter')?.description).toBe('Config linter');
    expect(registry.get('reviewer')?.source.type).toBe('project');
    expect(registry.get('deployer')?.source.type).toBe('config');
  });
});

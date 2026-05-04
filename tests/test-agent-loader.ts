import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import {
  loadAgentsFromDirectory,
  loadAllAgents,
  parseAgentMarkdown,
} from '../src/agent/agents/loader';
import type { AgentSource, ResolvedAgent } from '../src/agent/agents/schema';
import type { LoadWarning } from '../src/agent/agents/loader';

// Helper to check if result is a warning
function isWarning(result: ResolvedAgent | LoadWarning): result is LoadWarning {
  return 'message' in result;
}

const TEST_DIR = path.join(import.meta.dir, '.test-agents');
const GLOBAL_DIR = path.join(TEST_DIR, 'global');
const PROJECT_DIR = path.join(TEST_DIR, 'project');

const projectSource: AgentSource = { type: 'project', path: 'test.md' };

// ─── parseAgentMarkdown (unit tests — no filesystem) ─────────────────

describe('parseAgentMarkdown', () => {
  it('parses valid markdown with frontmatter', () => {
    const content = `---
description: Reviews code for quality
mode: subagent
---

You are a code reviewer. Analyze code quality.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/reviewer.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.name).toBe('reviewer');
    expect(result.description).toBe('Reviews code for quality');
    expect(result.mode).toBe('subagent');
    expect(result.systemPrompt).toBe(
      'You are a code reviewer. Analyze code quality.',
    );
  });

  it('uses frontmatter name over filename', () => {
    const content = `---
name: my-reviewer
description: Custom reviewer
---

Review things.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/reviewer.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.name).toBe('my-reviewer');
  });

  it('falls back to filename without extension when name is absent', () => {
    const content = `---
description: A helper agent
---

Help with stuff.`;

    const result = parseAgentMarkdown(
      content,
      '/path/to/helper-agent.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.name).toBe('helper-agent');
  });

  it('defaults mode to subagent when omitted', () => {
    const content = `---
description: Some agent
---

Do things.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/test.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.mode).toBe('subagent');
  });

  it('defaults disabled to false when omitted', () => {
    const content = `---
description: Some agent
---

Do things.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/test.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.disabled).toBe(false);
  });

  it('parses permission config', () => {
    const content = `---
description: Restricted agent
permission:
  "*": deny
  read: allow
  bash:
    "*": deny
    "git diff*": allow
---

Do restricted things.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/restricted.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.permission).toEqual({
      '*': 'deny',
      read: 'allow',
      bash: { '*': 'deny', 'git diff*': 'allow' },
    });
  });

  it('parses optional fields (model, temperature, maxIterations)', () => {
    const content = `---
description: Custom model agent
model: llama3.1:70b
temperature: 0.8
maxIterations: 30
---

Use a custom model.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/custom.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.model).toBe('llama3.1:70b');
    expect(result.temperature).toBe(0.8);
    expect(result.maxIterations).toBe(30);
  });

  it('parses maxIterations as preset string', () => {
    const content = `---
description: Quick agent
maxIterations: quick
---

Be quick.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/quick.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.maxIterations).toBe('quick');
  });

  it('returns warning for missing required description', () => {
    const content = `---
mode: subagent
---

No description here.`;

    const result = parseAgentMarkdown(content, '/agents/bad.md', projectSource);
    expect(isWarning(result)).toBe(true);
    if (!isWarning(result)) return;

    expect(result.message).toContain('Schema validation failed');
    expect(result.message).toContain('description');
  });

  it('returns warning for invalid YAML frontmatter', () => {
    const content = `---
: this is invalid yaml [
  not valid
---

Body text.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/invalid.md',
      projectSource,
    );
    // gray-matter may or may not throw on this — but schema validation should catch it
    // if gray-matter parses it as weird data
    expect(isWarning(result)).toBe(true);
  });

  it('returns warning for invalid permission action', () => {
    const content = `---
description: Bad perms
permission:
  "*": nope
---

Bad.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/badperms.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(true);
    if (!isWarning(result)) return;

    expect(result.message).toContain('Schema validation failed');
  });

  it('returns warning for invalid mode value', () => {
    const content = `---
description: Bad mode
mode: invalid
---

Bad.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/badmode.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(true);
    if (!isWarning(result)) return;

    expect(result.message).toContain('Schema validation failed');
  });

  it('trims whitespace from system prompt body', () => {
    const content = `---
description: Trimmed
---

  
  Content with leading/trailing whitespace.
  
`;

    const result = parseAgentMarkdown(
      content,
      '/agents/trim.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.systemPrompt).toBe(
      'Content with leading/trailing whitespace.',
    );
  });

  it('handles empty body', () => {
    const content = `---
description: No body
---`;

    const result = parseAgentMarkdown(
      content,
      '/agents/nobody.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.systemPrompt).toBe('');
  });

  it('rejects invalid frontmatter name format', () => {
    const content = `---
name: Invalid Name
description: Bad name
---

Bad.`;

    const result = parseAgentMarkdown(content, '/agents/bad.md', projectSource);
    expect(isWarning(result)).toBe(true);
    if (!isWarning(result)) return;

    expect(result.message).toContain('Schema validation failed');
  });

  it('rejects __proto__ as frontmatter name', () => {
    const content = `---
name: __proto__
description: Sneaky
---

Sneaky.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/sneaky.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(true);
  });

  it('rejects empty string frontmatter name', () => {
    const content = `---
name: ""
description: Empty name
---

Empty.`;

    const result = parseAgentMarkdown(
      content,
      '/agents/empty.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(true);
  });

  it('validates filename fallback against name format', () => {
    const content = `---
description: No name field
---

Body.`;

    // Uppercase filename — should fail name validation
    const result = parseAgentMarkdown(
      content,
      '/agents/BadName.md',
      projectSource,
    );
    expect(isWarning(result)).toBe(true);
    if (!isWarning(result)) return;

    expect(result.message).toContain('Invalid agent name from filename');
  });

  it('preserves source metadata', () => {
    const content = `---
description: Source test
---

Body.`;

    const source: AgentSource = {
      type: 'global',
      path: '/home/.config/ollie/agents/test.md',
    };
    const result = parseAgentMarkdown(
      content,
      '/home/.config/ollie/agents/test.md',
      source,
    );
    expect(isWarning(result)).toBe(false);
    if (isWarning(result)) return;

    expect(result.source).toEqual(source);
  });
});

// ─── loadAgentsFromDirectory (filesystem tests) ─────────────────────

describe('loadAgentsFromDirectory', () => {
  beforeAll(() => {
    // Create test directory structure
    fs.mkdirSync(path.join(PROJECT_DIR, 'nested'), { recursive: true });

    // Valid agent
    fs.writeFileSync(
      path.join(PROJECT_DIR, 'reviewer.md'),
      `---
description: Code reviewer
mode: subagent
---

Review code.`,
    );

    // Valid nested agent
    fs.writeFileSync(
      path.join(PROJECT_DIR, 'nested', 'explorer.md'),
      `---
description: Codebase explorer
---

Explore the codebase.`,
    );

    // Invalid agent (missing description)
    fs.writeFileSync(
      path.join(PROJECT_DIR, 'invalid.md'),
      `---
mode: subagent
---

No description.`,
    );

    // Disabled agent
    fs.writeFileSync(
      path.join(PROJECT_DIR, 'disabled-agent.md'),
      `---
description: Disabled agent
disabled: true
---

I am disabled.`,
    );
  });

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('discovers agents recursively', async () => {
    const result = await loadAgentsFromDirectory(PROJECT_DIR, 'project');
    const names = result.agents.map((a) => a.name);
    expect(names).toContain('reviewer');
    expect(names).toContain('explorer');
  });

  it('reports warnings for invalid files', async () => {
    const result = await loadAgentsFromDirectory(PROJECT_DIR, 'project');
    expect(result.warnings.length).toBeGreaterThan(0);
    const invalidWarning = result.warnings.find((w) =>
      w.path.includes('invalid.md'),
    );
    expect(invalidWarning).toBeDefined();
  });

  it('returns empty result for nonexistent directory', async () => {
    const result = await loadAgentsFromDirectory('/nonexistent/path', 'global');
    expect(result.agents).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('detects duplicate names within scope', async () => {
    // Create a second file that resolves to the same name
    const dupeDir = path.join(TEST_DIR, 'dupes');
    fs.mkdirSync(dupeDir, { recursive: true });

    fs.writeFileSync(
      path.join(dupeDir, 'agent-a.md'),
      `---
name: same-name
description: First agent
---

First.`,
    );

    fs.writeFileSync(
      path.join(dupeDir, 'agent-b.md'),
      `---
name: same-name
description: Second agent
---

Second.`,
    );

    const result = await loadAgentsFromDirectory(dupeDir, 'project');
    // One agent loaded, one duplicate warning
    const sameNameAgents = result.agents.filter((a) => a.name === 'same-name');
    expect(sameNameAgents).toHaveLength(1);
    const dupeWarning = result.warnings.find((w) =>
      w.message.includes('Duplicate agent name'),
    );
    expect(dupeWarning).toBeDefined();

    fs.rmSync(dupeDir, { recursive: true, force: true });
  });

  it('includes disabled agents in the raw result (filtering is in loadAllAgents)', async () => {
    const result = await loadAgentsFromDirectory(PROJECT_DIR, 'project');
    const disabledAgent = result.agents.find(
      (a) => a.name === 'disabled-agent',
    );
    expect(disabledAgent).toBeDefined();
    expect(disabledAgent?.disabled).toBe(true);
  });
});

// ─── loadAllAgents (merge + precedence) ──────────────────────────────

describe('loadAllAgents', () => {
  const globalMergeDir = path.join(TEST_DIR, 'merge-global');
  const projectMergeDir = path.join(TEST_DIR, 'merge-project');

  beforeAll(() => {
    fs.mkdirSync(globalMergeDir, { recursive: true });
    fs.mkdirSync(projectMergeDir, { recursive: true });

    // Global agent
    fs.writeFileSync(
      path.join(globalMergeDir, 'shared.md'),
      `---
description: Global version
---

I am global.`,
    );

    // Global-only agent
    fs.writeFileSync(
      path.join(globalMergeDir, 'global-only.md'),
      `---
description: Only in global
---

Global only.`,
    );

    // Project override of "shared"
    fs.writeFileSync(
      path.join(projectMergeDir, 'shared.md'),
      `---
description: Project version
---

I am project.`,
    );

    // Project-only agent
    fs.writeFileSync(
      path.join(projectMergeDir, 'project-only.md'),
      `---
description: Only in project
---

Project only.`,
    );
  });

  afterAll(() => {
    fs.rmSync(path.join(TEST_DIR, 'merge-global'), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(TEST_DIR, 'merge-project'), {
      recursive: true,
      force: true,
    });
  });

  it('project overrides global for same agent name', async () => {
    const result = await loadAllAgents(globalMergeDir, projectMergeDir);
    const shared = result.agents.find((a) => a.name === 'shared');
    expect(shared).toBeDefined();
    expect(shared?.description).toBe('Project version');
    expect(shared?.systemPrompt).toBe('I am project.');
  });

  it('includes agents from both scopes', async () => {
    const result = await loadAllAgents(globalMergeDir, projectMergeDir);
    const names = result.agents.map((a) => a.name);
    expect(names).toContain('global-only');
    expect(names).toContain('project-only');
    expect(names).toContain('shared');
  });

  it('disabled: true in project suppresses global agent', async () => {
    const suppressGlobalDir = path.join(TEST_DIR, 'suppress-global');
    const suppressProjectDir = path.join(TEST_DIR, 'suppress-project');
    fs.mkdirSync(suppressGlobalDir, { recursive: true });
    fs.mkdirSync(suppressProjectDir, { recursive: true });

    fs.writeFileSync(
      path.join(suppressGlobalDir, 'unwanted.md'),
      `---
description: Global agent to suppress
---

I should be suppressed.`,
    );

    fs.writeFileSync(
      path.join(suppressProjectDir, 'unwanted.md'),
      `---
description: Global agent to suppress
disabled: true
---`,
    );

    const result = await loadAllAgents(suppressGlobalDir, suppressProjectDir);
    const unwanted = result.agents.find((a) => a.name === 'unwanted');
    expect(unwanted).toBeUndefined();

    fs.rmSync(suppressGlobalDir, { recursive: true, force: true });
    fs.rmSync(suppressProjectDir, { recursive: true, force: true });
  });

  it('handles nonexistent directories gracefully', async () => {
    const result = await loadAllAgents(
      '/nonexistent/global',
      '/nonexistent/project',
    );
    expect(result.agents).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

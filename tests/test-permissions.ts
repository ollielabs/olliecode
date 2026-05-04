import { describe, expect, it } from 'bun:test';

import {
  disabled,
  evaluate,
  fromConfig,
  merge,
} from '../src/agent/permission/index';
import type {
  PermissionConfig,
  PermissionRuleset,
} from '../src/agent/permission/types';

// ─── fromConfig ──────────────────────────────────────────────────────

describe('fromConfig', () => {
  it('normalizes a simple action to a wildcard-pattern entry', () => {
    const config: PermissionConfig = { read: 'allow' };
    const ruleset = fromConfig(config);
    expect(ruleset).toEqual([
      { permission: 'read', pattern: '*', action: 'allow' },
    ]);
  });

  it('normalizes a wildcard default', () => {
    const config: PermissionConfig = { '*': 'deny' };
    const ruleset = fromConfig(config);
    expect(ruleset).toEqual([
      { permission: '*', pattern: '*', action: 'deny' },
    ]);
  });

  it('normalizes an object rule with patterns', () => {
    const config: PermissionConfig = {
      bash: { '*': 'deny', 'git diff*': 'allow' },
    };
    const ruleset = fromConfig(config);
    expect(ruleset).toEqual([
      { permission: 'bash', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: 'git diff*', action: 'allow' },
    ]);
  });

  it('preserves insertion order across mixed rules', () => {
    const config: PermissionConfig = {
      '*': 'deny',
      read: 'allow',
      glob: 'allow',
      bash: { '*': 'deny', 'git diff*': 'allow', 'bun test*': 'allow' },
    };
    const ruleset = fromConfig(config);
    expect(ruleset).toHaveLength(6);
    expect(ruleset[0]).toEqual({
      permission: '*',
      pattern: '*',
      action: 'deny',
    });
    expect(ruleset[1]).toEqual({
      permission: 'read',
      pattern: '*',
      action: 'allow',
    });
    expect(ruleset[5]).toEqual({
      permission: 'bash',
      pattern: 'bun test*',
      action: 'allow',
    });
  });

  it('returns empty ruleset for empty config', () => {
    const ruleset = fromConfig({});
    expect(ruleset).toEqual([]);
  });
});

// ─── evaluate ────────────────────────────────────────────────────────

describe('evaluate', () => {
  it("returns 'allow' by default when no rules match", () => {
    const result = evaluate('read', '*');
    expect(result).toBe('allow');
  });

  it("returns 'allow' for empty ruleset", () => {
    const result = evaluate('read', '*', []);
    expect(result).toBe('allow');
  });

  it('wildcard default denies everything', () => {
    const ruleset = fromConfig({ '*': 'deny' });
    expect(evaluate('read', '*', ruleset)).toBe('deny');
    expect(evaluate('edit', '*', ruleset)).toBe('deny');
    expect(evaluate('bash', 'ls', ruleset)).toBe('deny');
    expect(evaluate('anything_unknown', '*', ruleset)).toBe('deny');
  });

  it('specific permission overrides wildcard default', () => {
    const ruleset = fromConfig({ '*': 'deny', read: 'allow' });
    expect(evaluate('read', '*', ruleset)).toBe('allow');
    expect(evaluate('edit', '*', ruleset)).toBe('deny');
  });

  it('last-match-wins within a ruleset', () => {
    const ruleset = fromConfig({ read: 'deny', '*': 'allow' });
    // "*": "allow" comes after "read": "deny", and "*" matches "read" permission
    expect(evaluate('read', '*', ruleset)).toBe('allow');
  });

  it('glob pattern matching for bash commands', () => {
    const ruleset = fromConfig({
      bash: { '*': 'deny', 'git diff*': 'allow', 'git log*': 'allow' },
    });
    expect(evaluate('bash', 'git diff HEAD', ruleset)).toBe('allow');
    expect(evaluate('bash', 'git diff', ruleset)).toBe('allow');
    expect(evaluate('bash', 'git log --oneline', ruleset)).toBe('allow');
    expect(evaluate('bash', 'rm -rf /', ruleset)).toBe('deny');
    expect(evaluate('bash', 'git push', ruleset)).toBe('deny');
  });

  it('glob pattern with ** for recursive path matching', () => {
    const ruleset = fromConfig({
      read: { '*': 'deny', 'src/**': 'allow' },
    });
    expect(evaluate('read', 'src/index.ts', ruleset)).toBe('allow');
    expect(evaluate('read', 'src/agent/permission/types.ts', ruleset)).toBe(
      'allow',
    );
    expect(evaluate('read', 'node_modules/foo.ts', ruleset)).toBe('deny');
  });

  it('glob pattern with ? for single character', () => {
    const ruleset = fromConfig({
      read: { '*': 'deny', '?.ts': 'allow' },
    });
    expect(evaluate('read', 'a.ts', ruleset)).toBe('allow');
    expect(evaluate('read', 'ab.ts', ruleset)).toBe('deny');
  });

  it('unknown permission keys pass through', () => {
    const ruleset = fromConfig({ '*': 'deny', websearch: 'allow' });
    expect(evaluate('websearch', '*', ruleset)).toBe('allow');
    expect(evaluate('codesearch', '*', ruleset)).toBe('deny');
  });

  it('ask action works correctly', () => {
    const ruleset = fromConfig({ '*': 'deny', edit: 'ask' });
    expect(evaluate('edit', '*', ruleset)).toBe('ask');
    expect(evaluate('read', '*', ruleset)).toBe('deny');
  });

  it('multiple rulesets — later rulesets override earlier', () => {
    const base = fromConfig({ '*': 'deny' });
    const override = fromConfig({ read: 'allow' });
    expect(evaluate('read', '*', base, override)).toBe('allow');
    expect(evaluate('edit', '*', base, override)).toBe('deny');
  });

  it('multiple rulesets — last match across all rulesets wins', () => {
    const base = fromConfig({ read: 'allow' });
    const override = fromConfig({ read: 'deny' });
    expect(evaluate('read', '*', base, override)).toBe('deny');
  });

  it('pattern-specific rules override permission-level wildcard', () => {
    const ruleset = fromConfig({
      bash: { '*': 'deny', 'bun test*': 'allow' },
    });
    expect(evaluate('bash', 'bun test src/', ruleset)).toBe('allow');
    expect(evaluate('bash', 'bun run build', ruleset)).toBe('deny');
  });

  it('wildcard permission + specific permission interaction', () => {
    // "*": "deny" denies all, then "bash" with specific pattern allows some
    const ruleset = fromConfig({
      '*': 'deny',
      bash: { '*': 'deny', 'git diff*': 'allow' },
    });
    expect(evaluate('bash', 'git diff HEAD', ruleset)).toBe('allow');
    expect(evaluate('bash', 'rm -rf', ruleset)).toBe('deny');
    expect(evaluate('read', '*', ruleset)).toBe('deny');
  });

  it('exact string match works without glob', () => {
    const ruleset = fromConfig({
      task: { '*': 'deny', explore: 'allow' },
    });
    expect(evaluate('task', 'explore', ruleset)).toBe('allow');
    expect(evaluate('task', 'reviewer', ruleset)).toBe('deny');
  });

  it('handles empty string input', () => {
    const ruleset = fromConfig({ bash: { '*': 'deny' } });
    expect(evaluate('bash', '', ruleset)).toBe('deny');
  });

  it('handles regex metacharacters in patterns', () => {
    const ruleset = fromConfig({
      bash: { '*': 'deny', 'echo (hello)': 'allow' },
    });
    expect(evaluate('bash', 'echo (hello)', ruleset)).toBe('allow');
    expect(evaluate('bash', 'echo hello', ruleset)).toBe('deny');
  });

  it('mcp qualified name patterns', () => {
    const ruleset = fromConfig({
      mcp: { '*': 'deny', 'mcp__github__*': 'allow' },
    });
    expect(evaluate('mcp', 'mcp__github__create_pr', ruleset)).toBe('allow');
    expect(evaluate('mcp', 'mcp__github__list_issues', ruleset)).toBe('allow');
    expect(evaluate('mcp', 'mcp__slack__send', ruleset)).toBe('deny');
  });
});

// ─── merge ───────────────────────────────────────────────────────────

describe('merge', () => {
  it('concatenates rulesets in order', () => {
    const a: PermissionRuleset = [
      { permission: '*', pattern: '*', action: 'deny' },
    ];
    const b: PermissionRuleset = [
      { permission: 'read', pattern: '*', action: 'allow' },
    ];
    const merged = merge(a, b);
    expect(merged).toEqual([
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'read', pattern: '*', action: 'allow' },
    ]);
  });

  it('returns empty array for no arguments', () => {
    expect(merge()).toEqual([]);
  });

  it('returns shallow copy for single argument', () => {
    const a: PermissionRuleset = [
      { permission: 'read', pattern: '*', action: 'allow' },
    ];
    const merged = merge(a);
    expect(merged).toEqual(a);
  });

  it('merges three rulesets correctly', () => {
    const a = fromConfig({ '*': 'deny' });
    const b = fromConfig({ read: 'allow' });
    const c = fromConfig({ read: 'deny' });
    const merged = merge(a, b, c);
    expect(merged).toHaveLength(3);
    // Last entry is read:deny from c
    expect(merged[2]).toEqual({
      permission: 'read',
      pattern: '*',
      action: 'deny',
    });
  });
});

// ─── disabled ────────────────────────────────────────────────────────

describe('disabled', () => {
  it('returns denied wildcard-pattern permissions', () => {
    const ruleset = fromConfig({
      '*': 'deny',
      read: 'allow',
      glob: 'allow',
    });
    const result = disabled(ruleset);
    expect(result.has('*')).toBe(true);
    expect(result.has('read')).toBe(false);
    expect(result.has('glob')).toBe(false);
  });

  it('returns empty set for all-allow ruleset', () => {
    const ruleset = fromConfig({ '*': 'allow' });
    const result = disabled(ruleset);
    expect(result.size).toBe(0);
  });

  it('returns empty set for empty ruleset', () => {
    const result = disabled([]);
    expect(result.size).toBe(0);
  });

  it('does not include permissions with pattern-specific denies only', () => {
    // bash has specific pattern denies but no wildcard deny
    const ruleset: PermissionRuleset = [
      { permission: 'bash', pattern: 'rm*', action: 'deny' },
      { permission: 'bash', pattern: 'git diff*', action: 'allow' },
    ];
    const result = disabled(ruleset);
    expect(result.has('bash')).toBe(false);
  });

  it('tracks last wildcard action per permission', () => {
    // read is first denied then allowed — should NOT be disabled
    const ruleset: PermissionRuleset = [
      { permission: 'read', pattern: '*', action: 'deny' },
      { permission: 'read', pattern: '*', action: 'allow' },
    ];
    const result = disabled(ruleset);
    expect(result.has('read')).toBe(false);
  });

  it('includes ask as not disabled', () => {
    const ruleset = fromConfig({ edit: 'ask' });
    const result = disabled(ruleset);
    expect(result.has('edit')).toBe(false);
  });

  it('complex example: reviewer agent permissions', () => {
    const ruleset = fromConfig({
      '*': 'deny',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      bash: { '*': 'deny', 'git diff*': 'allow' },
    });
    const result = disabled(ruleset);
    expect(result.has('*')).toBe(true);
    expect(result.has('bash')).toBe(true);
    expect(result.has('read')).toBe(false);
    expect(result.has('glob')).toBe(false);
    expect(result.has('grep')).toBe(false);
  });

  it('propagates wildcard deny to known keys without explicit override', () => {
    const ruleset = fromConfig({
      '*': 'deny',
      read: 'allow',
    });
    const knownKeys = ['read', 'edit', 'bash', 'glob'];
    const result = disabled(ruleset, knownKeys);
    // read has explicit allow — not disabled
    expect(result.has('read')).toBe(false);
    // edit, bash, glob have no override — disabled via wildcard
    expect(result.has('edit')).toBe(true);
    expect(result.has('bash')).toBe(true);
    expect(result.has('glob')).toBe(true);
    // * itself is disabled
    expect(result.has('*')).toBe(true);
  });

  it('does not propagate when wildcard is not denied', () => {
    const ruleset = fromConfig({ '*': 'allow', edit: 'deny' });
    const knownKeys = ['read', 'edit', 'bash'];
    const result = disabled(ruleset, knownKeys);
    expect(result.has('edit')).toBe(true);
    expect(result.has('read')).toBe(false);
    expect(result.has('bash')).toBe(false);
  });

  it('without knownKeys, behaves as before (no propagation)', () => {
    const ruleset = fromConfig({ '*': 'deny' });
    const result = disabled(ruleset);
    expect(result.has('*')).toBe(true);
    // Without knownKeys, edit is not in the result
    expect(result.has('edit')).toBe(false);
  });
});

// ─── Integration: full agent permission scenarios ────────────────────

describe('integration scenarios', () => {
  it('reviewer agent: read-only + selective bash', () => {
    const config: PermissionConfig = {
      '*': 'deny',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      bash: {
        '*': 'deny',
        'git diff*': 'allow',
        'git log*': 'allow',
        'bun test*': 'allow',
      },
      mcp: {
        '*': 'deny',
        'mcp__github__*': 'allow',
      },
      task: {
        '*': 'deny',
        explore: 'allow',
      },
    };

    const ruleset = fromConfig(config);

    // Allowed
    expect(evaluate('read', 'src/index.ts', ruleset)).toBe('allow');
    expect(evaluate('glob', '**/*.ts', ruleset)).toBe('allow');
    expect(evaluate('grep', 'function', ruleset)).toBe('allow');
    expect(evaluate('bash', 'git diff HEAD~1', ruleset)).toBe('allow');
    expect(evaluate('bash', 'git log --oneline -10', ruleset)).toBe('allow');
    expect(evaluate('bash', 'bun test src/', ruleset)).toBe('allow');
    expect(evaluate('mcp', 'mcp__github__create_pr', ruleset)).toBe('allow');
    expect(evaluate('task', 'explore', ruleset)).toBe('allow');

    // Denied
    expect(evaluate('edit', 'src/index.ts', ruleset)).toBe('deny');
    expect(evaluate('bash', 'rm -rf /', ruleset)).toBe('deny');
    expect(evaluate('bash', 'npm install', ruleset)).toBe('deny');
    expect(evaluate('mcp', 'mcp__slack__send', ruleset)).toBe('deny');
    expect(evaluate('task', 'build', ruleset)).toBe('deny');
    expect(evaluate('todo', '*', ruleset)).toBe('deny');
    expect(evaluate('web_fetch', '*', ruleset)).toBe('deny');
  });

  it('build agent: full access', () => {
    const ruleset = fromConfig({ '*': 'allow' });
    expect(evaluate('read', '*', ruleset)).toBe('allow');
    expect(evaluate('edit', '*', ruleset)).toBe('allow');
    expect(evaluate('bash', 'anything', ruleset)).toBe('allow');
  });

  it('plan agent: deny edits only', () => {
    const ruleset = fromConfig({ edit: 'deny' });
    // edit is denied
    expect(evaluate('edit', 'src/index.ts', ruleset)).toBe('deny');
    // everything else defaults to allow (no matching rule → default allow)
    expect(evaluate('read', '*', ruleset)).toBe('allow');
    expect(evaluate('bash', 'ls', ruleset)).toBe('allow');
  });

  it('safety ceiling: global safety overrides agent permissions', () => {
    const agentRuleset = fromConfig({ '*': 'allow' });
    const safetyRuleset = fromConfig({ bash: { 'rm -rf*': 'deny' } });

    // Agent allows everything, but safety ceiling denies dangerous commands
    // Safety comes after agent (later rulesets win)
    expect(evaluate('bash', 'rm -rf /', agentRuleset, safetyRuleset)).toBe(
      'deny',
    );
    expect(evaluate('bash', 'git diff', agentRuleset, safetyRuleset)).toBe(
      'allow',
    );
  });
});

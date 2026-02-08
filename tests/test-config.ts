/**
 * Unit tests for the config module.
 *
 * Run with: bun test tests/test-config.ts
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { validatePath } from '../src/agent/safety/path-validation';
import type { SafetyConfig } from '../src/agent/safety/types';
import { DEFAULT_SAFETY_CONFIG } from '../src/agent/safety/types';
import { getConfigDirectory } from '../src/config/index';
import {
  buildCliOverrides,
  deepMerge,
  mergeConfigs,
} from '../src/config/merge';
import { deleteAtPath, parseConfigString } from '../src/config/parse';
import { extractSafetyConfig, resolvePermissions } from '../src/config/resolve';
import { ConfigSchema } from '../src/config/schema';

// === deleteAtPath ===

describe('deleteAtPath', () => {
  test('deletes a top-level key', () => {
    const obj: Record<string, unknown> = { a: 1, b: 2 };
    deleteAtPath(obj, ['a']);
    expect(obj).toEqual({ b: 2 });
  });

  test('deletes a nested key', () => {
    const obj: Record<string, unknown> = { a: { b: { c: 3 }, d: 4 } };
    deleteAtPath(obj, ['a', 'b', 'c']);
    expect(obj).toEqual({ a: { b: {}, d: 4 } });
  });

  test('no-ops on empty path', () => {
    const obj = { a: 1 };
    deleteAtPath(obj, []);
    expect(obj).toEqual({ a: 1 });
  });

  test('no-ops on non-existent path', () => {
    const obj = { a: 1 };
    deleteAtPath(obj, ['x', 'y']);
    expect(obj).toEqual({ a: 1 });
  });

  test('splices array element by index', () => {
    const obj = { items: ['a', 'b', 'c'] };
    deleteAtPath(obj, ['items', '1']);
    expect(obj.items).toEqual(['a', 'c']);
  });

  test('deletes nested key inside array element', () => {
    const obj: Record<string, unknown> = {
      list: [{ name: 'bad', keep: true }],
    };
    deleteAtPath(obj, ['list', '0', 'name']);
    expect((obj.list as unknown[])[0]).toEqual({ keep: true });
  });

  test('no-ops on out-of-bounds array index', () => {
    const obj = { items: ['a'] };
    deleteAtPath(obj, ['items', '5']);
    expect(obj.items).toEqual(['a']);
  });

  test('handles numeric path segments', () => {
    const obj = { items: ['x', 'y', 'z'] };
    deleteAtPath(obj, ['items', 0]);
    expect(obj.items).toEqual(['y', 'z']);
  });
});

// === deepMerge ===

describe('deepMerge', () => {
  test('overrides primitives', () => {
    const result = deepMerge({ a: 1 }, { a: 2 });
    expect(result.a).toBe(2);
  });

  test('preserves keys not in override', () => {
    const result = deepMerge({ a: 1, b: 2 }, { a: 3 });
    expect(result).toEqual({ a: 3, b: 2 });
  });

  test('deep merges nested objects', () => {
    const result = deepMerge(
      { agent: { maxIterations: 15, loopDetection: true } },
      { agent: { maxIterations: 25 } },
    );
    expect(result.agent).toEqual({ maxIterations: 25, loopDetection: true });
  });

  test('concatenates and deduplicates instructions', () => {
    const result = deepMerge(
      { instructions: ['AGENTS.md', 'RULES.md'] },
      { instructions: ['RULES.md', 'PROJECT.md'] },
    );
    expect(result.instructions).toEqual([
      'AGENTS.md',
      'RULES.md',
      'PROJECT.md',
    ]);
  });

  test('replaces non-instructions arrays', () => {
    const result = deepMerge(
      { safety: { deniedPaths: ['.env', '*.pem'] } },
      { safety: { deniedPaths: ['*.key'] } },
    );
    expect((result.safety as Record<string, unknown>).deniedPaths).toEqual([
      '*.key',
    ]);
  });

  test('handles empty override', () => {
    const base = { a: 1, b: { c: 2 } };
    const result = deepMerge(base, {});
    expect(result).toEqual(base);
  });

  test('handles empty base', () => {
    const result = deepMerge({}, { a: 1 });
    expect(result).toEqual({ a: 1 });
  });

  test('override adds new keys', () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

// === parseConfigString ===

describe('parseConfigString', () => {
  test('empty string returns defaults', () => {
    const result = parseConfigString('');
    expect(result.config.model).toBe('llama3.2:latest');
    expect(result.warnings).toHaveLength(0);
  });

  test('empty object returns defaults', () => {
    const result = parseConfigString('{}');
    expect(result.config.model).toBe('llama3.2:latest');
    expect(result.config.temperature).toBe(0.2);
  });

  test('valid partial config applies overrides', () => {
    const result = parseConfigString(
      '{"model": "qwen3:8b", "temperature": 0.5}',
    );
    expect(result.config.model).toBe('qwen3:8b');
    expect(result.config.temperature).toBe(0.5);
    expect(result.warnings).toHaveLength(0);
  });

  test('JSONC with comments parses correctly', () => {
    const result = parseConfigString('{ // comment\n  "model": "gemma2" }');
    expect(result.config.model).toBe('gemma2');
  });

  test('invalid field is stripped, valid fields preserved', () => {
    const result = parseConfigString(
      '{"model": "custom", "temperature": "bad"}',
    );
    expect(result.config.model).toBe('custom');
    expect(result.config.temperature).toBe(0.2); // default
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('temperature');
    expect(result.warnings[0]).toContain('using default');
  });

  test('multiple invalid fields stripped independently', () => {
    const result = parseConfigString(
      '{"model": "kept", "temperature": "bad", "debug": "also-bad"}',
    );
    expect(result.config.model).toBe('kept');
    expect(result.config.temperature).toBe(0.2);
    expect(result.config.debug).toBe(false);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  test('nested invalid field stripped, sibling preserved', () => {
    const result = parseConfigString(
      '{"agent": {"maxIterations": -5, "loopDetection": false}}',
    );
    expect(result.config.agent.loopDetection).toBe(false); // valid, preserved
    expect(result.config.agent.maxIterations).toBe(15); // invalid, defaulted
  });

  test('legacy top-level theme emits deprecation warning', () => {
    const result = parseConfigString('{"theme": "dark"}');
    expect(result.warnings.some((w) => w.includes('Deprecated'))).toBe(true);
  });

  test('throws on invalid JSONC syntax', () => {
    expect(() => parseConfigString('{bad json}')).toThrow('Invalid JSONC');
  });

  test('throws on non-object root', () => {
    expect(() => parseConfigString('"string"')).toThrow(
      'Config must be a JSON object',
    );
  });
});

// === resolvePermissions ===

describe('resolvePermissions', () => {
  test('cautious baseline allows reads, asks for writes', () => {
    const config = ConfigSchema.parse({});
    const perms = resolvePermissions(config);
    expect(perms.read_file).toBe('allow');
    expect(perms.list_dir).toBe('allow');
    expect(perms.glob).toBe('allow');
    expect(perms.write_file).toBe('ask');
    expect(perms.edit_file).toBe('ask');
    expect(perms.run_command).toBe('ask');
  });

  test('paranoid asks for everything', () => {
    const config = ConfigSchema.parse({ autonomy: 'paranoid' });
    const perms = resolvePermissions(config);
    expect(perms.read_file).toBe('ask');
    expect(perms.write_file).toBe('ask');
    expect(perms.run_command).toBe('ask');
  });

  test('autonomous allows everything', () => {
    const config = ConfigSchema.parse({ autonomy: 'autonomous' });
    const perms = resolvePermissions(config);
    expect(perms.read_file).toBe('allow');
    expect(perms.write_file).toBe('allow');
    expect(perms.edit_file).toBe('allow');
    expect(perms.run_command).toBe('allow');
  });

  test('explicit permission overrides baseline', () => {
    const config = ConfigSchema.parse({
      autonomy: 'cautious',
      permissions: { write_file: 'allow', run_command: 'deny' },
    });
    const perms = resolvePermissions(config);
    expect(perms.write_file).toBe('allow'); // overridden from ask
    expect(perms.run_command).toBe('deny'); // overridden from ask
    expect(perms.read_file).toBe('allow'); // unchanged baseline
  });

  test('override for unknown tool is included', () => {
    const config = ConfigSchema.parse({
      permissions: { custom_tool: 'deny' },
    });
    const perms = resolvePermissions(config);
    expect(perms.custom_tool).toBe('deny');
  });
});

// === buildCliOverrides ===

describe('buildCliOverrides', () => {
  test('includes only explicitly-set CLI flags', () => {
    const options = {
      model: 'qwen3',
      host: 'http://localhost:11434',
      debug: true,
    };
    const getSource = (key: string) => (key === 'model' ? 'cli' : 'default');
    const result = buildCliOverrides(options, getSource);
    expect(result).toEqual({ model: 'qwen3' });
  });

  test('returns empty object when nothing explicitly set', () => {
    const options = { model: 'llama3', host: 'http://localhost:11434' };
    const getSource = () => 'default';
    const result = buildCliOverrides(options, getSource);
    expect(result).toEqual({});
  });

  test('includes multiple explicit flags', () => {
    const options = {
      model: 'qwen3',
      host: 'http://custom:11434',
      autonomy: 'balanced',
      debug: true,
    };
    const getSource = () => 'cli';
    const result = buildCliOverrides(options, getSource);
    expect(result).toEqual({
      model: 'qwen3',
      host: 'http://custom:11434',
      autonomy: 'balanced',
      debug: true,
    });
  });
});

// === getConfigDirectory (XDG_CONFIG_HOME) ===

describe('getConfigDirectory', () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
  });

  test('uses XDG_CONFIG_HOME when set', () => {
    process.env.XDG_CONFIG_HOME = '/custom/config';
    expect(getConfigDirectory()).toBe('/custom/config/ollie');
  });

  test('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME;
    const result = getConfigDirectory();
    expect(result.endsWith(join('.config', 'ollie'))).toBe(true);
  });
});

// === mergeConfigs (partial recovery) ===

describe('mergeConfigs', () => {
  test('preserves valid settings when merged config has invalid field', () => {
    const result = mergeConfigs(
      { model: 'custom-model' },
      '/nonexistent',
      undefined,
      { temperature: 'not-a-number' },
    );
    expect(result.config.model).toBe('custom-model');
    expect(result.config.temperature).toBe(0.2); // default
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('temperature'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('using default'))).toBe(true);
  });

  test('preserves valid settings from multiple layers with one invalid', () => {
    const result = mergeConfigs(
      { model: 'base-model', debug: true },
      '/nonexistent',
      undefined,
      { autonomy: 'invalid-level' },
    );
    expect(result.config.model).toBe('base-model');
    expect(result.config.debug).toBe(true);
    expect(result.config.autonomy).toBe('cautious'); // default
  });
});

// === extractSafetyConfig ===

describe('extractSafetyConfig', () => {
  test('returns full SafetyConfig with correct toolPermissions for cautious', () => {
    const config = ConfigSchema.parse({});
    const safety = extractSafetyConfig(config, '/test/project');
    expect(safety.projectRoot).toBe('/test/project');
    expect(safety.autonomyLevel).toBe('cautious');
    expect(safety.toolPermissions.read_file).toBe('allow');
    expect(safety.toolPermissions.write_file).toBe('ask');
    expect(safety.toolPermissions.run_command).toBe('ask');
    expect(safety.toolPermissions.glob).toBe('allow');
  });

  test('returns correct permissions for autonomous', () => {
    const config = ConfigSchema.parse({ autonomy: 'autonomous' });
    const safety = extractSafetyConfig(config, '/test');
    expect(safety.toolPermissions.read_file).toBe('allow');
    expect(safety.toolPermissions.write_file).toBe('allow');
    expect(safety.toolPermissions.edit_file).toBe('allow');
    expect(safety.toolPermissions.run_command).toBe('allow');
  });

  test('applies permission overrides from config', () => {
    const config = ConfigSchema.parse({
      autonomy: 'cautious',
      permissions: { write_file: 'allow', run_command: 'deny' },
    });
    const safety = extractSafetyConfig(config, '/test');
    expect(safety.toolPermissions.write_file).toBe('allow');
    expect(safety.toolPermissions.run_command).toBe('deny');
    expect(safety.toolPermissions.read_file).toBe('allow'); // unchanged
    expect(safety.toolPermissions.edit_file).toBe('ask'); // unchanged
  });

  test('maps safety config values from schema', () => {
    const config = ConfigSchema.parse({
      safety: {
        maxFileSizeBytes: 50000,
        maxToolCallsPerTurn: 10,
        allowNetworkCommands: true,
      },
    });
    const safety = extractSafetyConfig(config, '/test');
    expect(safety.maxFileSizeBytes).toBe(50000);
    expect(safety.maxToolCallsPerTurn).toBe(10);
    expect(safety.allowNetworkCommands).toBe(true);
    expect(safety.enableAuditLog).toBe(true); // default
  });
});

// === Schema defaults match DEFAULT_SAFETY_CONFIG ===

describe('schema safety defaults', () => {
  test('deniedPaths defaults match DEFAULT_SAFETY_CONFIG', () => {
    const config = ConfigSchema.parse({});
    const schemaDefaults = config.safety.deniedPaths;
    const hardcoded = DEFAULT_SAFETY_CONFIG.deniedPaths;
    expect(hardcoded).toBeDefined();
    if (hardcoded) {
      expect(schemaDefaults).toEqual(hardcoded);
    }
  });

  test('deniedCommands defaults match DEFAULT_SAFETY_CONFIG', () => {
    const config = ConfigSchema.parse({});
    const schemaDefaults = config.safety.deniedCommands;
    const hardcoded = DEFAULT_SAFETY_CONFIG.deniedCommands;
    expect(hardcoded).toBeDefined();
    if (hardcoded) {
      expect(schemaDefaults).toEqual(hardcoded);
    }
  });

  test('toolPermissions for cautious match DEFAULT_SAFETY_CONFIG', () => {
    const config = ConfigSchema.parse({});
    const perms = resolvePermissions(config);
    expect(perms).toEqual(DEFAULT_SAFETY_CONFIG.toolPermissions);
  });
});

// === Path validation with trailing wildcard patterns ===

describe('path validation patterns', () => {
  const makeConfig = (deniedPaths: string[]): SafetyConfig => ({
    ...DEFAULT_SAFETY_CONFIG,
    projectRoot: '/project',
    deniedPaths,
  });

  test('id_rsa* matches id_rsa.pub', () => {
    const config = makeConfig(['id_rsa*']);
    const result = validatePath('.ssh/id_rsa.pub', config, 'write');
    expect(result.valid).toBe(false);
  });

  test('id_rsa* matches id_rsa (exact basename)', () => {
    const config = makeConfig(['id_rsa*']);
    const result = validatePath('id_rsa', config, 'write');
    expect(result.valid).toBe(false);
  });

  test('id_rsa* does not match my_id_rsa.pub (prefix must match)', () => {
    const config = makeConfig(['id_rsa*']);
    const result = validatePath('my_id_rsa.pub', config, 'write');
    expect(result.valid).toBe(true);
  });

  test('.env.* matches .env.local', () => {
    const config = makeConfig(['.env.*']);
    const result = validatePath('.env.local', config, 'write');
    expect(result.valid).toBe(false);
  });

  test('*.pem matches server.pem', () => {
    const config = makeConfig(['*.pem']);
    const result = validatePath('certs/server.pem', config, 'write');
    expect(result.valid).toBe(false);
  });

  test('.env matches nested .env', () => {
    const config = makeConfig(['.env']);
    const result = validatePath('config/.env', config, 'write');
    expect(result.valid).toBe(false);
  });
});

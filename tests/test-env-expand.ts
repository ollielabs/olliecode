/**
 * Unit tests for env-expand module.
 *
 * Run with: bun test tests/test-env-expand.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  expandArray,
  expandEnvVars,
  expandRecord,
} from '../src/config/env-expand';

describe('expandEnvVars', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TEST_VAR = 'hello';
    process.env.TEST_TOKEN = 'secret123';
    process.env.EMPTY_VAR = '';
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  // === ${VAR} syntax ===

  test('expands ${VAR} with existing env var', () => {
    expect(expandEnvVars('${TEST_VAR}')).toBe('hello');
  });

  test('expands ${VAR} embedded in string', () => {
    expect(expandEnvVars('Bearer ${TEST_TOKEN}')).toBe('Bearer secret123');
  });

  test('expands multiple ${VAR} in one string', () => {
    expect(expandEnvVars('${TEST_VAR} ${TEST_TOKEN}')).toBe('hello secret123');
  });

  test('expands missing ${VAR} to empty string', () => {
    expect(expandEnvVars('${NONEXISTENT_VAR}')).toBe('');
  });

  test('expands empty ${VAR} to empty string', () => {
    expect(expandEnvVars('${EMPTY_VAR}')).toBe('');
  });

  // === ${VAR:-default} syntax ===

  test('expands ${VAR:-default} uses env value when present', () => {
    expect(expandEnvVars('${TEST_VAR:-fallback}')).toBe('hello');
  });

  test('expands ${VAR:-default} uses fallback when missing', () => {
    expect(expandEnvVars('${MISSING:-fallback}')).toBe('fallback');
  });

  test('expands ${VAR:-default} with empty default', () => {
    expect(expandEnvVars('${MISSING:-}')).toBe('');
  });

  test('expands ${VAR:-default} with complex default', () => {
    expect(expandEnvVars('${MISSING:-http://localhost:3000}')).toBe(
      'http://localhost:3000',
    );
  });

  // === {env:VAR} syntax (OpenCode compat) ===

  test('expands {env:VAR} with existing env var', () => {
    expect(expandEnvVars('{env:TEST_VAR}')).toBe('hello');
  });

  test('expands {env:VAR} embedded in string', () => {
    expect(expandEnvVars('Bearer {env:TEST_TOKEN}')).toBe('Bearer secret123');
  });

  test('expands missing {env:VAR} to empty string', () => {
    expect(expandEnvVars('{env:NONEXISTENT}')).toBe('');
  });

  // === Mixed syntax ===

  test('expands mixed ${VAR} and {env:VAR} in same string', () => {
    expect(expandEnvVars('${TEST_VAR} and {env:TEST_TOKEN}')).toBe(
      'hello and secret123',
    );
  });

  // === No expansion needed ===

  test('returns plain string unchanged', () => {
    expect(expandEnvVars('no variables here')).toBe('no variables here');
  });

  test('returns empty string unchanged', () => {
    expect(expandEnvVars('')).toBe('');
  });
});

describe('expandRecord', () => {
  beforeEach(() => {
    process.env.TEST_KEY = 'expanded_value';
  });

  afterEach(() => {
    delete process.env.TEST_KEY;
  });

  test('expands all values in record', () => {
    const input = {
      KEY_A: '${TEST_KEY}',
      KEY_B: 'literal',
      KEY_C: 'prefix_${TEST_KEY}_suffix',
    };

    expect(expandRecord(input)).toEqual({
      KEY_A: 'expanded_value',
      KEY_B: 'literal',
      KEY_C: 'prefix_expanded_value_suffix',
    });
  });

  test('returns empty record for empty input', () => {
    expect(expandRecord({})).toEqual({});
  });

  test('does not modify keys', () => {
    const result = expandRecord({ '${TEST_KEY}': 'value' });
    expect(result).toEqual({ '${TEST_KEY}': 'value' });
  });
});

describe('expandArray', () => {
  beforeEach(() => {
    process.env.TEST_ARG = 'expanded';
  });

  afterEach(() => {
    delete process.env.TEST_ARG;
  });

  test('expands all elements in array', () => {
    expect(
      expandArray(['${TEST_ARG}', 'literal', '${MISSING:-default}']),
    ).toEqual(['expanded', 'literal', 'default']);
  });

  test('returns empty array for empty input', () => {
    expect(expandArray([])).toEqual([]);
  });
});

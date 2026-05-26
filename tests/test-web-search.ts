import { describe, expect, it } from 'bun:test';

import { BUILTIN_EXPLORE_AGENT } from '../src/agent/agents/builtins';
import {
  PERMISSION_KEY_TO_TOOLS,
  TOOL_TO_PERMISSION_KEY,
} from '../src/agent/agents/schema';
import {
  getToolDefinition,
  isToolAllowedByPermission,
} from '../src/agent/tools/index';

// ─── Tool definition ────────────────────────────────────────────────

describe('web_search tool definition', () => {
  it('is registered in the tool index', () => {
    const tool = getToolDefinition('web_search');
    expect(tool).toBeDefined();
  });

  it('has correct name', () => {
    const tool = getToolDefinition('web_search');
    expect(tool?.name).toBe('web_search');
  });

  it('has risk level "low"', () => {
    const tool = getToolDefinition('web_search');
    expect(tool?.risk).toBe('low');
  });

  it('has a description mentioning discovery', () => {
    const tool = getToolDefinition('web_search');
    expect(tool?.description).toContain('discovery');
  });

  it('has a description mentioning the current year', () => {
    const tool = getToolDefinition('web_search');
    const currentYear = new Date().getFullYear().toString();
    expect(tool?.description).toContain(currentYear);
  });

  it('has required query parameter', () => {
    const tool = getToolDefinition('web_search');
    const result = tool?.parameters.safeParse({});
    expect(result?.success).toBe(false);
  });

  it('accepts valid parameters', () => {
    const tool = getToolDefinition('web_search');
    const result = tool?.parameters.safeParse({ query: 'test query' });
    expect(result?.success).toBe(true);
  });

  it('accepts optional max_results', () => {
    const tool = getToolDefinition('web_search');
    const result = tool?.parameters.safeParse({
      query: 'test query',
      max_results: 3,
    });
    expect(result?.success).toBe(true);
  });

  it('rejects max_results above 10', () => {
    const tool = getToolDefinition('web_search');
    const result = tool?.parameters.safeParse({
      query: 'test query',
      max_results: 11,
    });
    expect(result?.success).toBe(false);
  });

  it('rejects max_results below 1', () => {
    const tool = getToolDefinition('web_search');
    const result = tool?.parameters.safeParse({
      query: 'test query',
      max_results: 0,
    });
    expect(result?.success).toBe(false);
  });
});

// ─── Permission system ──────────────────────────────────────────────

describe('web_search permissions', () => {
  it('has web_search key in PERMISSION_KEY_TO_TOOLS', () => {
    expect(PERMISSION_KEY_TO_TOOLS.web_search).toBeDefined();
    expect(PERMISSION_KEY_TO_TOOLS.web_search).toEqual(['web_search']);
  });

  it('has reverse mapping in TOOL_TO_PERMISSION_KEY', () => {
    expect(TOOL_TO_PERMISSION_KEY.web_search).toBe('web_search');
  });

  it('explore agent has web_search: allow', () => {
    expect(BUILTIN_EXPLORE_AGENT.permission?.web_search).toBe('allow');
  });

  it('explore agent allows web_search tool', () => {
    const permission = BUILTIN_EXPLORE_AGENT.permission;
    expect(permission).toBeDefined();
    expect(isToolAllowedByPermission('web_search', permission ?? {})).toBe(
      true,
    );
  });

  it('build agent allows web_search via wildcard', () => {
    const buildPermission = { '*': 'allow' as const };
    expect(isToolAllowedByPermission('web_search', buildPermission)).toBe(true);
  });

  it('plan agent allows web_search (no explicit deny)', () => {
    const planPermission = { edit: 'deny' as const };
    expect(isToolAllowedByPermission('web_search', planPermission)).toBe(true);
  });

  it('deny-all config blocks web_search', () => {
    const denyAll = { '*': 'deny' as const };
    expect(isToolAllowedByPermission('web_search', denyAll)).toBe(false);
  });

  it('user-defined agent can grant web_search', () => {
    const customPermission = {
      '*': 'deny' as const,
      web_search: 'allow' as const,
    };
    expect(isToolAllowedByPermission('web_search', customPermission)).toBe(
      true,
    );
  });
});

// ─── Result formatting (via execute) ────────────────────────────────

describe('web_search execute', () => {
  it('returns error for empty query', async () => {
    const tool = getToolDefinition('web_search');
    const result = await tool?.execute({ query: '   ', max_results: 5 });
    expect(result).toContain('Error');
    expect(result).toContain('empty');
  });

  it('returns error when OLLAMA_API_KEY is not set', async () => {
    const originalKey = process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_API_KEY;

    try {
      const tool = getToolDefinition('web_search');
      const result = await tool?.execute({
        query: 'test query',
        max_results: 5,
      });
      expect(result).toContain('Error');
      expect(result).toContain('OLLAMA_API_KEY');
    } finally {
      if (originalKey) {
        process.env.OLLAMA_API_KEY = originalKey;
      }
    }
  });
});

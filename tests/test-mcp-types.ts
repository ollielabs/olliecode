/**
 * Unit tests for MCP types, config schema, and McpManager.parseQualifiedName.
 *
 * Run with: bun test tests/test-mcp-types.ts
 */

import { describe, expect, test } from 'bun:test';
import { McpManager } from '../src/agent/mcp/manager';
import {
  isMcpToolReadOnly,
  mcpAnnotationsToRisk,
} from '../src/agent/mcp/types';
import type { McpToolInfo } from '../src/agent/mcp/types';
import { ConfigSchema, McpServerNameSchema } from '../src/config/schema';

// === mcpAnnotationsToRisk ===

describe('mcpAnnotationsToRisk', () => {
  test('returns medium for undefined annotations', () => {
    expect(mcpAnnotationsToRisk(undefined)).toBe('medium');
  });

  test('returns medium for empty annotations', () => {
    expect(mcpAnnotationsToRisk({})).toBe('medium');
  });

  test('returns high for destructiveHint', () => {
    expect(mcpAnnotationsToRisk({ destructiveHint: true })).toBe('high');
  });

  test('returns safe for readOnlyHint', () => {
    expect(mcpAnnotationsToRisk({ readOnlyHint: true })).toBe('safe');
  });

  test('destructiveHint takes precedence over readOnlyHint', () => {
    expect(
      mcpAnnotationsToRisk({ destructiveHint: true, readOnlyHint: true }),
    ).toBe('high');
  });

  test('returns medium for non-destructive, non-readOnly', () => {
    expect(mcpAnnotationsToRisk({ idempotentHint: true })).toBe('medium');
  });
});

// === isMcpToolReadOnly ===

describe('isMcpToolReadOnly', () => {
  const baseTool: McpToolInfo = {
    name: 'test',
    qualifiedName: 'mcp__server__test',
    description: 'test tool',
    inputSchema: {},
    serverName: 'server',
  };

  test('returns false when no annotations', () => {
    expect(isMcpToolReadOnly(baseTool)).toBe(false);
  });

  test('returns false when readOnlyHint is false', () => {
    expect(
      isMcpToolReadOnly({ ...baseTool, annotations: { readOnlyHint: false } }),
    ).toBe(false);
  });

  test('returns true when readOnlyHint is true', () => {
    expect(
      isMcpToolReadOnly({ ...baseTool, annotations: { readOnlyHint: true } }),
    ).toBe(true);
  });
});

// === McpManager.parseQualifiedName ===

describe('McpManager.parseQualifiedName', () => {
  test('parses simple mcp__server__tool', () => {
    expect(McpManager.parseQualifiedName('mcp__github__create_issue')).toEqual({
      serverName: 'github',
      toolName: 'create_issue',
    });
  });

  test('parses server name with single underscore', () => {
    expect(McpManager.parseQualifiedName('mcp__my_server__list_files')).toEqual(
      {
        serverName: 'my_server',
        toolName: 'list_files',
      },
    );
  });

  test('parses tool name with underscores', () => {
    expect(
      McpManager.parseQualifiedName('mcp__ctx7__resolve_library_id'),
    ).toEqual({
      serverName: 'ctx7',
      toolName: 'resolve_library_id',
    });
  });

  test('returns null for non-MCP tool name', () => {
    expect(McpManager.parseQualifiedName('read_file')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(McpManager.parseQualifiedName('')).toBeNull();
  });

  test('returns null for partial prefix', () => {
    expect(McpManager.parseQualifiedName('mcp__server')).toBeNull();
  });
});

// === MCP Server Name Validation ===

describe('McpServerNameSchema', () => {
  test('accepts valid names', () => {
    const valid = [
      'github',
      'my-server',
      'server1',
      'a',
      'test_server',
      'ctx7',
    ];
    for (const name of valid) {
      const result = McpServerNameSchema.safeParse(name);
      expect(result.success).toBe(true);
    }
  });

  test('rejects names starting with non-alphanumeric', () => {
    const invalid = ['-server', '_server', '.server', ''];
    for (const name of invalid) {
      const result = McpServerNameSchema.safeParse(name);
      expect(result.success).toBe(false);
    }
  });

  test('rejects names with uppercase', () => {
    const result = McpServerNameSchema.safeParse('GitHub');
    expect(result.success).toBe(false);
  });

  test('rejects names with double underscore', () => {
    const result = McpServerNameSchema.safeParse('my__server');
    expect(result.success).toBe(false);
  });

  test('rejects names with special characters', () => {
    const invalid = ['my.server', 'my server', 'my@server'];
    for (const name of invalid) {
      const result = McpServerNameSchema.safeParse(name);
      expect(result.success).toBe(false);
    }
  });
});

// === MCP Config Schema ===

describe('MCP config in ConfigSchema', () => {
  test('defaults mcp to empty object', () => {
    const result = ConfigSchema.parse({});
    expect(result.mcp).toEqual({});
  });

  test('accepts valid local server config', () => {
    const result = ConfigSchema.parse({
      mcp: {
        github: {
          type: 'local',
          command: ['npx', '-y', '@modelcontextprotocol/server-github'],
          environment: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
        },
      },
    });

    const github = result.mcp.github;
    expect(github).toBeDefined();
    expect(github!.type).toBe('local');
    expect(github!.enabled).toBe(true);
    expect(github!.timeout).toBe(10000);
    expect(github!.autoApprove).toEqual([]);
  });

  test('accepts valid remote server config', () => {
    const result = ConfigSchema.parse({
      mcp: {
        context7: {
          type: 'remote',
          url: 'https://mcp.context7.com/mcp',
          headers: { Authorization: 'Bearer ${API_KEY}' },
        },
      },
    });

    expect(result.mcp.context7).toBeDefined();
    expect(result.mcp.context7!.type).toBe('remote');
  });

  test('accepts disabled server', () => {
    const result = ConfigSchema.parse({
      mcp: {
        github: {
          type: 'local',
          command: ['echo'],
          enabled: false,
        },
      },
    });

    expect(result.mcp.github!.enabled).toBe(false);
  });

  test('rejects local server with empty command', () => {
    const result = ConfigSchema.safeParse({
      mcp: {
        github: {
          type: 'local',
          command: [],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test('rejects remote server without url', () => {
    const result = ConfigSchema.safeParse({
      mcp: {
        ctx: {
          type: 'remote',
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test('tools.mcp defaults correctly', () => {
    const result = ConfigSchema.parse({});
    expect(result.tools.mcp).toEqual({ maxOutputChars: 50000 });
  });

  test('tools.mcp.maxOutputChars can be customized', () => {
    const result = ConfigSchema.parse({
      tools: { mcp: { maxOutputChars: 100000 } },
    });
    expect(result.tools.mcp.maxOutputChars).toBe(100000);
  });

  test('rejects tools.mcp.maxOutputChars below minimum', () => {
    const result = ConfigSchema.safeParse({
      tools: { mcp: { maxOutputChars: 500 } },
    });
    expect(result.success).toBe(false);
  });
});

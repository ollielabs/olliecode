/**
 * Tests for MCP tool permissions integration (Issue #91).
 *
 * Verifies that resolvePermissions() correctly handles MCP tools:
 * - Default permissions based on autonomy level
 * - autoApprove per-server overrides
 * - Explicit permission overrides take highest priority
 * - extractSafetyConfig() threads mcpTools through
 *
 * Run with: bun test ./tests/test-mcp-permissions.ts
 */

import { describe, expect, test } from 'bun:test';
import type { McpToolInfo } from '../src/agent/mcp/types';
import { extractSafetyConfig, resolvePermissions } from '../src/config/resolve';
import { ConfigSchema } from '../src/config/schema';
import type { ResolvedConfig } from '../src/config/schema';

// Helper: create a minimal ResolvedConfig with overrides
function makeConfig(
  overrides: Partial<{
    autonomy: string;
    permissions: Record<string, string>;
    mcp: Record<string, unknown>;
  }>,
): ResolvedConfig {
  return ConfigSchema.parse({
    autonomy: overrides.autonomy ?? 'cautious',
    permissions: overrides.permissions ?? {},
    mcp: overrides.mcp ?? {},
  });
}

// Helper: create McpToolInfo
function makeMcpTool(
  serverName: string,
  name: string,
  readOnly = false,
): McpToolInfo {
  return {
    name,
    qualifiedName: `mcp__${serverName}__${name}`,
    description: `Test tool ${name}`,
    inputSchema: { type: 'object' },
    serverName,
    annotations: readOnly ? { readOnlyHint: true } : undefined,
  };
}

// === resolvePermissions with MCP tools ===

describe('resolvePermissions with MCP tools', () => {
  const echoTool = makeMcpTool('testserver', 'echo', true);
  const writeTool = makeMcpTool('testserver', 'write_file', false);
  const otherTool = makeMcpTool('other', 'query', true);

  test('MCP tools default to ask in cautious mode', () => {
    const config = makeConfig({ autonomy: 'cautious' });
    const perms = resolvePermissions(config, [echoTool, writeTool]);

    expect(perms['mcp__testserver__echo']).toBe('ask');
    expect(perms['mcp__testserver__write_file']).toBe('ask');
  });

  test('MCP tools default to ask in paranoid mode', () => {
    const config = makeConfig({ autonomy: 'paranoid' });
    const perms = resolvePermissions(config, [echoTool]);

    expect(perms['mcp__testserver__echo']).toBe('ask');
  });

  test('MCP tools default to ask in balanced mode', () => {
    const config = makeConfig({ autonomy: 'balanced' });
    const perms = resolvePermissions(config, [echoTool]);

    expect(perms['mcp__testserver__echo']).toBe('ask');
  });

  test('MCP tools default to allow in autonomous mode', () => {
    const config = makeConfig({ autonomy: 'autonomous' });
    const perms = resolvePermissions(config, [echoTool, writeTool]);

    expect(perms['mcp__testserver__echo']).toBe('allow');
    expect(perms['mcp__testserver__write_file']).toBe('allow');
  });

  test('autoApprove overrides default to allow', () => {
    const config = makeConfig({
      autonomy: 'cautious',
      mcp: {
        testserver: {
          type: 'local',
          command: ['echo'],
          autoApprove: ['echo'],
        },
      },
    });
    const perms = resolvePermissions(config, [echoTool, writeTool]);

    // echo is autoApproved
    expect(perms['mcp__testserver__echo']).toBe('allow');
    // write_file is not autoApproved — stays at default 'ask'
    expect(perms['mcp__testserver__write_file']).toBe('ask');
  });

  test('autoApprove only affects matching server', () => {
    const config = makeConfig({
      autonomy: 'cautious',
      mcp: {
        testserver: {
          type: 'local',
          command: ['echo'],
          autoApprove: ['echo'],
        },
      },
    });
    const perms = resolvePermissions(config, [echoTool, otherTool]);

    // testserver echo is autoApproved
    expect(perms['mcp__testserver__echo']).toBe('allow');
    // other server's query is not
    expect(perms['mcp__other__query']).toBe('ask');
  });

  test('explicit permission overrides take highest priority', () => {
    const config = makeConfig({
      autonomy: 'autonomous',
      permissions: {
        mcp__testserver__echo: 'deny',
      },
      mcp: {
        testserver: {
          type: 'local',
          command: ['echo'],
          autoApprove: ['echo'],
        },
      },
    });
    const perms = resolvePermissions(config, [echoTool]);

    // Even though autonomous + autoApprove, explicit override wins
    expect(perms['mcp__testserver__echo']).toBe('deny');
  });

  test('native tools unaffected by MCP tool registration', () => {
    const config = makeConfig({ autonomy: 'cautious' });
    const perms = resolvePermissions(config, [echoTool]);

    // Native tools keep their baseline permissions
    expect(perms['read_file']).toBe('allow');
    expect(perms['write_file']).toBe('ask');
    expect(perms['run_command']).toBe('ask');
  });

  test('no mcpTools arg works same as before', () => {
    const config = makeConfig({ autonomy: 'cautious' });
    const withMcp = resolvePermissions(config, []);
    const withoutMcp = resolvePermissions(config);

    // Same native tool permissions
    expect(withMcp['read_file']).toBe('allow');
    expect(withoutMcp['read_file']).toBe('allow');
    expect(withMcp['write_file']).toBe('ask');
    expect(withoutMcp['write_file']).toBe('ask');
  });

  test('undefined mcpTools works same as before', () => {
    const config = makeConfig({ autonomy: 'cautious' });
    const perms = resolvePermissions(config, undefined);

    expect(perms['read_file']).toBe('allow');
    expect(perms['write_file']).toBe('ask');
    // No MCP tools in the map
    expect(perms['mcp__testserver__echo']).toBeUndefined();
  });

  test('multiple servers register correctly', () => {
    const config = makeConfig({
      autonomy: 'cautious',
      mcp: {
        testserver: {
          type: 'local',
          command: ['echo'],
          autoApprove: ['echo'],
        },
        other: {
          type: 'local',
          command: ['other'],
          autoApprove: ['query'],
        },
      },
    });
    const perms = resolvePermissions(config, [echoTool, writeTool, otherTool]);

    expect(perms['mcp__testserver__echo']).toBe('allow');
    expect(perms['mcp__testserver__write_file']).toBe('ask');
    expect(perms['mcp__other__query']).toBe('allow');
  });

  test('stale autoApprove entries do not create phantom permissions', () => {
    const config = makeConfig({
      autonomy: 'cautious',
      mcp: {
        testserver: {
          type: 'local',
          command: ['echo'],
          autoApprove: ['nonexistent_tool', 'echo'],
        },
      },
    });
    // Only echo is in mcpTools — nonexistent_tool is not
    const perms = resolvePermissions(config, [echoTool]);

    expect(perms['mcp__testserver__echo']).toBe('allow');
    // No phantom entry for the stale autoApprove
    expect(perms['mcp__testserver__nonexistent_tool']).toBeUndefined();
  });

  test('MCP tool from unconfigured server defaults to ask', () => {
    // Server not in config.mcp at all
    const config = makeConfig({ autonomy: 'cautious' });
    const perms = resolvePermissions(config, [otherTool]);

    expect(perms['mcp__other__query']).toBe('ask');
  });
});

// === extractSafetyConfig with MCP tools ===

describe('extractSafetyConfig with MCP tools', () => {
  const echoTool = makeMcpTool('testserver', 'echo', true);
  const writeTool = makeMcpTool('testserver', 'write_file', false);

  test('MCP tool permissions appear in safety config', () => {
    const config = makeConfig({
      autonomy: 'cautious',
      mcp: {
        testserver: {
          type: 'local',
          command: ['echo'],
          autoApprove: ['echo'],
        },
      },
    });
    const safety = extractSafetyConfig(config, '/tmp/test', [
      echoTool,
      writeTool,
    ]);

    expect(safety.toolPermissions['mcp__testserver__echo']).toBe('allow');
    expect(safety.toolPermissions['mcp__testserver__write_file']).toBe('ask');
    // Native tools still present
    expect(safety.toolPermissions['read_file']).toBe('allow');
  });

  test('without mcpTools, safety config has no MCP permissions', () => {
    const config = makeConfig({ autonomy: 'cautious' });
    const safety = extractSafetyConfig(config, '/tmp/test');

    expect(safety.toolPermissions['mcp__testserver__echo']).toBeUndefined();
    expect(safety.toolPermissions['read_file']).toBe('allow');
  });

  test('autonomy level flows through to MCP permissions', () => {
    const config = makeConfig({ autonomy: 'autonomous' });
    const safety = extractSafetyConfig(config, '/tmp/test', [echoTool]);

    expect(safety.toolPermissions['mcp__testserver__echo']).toBe('allow');
    expect(safety.autonomyLevel).toBe('autonomous');
  });
});

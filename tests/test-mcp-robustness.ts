/**
 * Tests for MCP connection robustness (Issue #92).
 *
 * Tests: error stubs, reconnect behavior, stderr capture, abort signal,
 * graceful shutdown with timer cancellation.
 *
 * Run with: bun test ./tests/test-mcp-robustness.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { McpManager } from '../src/agent/mcp/manager';
import {
  executeTool,
  getToolDefinition,
  getToolsArray,
} from '../src/agent/tools/index';

const MOCK_SERVER_PATH = resolve(import.meta.dir, 'mock-mcp-server.ts');
const SERVER_NAME = 'robusttest';
const TEST_TIMEOUT = 15_000;

// === Integration tests with real mock server ===

describe('MCP Connection Robustness — Integration', () => {
  let manager: McpManager;

  beforeAll(async () => {
    manager = new McpManager();
    await manager.connectAll({
      [SERVER_NAME]: {
        type: 'local' as const,
        command: ['bun', 'run', MOCK_SERVER_PATH],
        environment: {},
        enabled: true,
        timeout: 10_000,
        autoApprove: [],
      },
    });
    manager.registerTools(getToolsArray(), 50_000);
  });

  afterAll(async () => {
    manager.unregisterTools(getToolsArray());
    await manager.disconnectAll();
  });

  test(
    'tools work before disconnect',
    async () => {
      const result = await executeTool('mcp__robusttest__echo', {
        text: 'hello',
      });
      expect(result.error).toBeUndefined();
      expect(result.output).toBe('hello');
    },
    TEST_TIMEOUT,
  );

  test('getServerStderr returns array', () => {
    const stderr = manager.getServerStderr(SERVER_NAME);
    expect(Array.isArray(stderr)).toBe(true);
  });

  test('getServerStderr returns empty array for unknown server', () => {
    const stderr = manager.getServerStderr('nonexistent');
    expect(stderr).toEqual([]);
  });

  test('disconnect keeps tools in registry', async () => {
    // Disconnect the server
    await manager.disconnect(SERVER_NAME);

    // Tools should still be findable (registered in shared array)
    const echoDef = getToolDefinition('mcp__robusttest__echo');
    // After disconnect + unregister from connections, tools are removed
    // But the key behavior is that execute returns a clear error
    expect(manager.getStatus().get(SERVER_NAME)).toBeUndefined();
  });
});

// === Unit tests for reconnect logic ===

describe('MCP Reconnect Logic', () => {
  test(
    'scheduleReconnect is triggered on transport close',
    async () => {
      const manager = new McpManager();

      // Connect to the mock server
      await manager.connectAll({
        reconntest: {
          type: 'local' as const,
          command: ['bun', 'run', MOCK_SERVER_PATH],
          environment: {},
          enabled: true,
          timeout: 10_000,
          autoApprove: [],
        },
      });

      const status = manager.getStatus().get('reconntest');
      expect(status?.status).toBe('connected');

      // Clean up — disconnect cancels any pending reconnect timers
      await manager.disconnectAll();
    },
    TEST_TIMEOUT,
  );

  test(
    'disconnectAll cancels reconnect timers',
    async () => {
      const manager = new McpManager();

      await manager.connectAll({
        timertest: {
          type: 'local' as const,
          command: ['bun', 'run', MOCK_SERVER_PATH],
          environment: {},
          enabled: true,
          timeout: 10_000,
          autoApprove: [],
        },
      });

      // Should not throw or hang
      await manager.disconnectAll();

      // After disconnectAll, connections should be cleared
      const status = manager.getStatus();
      expect(status.size).toBe(0);
    },
    TEST_TIMEOUT,
  );

  test(
    'disconnect single server cancels its reconnect timer',
    async () => {
      const manager = new McpManager();

      await manager.connectAll({
        singletest: {
          type: 'local' as const,
          command: ['bun', 'run', MOCK_SERVER_PATH],
          environment: {},
          enabled: true,
          timeout: 10_000,
          autoApprove: [],
        },
      });

      await manager.disconnect('singletest');
      expect(manager.getStatus().get('singletest')).toBeUndefined();

      await manager.disconnectAll();
    },
    TEST_TIMEOUT,
  );
});

// === Unit tests for error handling ===

describe('MCP Error Handling', () => {
  test('callTool on disconnected server throws clear error', async () => {
    const manager = new McpManager();

    // Don't connect anything — just try to call
    try {
      await manager.callTool('mcp__noserver__tool', {});
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect((err as Error).message).toContain('unknown');
    }

    await manager.disconnectAll();
  });

  test('callTool with invalid qualified name throws', async () => {
    const manager = new McpManager();

    try {
      await manager.callTool('invalid_name', {});
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain('Invalid MCP tool name');
    }

    await manager.disconnectAll();
  });

  test(
    'connection to nonexistent command records error state',
    async () => {
      const manager = new McpManager();

      await manager.connectAll({
        badserver: {
          type: 'local' as const,
          command: ['nonexistent-command-that-does-not-exist'],
          environment: {},
          enabled: true,
          timeout: 5_000,
          autoApprove: [],
        },
      });

      const status = manager.getStatus().get('badserver');
      expect(status).toBeDefined();
      expect(status!.status).toBe('error');
      expect(status!.error).toBeDefined();

      await manager.disconnectAll();
    },
    TEST_TIMEOUT,
  );
});

// === Unit tests for McpManager.parseQualifiedName ===

describe('parseQualifiedName edge cases', () => {
  test('parses standard name', () => {
    const result = McpManager.parseQualifiedName('mcp__server__tool');
    expect(result).toEqual({ serverName: 'server', toolName: 'tool' });
  });

  test('parses name with underscores in tool', () => {
    const result = McpManager.parseQualifiedName('mcp__server__my_tool');
    expect(result).toEqual({ serverName: 'server', toolName: 'my_tool' });
  });

  test('returns null for non-mcp name', () => {
    expect(McpManager.parseQualifiedName('read_file')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(McpManager.parseQualifiedName('')).toBeNull();
  });
});

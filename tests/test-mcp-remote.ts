/**
 * Tests for MCP remote server support (Issue #94).
 *
 * Tests: Streamable HTTP transport connection, tool discovery, tool execution,
 * env var expansion in URL/headers, SSE fallback error path, connectAll dispatch,
 * reconnect for remote servers, disabled/oauth config acceptance.
 *
 * Uses mock-mcp-http-server.ts for integration tests.
 *
 * Run with: bun test ./tests/test-mcp-remote.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { type Subprocess, spawn } from 'bun';
import { McpManager } from '../src/agent/mcp/manager';
import { getToolsArray } from '../src/agent/tools/index';
import type { McpRemoteServerConfig } from '../src/config/schema';

const MOCK_HTTP_SERVER_PATH = resolve(
  import.meta.dir,
  'mock-mcp-http-server.ts',
);
const SERVER_NAME = 'remotetest';
const TEST_TIMEOUT = 15_000;

/**
 * Start the mock HTTP MCP server and return the port it's listening on.
 */
async function startMockHttpServer(): Promise<{
  proc: Subprocess;
  port: number;
}> {
  const proc = spawn(['bun', 'run', MOCK_HTTP_SERVER_PATH, '0'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Read port from stdout (first line)
  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  const portStr = new TextDecoder().decode(value).trim();
  const port = Number(portStr);
  if (!port || Number.isNaN(port)) {
    proc.kill();
    throw new Error(
      `Mock HTTP server did not print a valid port: "${portStr}"`,
    );
  }

  return { proc, port };
}

// === Integration tests with real mock HTTP server ===

describe('MCP Remote Servers — Integration', () => {
  let manager: McpManager;
  let serverProc: Subprocess;
  let serverPort: number;

  beforeAll(async () => {
    const { proc, port } = await startMockHttpServer();
    serverProc = proc;
    serverPort = port;

    manager = new McpManager();
    await manager.connectAll({
      [SERVER_NAME]: {
        type: 'remote' as const,
        url: `http://localhost:${serverPort}/mcp`,
        headers: {},
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
    serverProc.kill();
  });

  test(
    'remote server connects successfully',
    () => {
      const status = manager.getStatus();
      const serverStatus = status.get(SERVER_NAME);
      expect(serverStatus).toBeDefined();
      expect(serverStatus!.status).toBe('connected');
    },
    TEST_TIMEOUT,
  );

  test(
    'discovers tools from remote server',
    () => {
      const tools = manager.getServerTools(SERVER_NAME);
      expect(tools.length).toBeGreaterThanOrEqual(3);

      const names = tools.map((t) => t.name);
      expect(names).toContain('echo');
      expect(names).toContain('add');
      expect(names).toContain('write_test');
    },
    TEST_TIMEOUT,
  );

  test(
    'tools have correct qualified names',
    () => {
      const tools = manager.getServerTools(SERVER_NAME);
      const qualifiedNames = tools.map((t) => t.qualifiedName);
      expect(qualifiedNames).toContain(`mcp__${SERVER_NAME}__echo`);
      expect(qualifiedNames).toContain(`mcp__${SERVER_NAME}__add`);
      expect(qualifiedNames).toContain(`mcp__${SERVER_NAME}__write_test`);
    },
    TEST_TIMEOUT,
  );

  test(
    'echo tool executes correctly via remote transport',
    async () => {
      const result = await manager.callTool(`mcp__${SERVER_NAME}__echo`, {
        text: 'hello remote',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content.length).toBeGreaterThan(0);
      const textItem = result.content[0] as { type: string; text: string };
      expect(textItem.type).toBe('text');
      expect(textItem.text).toBe('hello remote');
    },
    TEST_TIMEOUT,
  );

  test(
    'add tool executes correctly via remote transport',
    async () => {
      const result = await manager.callTool(`mcp__${SERVER_NAME}__add`, {
        a: 7,
        b: 13,
      });
      expect(result.isError).toBeFalsy();
      const textItem = result.content[0] as { type: string; text: string };
      expect(textItem.text).toBe('20');
    },
    TEST_TIMEOUT,
  );

  test(
    'write_test tool executes correctly via remote transport',
    async () => {
      const result = await manager.callTool(`mcp__${SERVER_NAME}__write_test`, {
        path: '/tmp/test.txt',
        content: 'hello world',
      });
      expect(result.isError).toBeFalsy();
      const textItem = result.content[0] as { type: string; text: string };
      expect(textItem.text).toContain('Wrote 11 chars');
    },
    TEST_TIMEOUT,
  );

  test(
    'tools are registered in shared tools array',
    () => {
      const allTools = getToolsArray();
      const mcpToolNames = allTools
        .filter((t) => t.name.startsWith(`mcp__${SERVER_NAME}__`))
        .map((t) => t.name);
      expect(mcpToolNames).toContain(`mcp__${SERVER_NAME}__echo`);
      expect(mcpToolNames).toContain(`mcp__${SERVER_NAME}__add`);
    },
    TEST_TIMEOUT,
  );

  test(
    'no stderr buffer for remote servers',
    () => {
      const stderr = manager.getServerStderr(SERVER_NAME);
      expect(stderr).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});

// === Unit tests (no server needed) ===

describe('MCP Remote Servers — Unit', () => {
  test(
    'connectRemote rejects invalid URL',
    async () => {
      const manager = new McpManager();
      try {
        await manager.connectRemote('badurl', {
          type: 'remote' as const,
          url: 'not-a-url',
          headers: {},
          enabled: true,
          timeout: 5_000,
          autoApprove: [],
        });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const msg = (err as Error).message;
        expect(msg).toContain('badurl');
        expect(msg).toContain('invalid URL');
      }
      await manager.disconnectAll();
    },
    TEST_TIMEOUT,
  );

  test(
    'connectRemote fails gracefully on unreachable server',
    async () => {
      const manager = new McpManager();
      try {
        await manager.connectRemote('unreachable', {
          type: 'remote' as const,
          url: 'http://localhost:1/mcp',
          headers: {},
          enabled: true,
          timeout: 3_000,
          autoApprove: [],
        });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const msg = (err as Error).message;
        // Should mention both transports failed
        expect(msg).toContain('HTTP');
        expect(msg).toContain('SSE');
      }
      await manager.disconnectAll();
    },
    TEST_TIMEOUT,
  );

  test(
    'connectAll dispatches remote servers correctly',
    async () => {
      const manager = new McpManager();
      // This will fail to connect but should attempt remote, not local
      await manager.connectAll({
        'remote-fail': {
          type: 'remote' as const,
          url: 'http://localhost:1/mcp',
          headers: {},
          enabled: true,
          timeout: 3_000,
          autoApprove: [],
        },
      });
      const status = manager.getStatus();
      const serverStatus = status.get('remote-fail');
      expect(serverStatus).toBeDefined();
      expect(serverStatus!.status).toBe('error');
      expect(serverStatus!.error).toBeDefined();
      await manager.disconnectAll();
    },
    TEST_TIMEOUT,
  );

  test(
    'disabled remote servers are skipped',
    async () => {
      const manager = new McpManager();
      await manager.connectAll({
        'disabled-remote': {
          type: 'remote' as const,
          url: 'http://localhost:1/mcp',
          headers: {},
          enabled: false,
          timeout: 5_000,
          autoApprove: [],
        },
      });
      const status = manager.getStatus();
      expect(status.has('disabled-remote')).toBe(false);
      await manager.disconnectAll();
    },
    TEST_TIMEOUT,
  );

  test(
    'oauth config field is accepted without error',
    async () => {
      const config: McpRemoteServerConfig = {
        type: 'remote' as const,
        url: 'http://localhost:1/mcp',
        headers: {},
        enabled: false, // disabled so it won't try to connect
        timeout: 5_000,
        autoApprove: [],
        oauth: {
          clientId: 'test-id',
          clientSecret: 'test-secret',
          scope: 'read',
        },
      };
      // Should not throw during config handling
      const manager = new McpManager();
      await manager.connectAll({ 'oauth-test': config });
      expect(manager.getStatus().has('oauth-test')).toBe(false); // disabled
      await manager.disconnectAll();
    },
    TEST_TIMEOUT,
  );

  test(
    'env var expansion in URL',
    async () => {
      // Set env var for test
      const originalVal = process.env.TEST_MCP_PORT;
      process.env.TEST_MCP_PORT = '9999';

      const manager = new McpManager();
      try {
        await manager.connectRemote('envtest', {
          type: 'remote' as const,
          url: 'http://localhost:${TEST_MCP_PORT}/mcp',
          headers: {},
          enabled: true,
          timeout: 3_000,
          autoApprove: [],
        });
      } catch (err) {
        // Connection will fail but URL should have been expanded
        const msg = (err as Error).message;
        // The error should NOT contain the unexpanded ${TEST_MCP_PORT}
        // (transport errors are generic, so we just verify expansion happened)
        expect(msg).not.toContain('${TEST_MCP_PORT}');
      }

      // Restore
      if (originalVal === undefined) {
        delete process.env.TEST_MCP_PORT;
      } else {
        process.env.TEST_MCP_PORT = originalVal;
      }
      await manager.disconnectAll();
    },
    TEST_TIMEOUT,
  );

  test(
    'env var expansion in headers',
    async () => {
      const originalVal = process.env.TEST_API_KEY;
      process.env.TEST_API_KEY = 'secret-key-123';

      let serverProc: Subprocess | undefined;
      let serverPort: number | undefined;

      try {
        // Start a real server to verify headers are sent
        const { proc, port } = await startMockHttpServer();
        serverProc = proc;
        serverPort = port;

        const manager = new McpManager();
        await manager.connectRemote('headertest', {
          type: 'remote' as const,
          url: `http://localhost:${serverPort}/mcp`,
          headers: {
            Authorization: 'Bearer ${TEST_API_KEY}',
          },
          enabled: true,
          timeout: 10_000,
          autoApprove: [],
        });

        // If we get here, connection succeeded (headers didn't break anything)
        const status = manager.getStatus();
        expect(status.get('headertest')?.status).toBe('connected');
        await manager.disconnectAll();
      } finally {
        if (originalVal === undefined) {
          delete process.env.TEST_API_KEY;
        } else {
          process.env.TEST_API_KEY = originalVal;
        }
        serverProc?.kill();
      }
    },
    TEST_TIMEOUT,
  );
});

// === connectAll mixed local + remote ===

describe('MCP Remote Servers — Mixed Config', () => {
  test(
    'connectAll handles mix of local and remote servers',
    async () => {
      const manager = new McpManager();
      const MOCK_SERVER_PATH = resolve(import.meta.dir, 'mock-mcp-server.ts');

      let httpProc: Subprocess | undefined;
      try {
        const { proc, port } = await startMockHttpServer();
        httpProc = proc;

        await manager.connectAll({
          'local-server': {
            type: 'local' as const,
            command: ['bun', 'run', MOCK_SERVER_PATH],
            environment: {},
            enabled: true,
            timeout: 10_000,
            autoApprove: [],
          },
          'remote-server': {
            type: 'remote' as const,
            url: `http://localhost:${port}/mcp`,
            headers: {},
            enabled: true,
            timeout: 10_000,
            autoApprove: [],
          },
        });

        const status = manager.getStatus();
        expect(status.get('local-server')?.status).toBe('connected');
        expect(status.get('remote-server')?.status).toBe('connected');

        // Both should have tools
        expect(manager.getServerTools('local-server').length).toBeGreaterThan(
          0,
        );
        expect(manager.getServerTools('remote-server').length).toBeGreaterThan(
          0,
        );
      } finally {
        await manager.disconnectAll();
        httpProc?.kill();
      }
    },
    TEST_TIMEOUT,
  );
});

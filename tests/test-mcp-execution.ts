/**
 * Integration tests for MCP tool registration and execution (Issue #90).
 *
 * Tests the full round-trip: config -> connect -> discover -> register -> call -> validate.
 * Uses the mock MCP server (tests/mock-mcp-server.ts) via stdio transport.
 *
 * Run with: bun test ./tests/test-mcp-execution.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { McpManager, createMcpToolDef } from '../src/agent/mcp/manager';
import type { McpToolInfo } from '../src/agent/mcp/types';
import {
  executeTool,
  getOllamaTools,
  getToolDefinition,
  getToolsArray,
  getToolsForMode,
} from '../src/agent/tools/index';

const MOCK_SERVER_PATH = resolve(import.meta.dir, 'mock-mcp-server.ts');
const SERVER_NAME = 'mock';

// Increase timeout for server startup
const TEST_TIMEOUT = 15_000;

describe('MCP Tool Registration & Execution', () => {
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

    // Register tools into the shared tools array
    manager.registerTools(getToolsArray(), 50_000);
  });

  afterAll(async () => {
    manager.unregisterTools(getToolsArray());
    await manager.disconnectAll();
  });

  // --- Connection & Discovery ---

  test('server connects successfully', () => {
    const status = manager.getStatus();
    const serverStatus = status.get(SERVER_NAME);
    expect(serverStatus).toBeDefined();
    expect(serverStatus!.status).toBe('connected');
  });

  test('discovers all three tools', () => {
    const tools = manager.getAllTools();
    const serverTools = tools.filter((t) => t.serverName === SERVER_NAME);
    expect(serverTools.length).toBe(3);

    const names = serverTools.map((t) => t.name).sort();
    expect(names).toEqual(['add', 'echo', 'write_test']);
  });

  test('qualified names follow mcp__server__tool pattern', () => {
    const tools = manager.getAllTools();
    for (const tool of tools) {
      expect(tool.qualifiedName).toBe(`mcp__${SERVER_NAME}__${tool.name}`);
    }
  });

  test('annotations are preserved from server', () => {
    const tools = manager.getAllTools();
    const echo = tools.find((t) => t.name === 'echo');
    expect(echo?.annotations?.readOnlyHint).toBe(true);
    expect(echo?.annotations?.destructiveHint).toBe(false);

    const writeTest = tools.find((t) => t.name === 'write_test');
    expect(writeTest?.annotations?.destructiveHint).toBe(true);
  });

  // --- Tool Registration ---

  test('MCP tools are registered in shared tools array', () => {
    const echoDef = getToolDefinition('mcp__mock__echo');
    expect(echoDef).toBeDefined();
    expect(echoDef!.name).toBe('mcp__mock__echo');

    const addDef = getToolDefinition('mcp__mock__add');
    expect(addDef).toBeDefined();

    const writeDef = getToolDefinition('mcp__mock__write_test');
    expect(writeDef).toBeDefined();
  });

  test('MCP tools appear in getOllamaTools()', () => {
    const ollamaTools = getOllamaTools();
    const mcpToolNames = ollamaTools
      .filter((t) => t.function?.name?.startsWith('mcp__'))
      .map((t) => t.function.name!)
      .sort();
    expect(mcpToolNames).toEqual([
      'mcp__mock__add',
      'mcp__mock__echo',
      'mcp__mock__write_test',
    ]);
  });

  test('MCP tools have rawInputSchema set', () => {
    const echoDef = getToolDefinition('mcp__mock__echo');
    expect(echoDef!.rawInputSchema).toBeDefined();
    expect(typeof echoDef!.rawInputSchema).toBe('object');
  });

  test('risk levels are mapped from annotations', () => {
    const echoDef = getToolDefinition('mcp__mock__echo');
    expect(echoDef!.risk).toBe('safe'); // readOnlyHint: true

    const writeDef = getToolDefinition('mcp__mock__write_test');
    expect(writeDef!.risk).toBe('high'); // destructiveHint: true
  });

  // --- Tool Execution ---

  test(
    'echo tool returns input text',
    async () => {
      const result = await executeTool('mcp__mock__echo', {
        text: 'hello world',
      });
      expect(result.error).toBeUndefined();
      expect(result.output).toBe('hello world');
    },
    TEST_TIMEOUT,
  );

  test(
    'add tool returns sum',
    async () => {
      const result = await executeTool('mcp__mock__add', { a: 3, b: 4 });
      expect(result.error).toBeUndefined();
      expect(result.output).toBe('7');
    },
    TEST_TIMEOUT,
  );

  test(
    'write_test tool returns confirmation',
    async () => {
      const result = await executeTool('mcp__mock__write_test', {
        path: '/tmp/test.txt',
        content: 'hello',
      });
      expect(result.error).toBeUndefined();
      expect(result.output).toBe('Wrote 5 chars to /tmp/test.txt');
    },
    TEST_TIMEOUT,
  );

  // --- Mode Filtering ---

  test('build mode includes all MCP tools', () => {
    const mcpTools = manager.getAllTools();
    const buildTools = getToolsForMode('build', mcpTools);
    const mcpNames = buildTools
      .filter((t) => t.function?.name?.startsWith('mcp__'))
      .map((t) => t.function.name!)
      .sort();
    expect(mcpNames).toEqual([
      'mcp__mock__add',
      'mcp__mock__echo',
      'mcp__mock__write_test',
    ]);
  });

  test('plan mode includes only read-only MCP tools', () => {
    const mcpTools = manager.getAllTools();
    const planTools = getToolsForMode('plan', mcpTools);
    const mcpNames = planTools
      .filter((t) => t.function?.name?.startsWith('mcp__'))
      .map((t) => t.function.name!)
      .sort();
    // echo and add are readOnlyHint: true, write_test is not
    expect(mcpNames).toEqual(['mcp__mock__add', 'mcp__mock__echo']);
  });

  // --- Output Truncation ---

  test(
    'output is truncated at maxOutputChars',
    async () => {
      // Re-register with a tiny limit
      manager.unregisterTools(getToolsArray());
      manager.registerTools(getToolsArray(), 10);

      const result = await executeTool('mcp__mock__echo', {
        text: 'this is a long string that exceeds the limit',
      });
      expect(result.error).toBeUndefined();
      expect(result.output).toContain('[OUTPUT TRUNCATED');
      expect(result.output.length).toBeLessThan(100); // 10 chars + truncation message

      // Restore normal limit
      manager.unregisterTools(getToolsArray());
      manager.registerTools(getToolsArray(), 50_000);
    },
    TEST_TIMEOUT,
  );

  // --- Unregistration ---

  test('unregisterTools removes MCP tools from array', () => {
    const before = getToolsArray().length;
    manager.unregisterTools(getToolsArray());

    const after = getToolsArray().length;
    expect(after).toBe(before - 3); // 3 MCP tools removed

    // MCP tools are gone
    expect(getToolDefinition('mcp__mock__echo')).toBeUndefined();
    expect(getToolDefinition('mcp__mock__add')).toBeUndefined();
    expect(getToolDefinition('mcp__mock__write_test')).toBeUndefined();

    // Native tools still there
    expect(getToolDefinition('read_file')).toBeDefined();

    // Re-register for subsequent tests
    manager.registerTools(getToolsArray(), 50_000);
  });

  // --- getRegisteredToolDefs ---

  test('getRegisteredToolDefs returns current MCP tools', () => {
    const defs = manager.getRegisteredToolDefs();
    expect(defs.length).toBe(3);
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual([
      'mcp__mock__add',
      'mcp__mock__echo',
      'mcp__mock__write_test',
    ]);
  });
});

// --- Unit tests for createMcpToolDef ---

describe('createMcpToolDef', () => {
  test('uses fromJSONSchema for valid schemas', () => {
    const mockTool: McpToolInfo = {
      name: 'test',
      qualifiedName: 'mcp__srv__test',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: { x: { type: 'string' } },
        required: ['x'],
      },
      serverName: 'srv',
      annotations: { readOnlyHint: true },
    };

    // We can't easily mock the client, but we can verify the ToolDefinition shape
    const def = createMcpToolDef(
      mockTool,
      {} as any, // mock client — won't be called
      10_000,
      50_000,
    );

    expect(def.name).toBe('mcp__srv__test');
    expect(def.description).toBe('A test tool');
    expect(def.risk).toBe('safe');
    expect(def.rawInputSchema).toEqual(mockTool.inputSchema);
    expect(def.parameters).toBeDefined();

    // Verify Zod validation works (fromJSONSchema succeeded)
    const valid = def.parameters.safeParse({ x: 'hello' });
    expect(valid.success).toBe(true);

    const invalid = def.parameters.safeParse({ x: 123 });
    expect(invalid.success).toBe(false);
  });

  test('falls back to z.any() for exotic schemas', () => {
    const mockTool: McpToolInfo = {
      name: 'exotic',
      qualifiedName: 'mcp__srv__exotic',
      description: 'Exotic schema tool',
      inputSchema: {
        // Use something that fromJSONSchema might not handle
        type: 'object',
        patternProperties: { '^S_': { type: 'string' } },
      },
      serverName: 'srv',
    };

    const def = createMcpToolDef(mockTool, {} as any, 10_000, 50_000);

    expect(def.name).toBe('mcp__srv__exotic');
    // Should still create a valid ToolDefinition even with fallback
    expect(def.parameters).toBeDefined();

    // z.any() accepts anything
    const result = def.parameters.safeParse({ anything: 'goes' });
    expect(result.success).toBe(true);
  });

  test('risk mapping from annotations', () => {
    const makeDef = (annotations?: McpToolInfo['annotations']) => {
      const tool: McpToolInfo = {
        name: 't',
        qualifiedName: 'mcp__s__t',
        description: '',
        inputSchema: { type: 'object' },
        serverName: 's',
        annotations,
      };
      return createMcpToolDef(tool, {} as any, 10_000, 50_000);
    };

    expect(makeDef(undefined).risk).toBe('medium');
    expect(makeDef({ readOnlyHint: true }).risk).toBe('safe');
    expect(makeDef({ destructiveHint: true }).risk).toBe('high');
    expect(makeDef({ destructiveHint: true, readOnlyHint: true }).risk).toBe(
      'high',
    );
  });
});

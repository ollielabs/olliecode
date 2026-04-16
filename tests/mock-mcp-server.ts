#!/usr/bin/env bun
/**
 * Mock MCP server for integration testing.
 *
 * Provides three tools:
 * - echo (read-only): returns the input text
 * - add (read-only): adds two numbers
 * - write_test (destructive): simulates a write operation
 *
 * Runs as a stdio MCP server. Launch with: bun tests/mock-mcp-server.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer(
  { name: 'mock-test-server', version: '1.0.0' },
  {
    capabilities: {
      tools: {},
    },
  },
);

// echo — read-only tool that returns input text
server.registerTool(
  'echo',
  {
    description: 'Echoes the input text back',
    inputSchema: { text: z.string().describe('Text to echo') },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  async ({ text }) => {
    return { content: [{ type: 'text' as const, text }] };
  },
);

// add — read-only tool that adds two numbers
server.registerTool(
  'add',
  {
    description: 'Adds two numbers together',
    inputSchema: {
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  async ({ a, b }) => {
    return { content: [{ type: 'text' as const, text: String(a + b) }] };
  },
);

// write_test — destructive tool that simulates a write
server.registerTool(
  'write_test',
  {
    description: 'Simulates a write operation (test only)',
    inputSchema: {
      path: z.string().describe('File path to write'),
      content: z.string().describe('Content to write'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
  },
  async ({ path, content }) => {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Wrote ${content.length} chars to ${path}`,
        },
      ],
    };
  },
);

// Start the server on stdio
const transport = new StdioServerTransport();
await server.connect(transport);

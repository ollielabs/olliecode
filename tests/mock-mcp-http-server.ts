#!/usr/bin/env bun
/**
 * Mock HTTP MCP server for remote transport integration testing.
 *
 * Provides the same tools as mock-mcp-server.ts (echo, add, write_test)
 * but over Streamable HTTP transport instead of stdio.
 *
 * Uses Bun.serve() with WebStandardStreamableHTTPServerTransport.
 * Follows the SDK's stateful server pattern: new session created only on
 * initialize requests, existing sessions reused via mcp-session-id header.
 *
 * Usage: bun tests/mock-mcp-http-server.ts [port]
 * Prints the port to stdout once listening (for test coordination).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const requestedPort = Number(process.argv[2]) || 0; // 0 = OS-assigned

/**
 * Create a new McpServer with all test tools registered.
 */
function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'mock-http-test-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'echo',
    {
      description: 'Echoes the input text back',
      inputSchema: { text: z.string().describe('Text to echo') },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ text }) => {
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.registerTool(
    'add',
    {
      description: 'Adds two numbers together',
      inputSchema: {
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ a, b }) => {
      return { content: [{ type: 'text' as const, text: String(a + b) }] };
    },
  );

  server.registerTool(
    'write_test',
    {
      description: 'Simulates a write operation (test only)',
      inputSchema: {
        path: z.string().describe('File path to write'),
        content: z.string().describe('Content to write'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
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

  return server;
}

/**
 * Check if a parsed JSON-RPC body is an initialize request.
 */
function isInitializeRequest(body: unknown): boolean {
  if (typeof body === 'object' && body !== null && 'method' in body) {
    return (body as { method: string }).method === 'initialize';
  }
  // Could be a batch
  if (Array.isArray(body)) {
    return body.some(
      (msg) =>
        typeof msg === 'object' &&
        msg !== null &&
        'method' in msg &&
        msg.method === 'initialize',
    );
  }
  return false;
}

// Session-based transport + server map
const sessions = new Map<
  string,
  { transport: WebStandardStreamableHTTPServerTransport; server: McpServer }
>();

const httpServer = Bun.serve({
  port: requestedPort,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Only handle /mcp endpoint
    if (url.pathname !== '/mcp') {
      return new Response('Not found', { status: 404 });
    }

    // Handle DELETE for session termination
    if (req.method === 'DELETE') {
      const sessionId = req.headers.get('mcp-session-id');
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.close();
        sessions.delete(sessionId);
      }
      return new Response(null, { status: 200 });
    }

    // Check for existing session
    const sessionId = req.headers.get('mcp-session-id');

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      return session.transport.handleRequest(req);
    }

    // For POST requests without session ID, check if it's an initialize request
    if (req.method === 'POST') {
      // Clone request to read body without consuming it
      const cloned = req.clone();
      let body: unknown;
      try {
        body = await cloned.json();
      } catch {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (isInitializeRequest(body)) {
        // New session — create transport and server
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        const server = createMcpServer();

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        await server.connect(transport);

        // Handle the original request (not the clone)
        const response = await transport.handleRequest(req);

        if (transport.sessionId) {
          sessions.set(transport.sessionId, { transport, server });
        }

        return response;
      }
    }

    // No session and not an initialize request
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: Server not initialized',
        },
        id: null,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  },
});

// Print port to stdout for test coordination
console.log(httpServer.port);

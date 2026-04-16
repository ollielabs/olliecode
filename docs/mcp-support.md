# MCP Support Implementation Plan

**Tracking Issue**: #27 (parent — will be broken into sub-issues A–G)
**Status**: Ready for implementation
**Date**: 2026-04-16
**Last Updated**: 2026-04-16

---

## Table of Contents

1. [Overview](#overview)
2. [Research & Prior Art](#research--prior-art)
3. [Resolved Design Decisions](#resolved-design-decisions)
4. [Scope Boundary](#scope-boundary)
5. [Issue Breakdown](#issue-breakdown)
6. [Issue A: MCP Core](#issue-a-mcp-core--config-schema--mcpmanager--stdio-transport)
7. [Issue B: Tool Registration & Execution](#issue-b-mcp-tool-registration--execution)
8. [Issue C: Safety & Permissions](#issue-c-mcp-safety--permissions-integration)
9. [Issue D: Connection Robustness](#issue-d-mcp-connection-robustness)
10. [Issue E: TUI Integration](#issue-e-mcp-tui-integration)
11. [Issue F: Remote Servers](#issue-f-remote-mcp-servers-streamable-http--sse)
12. [Issue G: Project-Scoped Config](#issue-g-project-scoped-mcpjson)
13. [Risk Assessment](#risk-assessment)
14. [Testing Strategy](#testing-strategy)
15. [Reference Links](#reference-links)

---

## Overview

Add Model Context Protocol (MCP) support to OllieCode, allowing users to connect
external MCP servers and use their tools alongside built-in tools. OllieCode will
act as an MCP **client** — spawning server processes (stdio) or connecting to
remote endpoints (HTTP/SSE), discovering tools via `tools/list`, and routing tool
calls through the JSON-RPC protocol.

This brings feature parity with Claude Code, Cline, OpenCode, and Cursor for
external tool integration.

**Key dependency**: `@modelcontextprotocol/sdk` (MIT, official TypeScript SDK)
— no other new dependencies needed.

---

## Research & Prior Art

### Ecosystem Analysis

We analyzed MCP implementations across Claude Code, Cline, OpenCode, Cursor,
and the official TypeScript SDK. Key findings:

| Feature | Claude Code | OpenCode | Cline |
|---------|------------|----------|-------|
| **Transport** | stdio + HTTP + SSE | stdio + HTTP | stdio + HTTP + SSE |
| **Tool naming** | `mcp__server__tool` | `server_tool` | nanoid prefix |
| **Config format** | `.mcp.json` + CLI | `opencode.json` | JSON + VS Code UI |
| **Scopes** | local/project/user | project/global | single file |
| **Output truncation** | ~25k tokens | None (delegates to AI SDK) | None |
| **Image support** | Native (Claude) | Delegates to AI SDK | Webview + model |
| **Tool validation** | Server-side | None (passthrough) | None |
| **Auto-approve** | No per-tool | Via tool config | Per-server arrays |

### OpenCode Architecture (Bun-native, most relevant)

OpenCode (`github.com/anomalyco/opencode`, 144k stars) runs on **Bun 1.3.11**
with full MCP support, confirming SDK + Bun compatibility.

Key patterns from OpenCode's `mcp.ts` (924 lines) and `tool/registry.ts`:

- Uses Vercel AI SDK's `dynamicTool()` + `jsonSchema()` to bypass Zod conversion
- Tool naming: `sanitize(serverName) + "_" + sanitize(toolName)`
- `convertMcpTool()` passes raw JSON Schema via `jsonSchema()` wrapper
- Execute function calls `client.callTool()` directly, returns raw result
- No client-side input validation — delegates to MCP server
- No output truncation at MCP layer — delegates to AI SDK

**Our approach differs**: We don't use the Vercel AI SDK (we talk to Ollama
directly), so we use Zod 4's built-in `fromJSONSchema()` for validation and
store `rawInputSchema` for Ollama's tool format.

### MCP SDK Specifics

```
Package: @modelcontextprotocol/sdk
Version: 2.0.0-alpha.0 (monorepo with @modelcontextprotocol/client, /server, /node)
License: See LICENSE (LF Projects)
Engines: node >=20 (works on Bun — confirmed by OpenCode)
Key imports:
  - Client from '@modelcontextprotocol/sdk/client/index.js'
  - StdioClientTransport from '@modelcontextprotocol/sdk/client/stdio.js'
  - StreamableHTTPClientTransport from '@modelcontextprotocol/sdk/client/streamableHttp.js'
  - SSEClientTransport from '@modelcontextprotocol/sdk/client/sse.js'
  - CallToolResultSchema from '@modelcontextprotocol/sdk/types.js'
```

---

## Resolved Design Decisions

All decisions below were resolved during the design review session.

### 1. Tool Registration Strategy: Option D (Register into tools array)

MCP tools register directly into the existing `tools` array as `ToolDefinition`
objects. The dispatcher does NOT need conditional `mcp__*` routing logic.
McpManager creates `ToolDefinition`-compatible objects with an `execute` closure
that calls back to the MCP client.

**Rationale**: The tool registry becomes the single source of truth for all tools
(native + MCP). `executeTool()` and `getToolsForMode()` work unchanged.

### 2. JSON Schema → Zod Conversion: `fromJSONSchema()` (Zod 4 built-in)

Zod 4 (already installed as `zod@^4.3.6`) has `fromJSONSchema()` which converts
raw JSON Schema to a Zod schema at runtime. This was verified working:

```typescript
import { fromJSONSchema } from 'zod';

const schema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    limit: { type: 'number' },
  },
  required: ['query'],
};

const zodSchema = fromJSONSchema(schema);
zodSchema.safeParse({ query: 'hello', limit: 10 }); // { success: true }
zodSchema.safeParse({ limit: 'bad' });               // { success: false }
```

**Fallback**: If `fromJSONSchema()` fails on exotic schemas (`$ref`, complex
`allOf`, etc.), fall back to `z.any()` with a warning log.

**No new dependency needed** — eliminates `@cfworker/json-schema` or `ajv`.

### 3. `rawInputSchema` Field on ToolDefinition

Add optional `rawInputSchema?: object` to `ToolDefinition`. For MCP tools, this
holds the original JSON Schema from the MCP server. `toOllamaTool()` prefers
`rawInputSchema` over `z.toJSONSchema(def.parameters)` when present, avoiding
a lossy Zod→JSON Schema round-trip.

### 4. Transports: All Three

- **stdio** (Phase 1): `StdioClientTransport` — spawns subprocess
- **Streamable HTTP** (Phase 2): `StreamableHTTPClientTransport` — remote servers
- **SSE fallback** (Phase 2): Try HTTP first, fall back to `SSEClientTransport`

### 5. Config Format: OpenCode-inspired `local`/`remote` types

```json
{
  "mcp": {
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "environment": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    },
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer ${API_KEY}" }
    }
  }
}
```

**Config scoping**: Global (`~/.ollie/config.json`) + local (`.ollie/config.json`)
+ project (`.mcp.json`). Later sources override same-named servers.

### 6. Server Name Validation

Server names validated in config schema:
`z.string().regex(/^[a-z0-9][a-z0-9_-]*$/)` — lowercase alphanumeric with
single hyphens/underscores, no `__` sequences (prevents ambiguity in
`mcp__server__tool` qualified names).

### 7. Tool Naming Convention

`mcp__<serverName>__<toolName>` — double underscore separator, matching Claude
Code's convention. Distinct from native tools which use single `_`.

### 8. Async Startup

TUI shows immediately. MCP servers connect in the background. Tools become
available as servers finish connecting. If user sends a message before MCP is
ready, agent runs with native tools only. Status bar shows "connecting..."
during startup.

### 9. Server Failure: Error Stubs + Auto-Reconnect

When an MCP server crashes or disconnects:
- **Keep tools in the tool list** as error stubs. When the LLM calls them, return:
  `"MCP server '<name>' is disconnected. Tool unavailable. The server is attempting to reconnect."`
- **Auto-reconnect** with exponential backoff: 1s, 2s, 4s, max 30s, give up
  after 3 attempts. On success, tools work again automatically.
- **Status bar** updates immediately (`github(err)`), plus toast notification.

### 10. Output Handling

- **Text content**: Serialize and truncate at `tools.mcp.maxOutputChars` (default 50k, configurable)
- **Image content**: `[Image content (base64, {mimeType}) omitted — not supported by current model]`
- **Audio content**: `[Audio content omitted — not supported by current model]`
- **Resource content**: Extract text portion if present, include URI as reference
- **Truncation is a guardrail** against bad MCP servers, not a context window workaround.
  Our target users run capable models.

### 11. Tool Count: Warn, Don't Cap

Log a warning when total MCP tools exceed 30. No hard cap. Freedom first —
users are developers who understand context implications.

### 12. OAuth: Schema-Ready, Not Implemented in Phase 1

The remote server config schema includes an `oauth` field (stubbed):

```typescript
oauth: z.union([
  z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    scope: z.string().optional(),
  }),
  z.literal(false),
]).optional(),
```

This ensures forward compatibility. OAuth/PKCE with browser redirect is a
follow-up issue, not deferred — it's part of the MCP story, just phased.

### 13. Parallel MCP Calls: Allowed by Default

The MCP SDK handles request IDs and multiplexing. No serialization needed.

### 14. Audit Log: No Schema Changes

MCP tool calls use the existing `AuditEntry` type unchanged. The qualified name
`mcp__github__create_issue` encodes the server name. Richer MCP-specific auditing
can be added later without difficulty.

### 15. Bun Compatibility: Confirmed

OpenCode runs on Bun 1.3.11 (`"packageManager": "bun@1.3.11"`) with full MCP
support. The MCP SDK is pure TypeScript with no native modules. No spike needed.

### 16. Plan Mode: Read-Only MCP Tools

MCP tools with `annotations.readOnlyHint === true` are available in plan mode
alongside built-in read-only tools.

---

## Scope Boundary

### In Scope (Issues A–G)

- Config schema with `local`/`remote` server types
- McpManager class (lifecycle, discovery, execution)
- Tool registration into existing `tools` array
- Safety/permissions integration
- Connection robustness (reconnect, timeouts, error stubs)
- TUI status display, `/mcp` command
- Remote server support (HTTP + SSE)
- Project-scoped `.mcp.json`
- Tests (unit, integration with mock server, manual)

### Explicitly Out of Scope

- **MCP Resources** (`resources/list`, `resources/read`) — tools only
- **MCP Prompts** (`prompts/list`) — not implementing
- **MCP Sampling** (`sampling/createMessage`) — complex bidirectional flow
- **OAuth/PKCE implementation** — schema ready, implementation is a follow-up issue
- **CLI management commands** (`ollie mcp add/remove/list/test`) — follow-up issue
- **Subagent MCP access** — separate feature after subagent support
- **Glob pattern tool filtering** (`"mcp__github__*": "deny"`) — follow-up enhancement

---

## Issue Breakdown

### Dependency Graph

```
A (core) ──→ B (execution) ──→ C (safety)
                  │
                  ├──→ D (robustness)
                  │
                  └──→ E (TUI)

A ──→ F (remote transport)    // can parallel with B

G (project config)            // independent, after A
```

**Critical path**: A → B → C
**Parallelizable after B**: D, E, F
**Independent**: G

---

## Issue A: MCP Core — Config Schema + McpManager + stdio Transport

**Goal**: Connect to a local (stdio) MCP server, discover its tools, and expose
connection status. No tool execution yet.

### A.1 Install MCP SDK

```bash
bun add @modelcontextprotocol/sdk
```

### A.2 Config Schema

Add to `src/config/schema.ts`:

```typescript
const McpServerNameSchema = z.string().regex(
  /^[a-z0-9][a-z0-9_-]*$/,
  'Server name must be lowercase alphanumeric with hyphens/underscores, no "__"'
);

const McpServerLocalSchema = z.object({
  type: z.literal('local'),
  command: z.array(z.string()).min(1),
  environment: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
  timeout: z.number().int().min(1000).max(120000).default(10000),
  autoApprove: z.array(z.string()).default([]),
});

const McpServerRemoteSchema = z.object({
  type: z.literal('remote'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
  timeout: z.number().int().min(1000).max(120000).default(10000),
  autoApprove: z.array(z.string()).default([]),
  oauth: z.union([
    z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      scope: z.string().optional(),
    }),
    z.literal(false),
  ]).optional(),
});

const McpServerConfigSchema = z.discriminatedUnion('type', [
  McpServerLocalSchema,
  McpServerRemoteSchema,
]);

// Add to ConfigSchema:
mcp: z.record(McpServerNameSchema, McpServerConfigSchema).default({})
```

Add MCP tool config to `ToolsObjectSchema`:

```typescript
const McpToolConfigSchema = z.object({
  maxOutputChars: z.number().int().min(1000).max(500_000).default(50_000),
});

// In ToolsObjectSchema:
mcp: McpToolConfigSchema.default(() => McpToolConfigSchema.parse({})),
```

Update `ToolsConfig` type in `src/agent/types.ts`:

```typescript
mcp: { maxOutputChars: number };
```

### A.3 Environment Variable Expansion

New file: `src/config/env-expand.ts`

```typescript
/**
 * Expand environment variable patterns in config values.
 * Supports: ${VAR}, ${VAR:-default}, {env:VAR}
 */
export function expandEnvVars(value: string): string {
  // Handle ${VAR} and ${VAR:-default}
  let result = value.replace(/\$\{(\w+)(?::-(.*?))?\}/g, (_, name, fallback) => {
    return process.env[name] ?? fallback ?? '';
  });
  // Handle {env:VAR} (OpenCode compat)
  result = result.replace(/\{env:(\w+)\}/g, (_, name) => {
    return process.env[name] ?? '';
  });
  return result;
}

/** Expand env vars in all values of a string record */
export function expandRecord(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = expandEnvVars(value);
  }
  return result;
}
```

### A.4 McpManager Class

New file: `src/agent/mcp/manager.ts`

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpToolInfo, McpStatusMap } from './types';
import { expandEnvVars, expandRecord } from '../../config/env-expand';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

type McpConnection = {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolInfo[];
  status: ConnectionStatus;
  error?: string;
};

export class McpManager {
  private connections = new Map<string, McpConnection>();
  private static TOOL_COUNT_WARNING_THRESHOLD = 30;

  /** Connect all enabled servers from config. Non-blocking — errors are caught per-server. */
  async connectAll(servers: Record<string, McpServerConfig>): Promise<void> {
    const promises = Object.entries(servers)
      .filter(([_, config]) => config.enabled !== false)
      .map(([name, config]) => this.connect(name, config).catch(err => {
        // Log error but don't fail — other servers can still connect
        console.error(`MCP server "${name}" failed to connect:`, err.message);
      }));
    await Promise.allSettled(promises);
    this.checkToolCountWarning();
  }

  /** Connect a single stdio server */
  async connect(name: string, config: McpLocalServerConfig): Promise<void> {
    const client = new Client(
      { name: 'olliecode', version: PKG_VERSION },
      { capabilities: {} }
    );

    const [command, ...args] = config.command;
    const env = expandRecord(config.environment);

    const transport = new StdioClientTransport({
      command, args,
      env: { ...process.env, ...env },
      stderr: 'pipe',
    });

    transport.onerror = (err) => this.handleError(name, err);
    transport.onclose = () => this.handleClose(name);

    // Connect with timeout
    await Promise.race([
      client.connect(transport),
      rejectAfter(config.timeout, `MCP "${name}" startup timed out after ${config.timeout}ms`),
    ]);

    // Paginated tool discovery
    const tools = await this.fetchAllTools(name, client);
    this.connections.set(name, { name, client, transport, tools, status: 'connected' });

    // Subscribe to dynamic tool list changes
    client.setNotificationHandler('notifications/tools/list_changed', async () => {
      const refreshed = await this.fetchAllTools(name, client);
      const conn = this.connections.get(name);
      if (conn) conn.tools = refreshed;
    });
  }

  private async fetchAllTools(serverName: string, client: Client): Promise<McpToolInfo[]> {
    const allTools: McpToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const { tools, nextCursor } = await client.listTools({ cursor });
      for (const tool of tools) {
        allTools.push({
          name: tool.name,
          qualifiedName: `mcp__${serverName}__${tool.name}`,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          serverName,
        });
      }
      cursor = nextCursor;
    } while (cursor);
    return allTools;
  }

  getAllTools(): McpToolInfo[] { /* flatten from all connections */ }
  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<CallToolResult> { /* route to correct client */ }
  async disconnectAll(): Promise<void> { /* SIGTERM then SIGKILL */ }
  getStatus(): McpStatusMap { /* for TUI */ }

  private checkToolCountWarning(): void {
    const total = this.getAllTools().length;
    if (total > McpManager.TOOL_COUNT_WARNING_THRESHOLD) {
      console.warn(`MCP: ${total} tools registered (>${McpManager.TOOL_COUNT_WARNING_THRESHOLD}). This adds to context — consider disabling unused servers.`);
    }
  }
}
```

### A.5 MCP Types

New file: `src/agent/mcp/types.ts`

```typescript
import type { ToolRisk } from '../types';

export type McpToolInfo = {
  name: string;                  // original MCP tool name
  qualifiedName: string;         // mcp__<server>__<tool>
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
  serverName: string;
};

export type McpToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpStatusMap = Map<string, {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  toolCount: number;
  error?: string;
}>;

export function mcpAnnotationsToRisk(annotations?: McpToolAnnotations): ToolRisk {
  if (!annotations) return 'medium';
  if (annotations.destructiveHint) return 'high';
  if (annotations.readOnlyHint) return 'safe';
  return 'medium';
}

export function isMcpToolReadOnly(tool: McpToolInfo): boolean {
  return tool.annotations?.readOnlyHint === true;
}
```

### A.6 Files to Create/Modify

| File | Action |
|------|--------|
| `src/agent/mcp/manager.ts` | **Create** |
| `src/agent/mcp/types.ts` | **Create** |
| `src/agent/mcp/index.ts` | **Create** (re-exports) |
| `src/config/env-expand.ts` | **Create** |
| `src/config/schema.ts` | **Modify** (add `mcp` section + `tools.mcp`) |
| `src/config/resolve.ts` | **Modify** (extract MCP config) |
| `src/agent/types.ts` | **Modify** (add `mcp` to `ToolsConfig`) |
| `tests/test-env-expand.ts` | **Create** (unit tests) |
| `tests/test-mcp-manager.ts` | **Create** (unit tests) |

### A.7 Tests

- Env var expansion: `${VAR}`, `${VAR:-default}`, `{env:VAR}`, missing vars
- McpManager: connect, disconnect, tool discovery, status reporting
- Config schema validation: valid/invalid server configs, name validation

---

## Issue B: MCP Tool Registration & Execution

**Goal**: MCP tools appear in the Ollama tool list and can be called end-to-end.

**Depends on**: Issue A

### B.1 Add `rawInputSchema` to ToolDefinition

Modify `src/agent/types.ts`:

```typescript
export type ToolDefinition<TParams extends z.ZodType, TOutput extends z.ZodType> = {
  name: string;
  description: string;
  parameters: TParams;
  outputSchema: TOutput;
  risk: ToolRisk;
  /** Raw JSON Schema for Ollama tool format (MCP tools). Overrides z.toJSONSchema(parameters). */
  rawInputSchema?: object;
  execute: (params: z.infer<TParams>, signal?: AbortSignal, context?: ToolContext) => Promise<z.infer<TOutput>>;
};
```

### B.2 McpManager.registerTools()

After connecting, McpManager creates `ToolDefinition` objects and pushes them
into the shared tools array:

```typescript
import { fromJSONSchema } from 'zod';

function createMcpToolDef(
  serverName: string,
  mcpTool: McpToolInfo,
  client: Client,
  serverTimeout: number,
  maxOutputChars: number,
): ToolDefinition<any, any> {
  // Convert JSON Schema → Zod for real validation
  let zodParams: z.ZodType;
  try {
    zodParams = fromJSONSchema(mcpTool.inputSchema);
  } catch (e) {
    console.warn(`MCP tool ${mcpTool.qualifiedName}: JSON Schema conversion failed, skipping validation`, e);
    zodParams = z.any();
  }

  return {
    name: mcpTool.qualifiedName,
    description: mcpTool.description,
    parameters: zodParams,
    rawInputSchema: mcpTool.inputSchema,
    outputSchema: z.string(),
    risk: mcpAnnotationsToRisk(mcpTool.annotations),
    execute: async (args, signal) => {
      const result = await client.callTool(
        { name: mcpTool.name, arguments: args ?? {} },
        CallToolResultSchema,
        { timeout: serverTimeout },
      );

      // Serialize content array to string
      const parts: string[] = [];
      for (const item of result.content ?? []) {
        if (item.type === 'text') {
          parts.push(item.text);
        } else if (item.type === 'image') {
          parts.push(`[Image content (${item.mimeType}) omitted — not supported by current model]`);
        } else if (item.type === 'resource') {
          const text = item.resource?.text ?? '';
          parts.push(text || `[Resource: ${item.resource?.uri}]`);
        } else {
          parts.push(`[${item.type} content omitted — not supported]`);
        }
      }

      let output = parts.join('\n');

      // Truncate
      if (output.length > maxOutputChars) {
        output = output.slice(0, maxOutputChars) +
          `\n\n[OUTPUT TRUNCATED — showing first ${maxOutputChars.toLocaleString()} chars]`;
      }

      if (result.isError) {
        throw new Error(output);
      }

      return output;
    },
  };
}
```

### B.3 Modify `toOllamaTool()` in `src/agent/tools/index.ts`

```typescript
function toOllamaTool(def: ToolDefinition<any, any>): Tool {
  // Prefer raw JSON Schema (MCP tools) over Zod conversion
  const jsonSchema = def.rawInputSchema
    ? def.rawInputSchema
    : z.toJSONSchema(def.parameters);

  const { type, properties, required } = jsonSchema as {
    type?: OllamaParameters['type'];
    properties?: OllamaParameters['properties'];
    required?: OllamaParameters['required'];
  };

  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: { type, properties, required },
    },
  };
}
```

### B.4 Integration Test

Create a mock MCP server using the SDK's `Server` class with 2-3 simple tools:
- `echo` (read-only): returns the input text
- `add` (read-only): adds two numbers
- `write_test` (destructive): simulates a write operation

Full round-trip: config → connect → discover → call tool → validate result.

### B.5 Files to Create/Modify

| File | Action |
|------|--------|
| `src/agent/types.ts` | **Modify** (add `rawInputSchema`) |
| `src/agent/tools/index.ts` | **Modify** (`toOllamaTool` + tool registration) |
| `src/agent/mcp/manager.ts` | **Modify** (add `registerTools()` / `createMcpToolDef()`) |
| `tests/test-mcp-execution.ts` | **Create** (integration test with mock server) |

---

## Issue C: MCP Safety & Permissions Integration

**Goal**: MCP tools respect the autonomy system, plan mode filtering, and
audit logging.

**Depends on**: Issue B

### C.1 Permission Defaults

MCP tools default to `'ask'` in all autonomy levels except `autonomous`.
`autoApprove` per-server config overrides this.

Modify `src/config/resolve.ts`:

```typescript
export function resolvePermissions(
  config: ResolvedConfig,
  mcpTools?: McpToolInfo[],
): ToolPermissionMap {
  const baseline = AUTONOMY_BASELINES[config.autonomy] ?? AUTONOMY_BASELINES.cautious;
  const resolved = { ...baseline };

  // Register MCP tools with default permissions
  if (mcpTools) {
    const defaultPerm = config.autonomy === 'autonomous' ? 'allow' : 'ask';
    for (const tool of mcpTools) {
      const serverConfig = config.mcp[tool.serverName];
      const isAutoApproved = serverConfig?.autoApprove?.includes(tool.name);
      resolved[tool.qualifiedName] = isAutoApproved ? 'allow' : defaultPerm;
    }
  }

  // Explicit overrides take highest priority
  for (const [tool, permission] of Object.entries(config.permissions)) {
    resolved[tool] = permission;
  }

  return resolved;
}
```

### C.2 Plan Mode Filtering

MCP tools with `readOnlyHint: true` are included in plan mode.
`getToolsForMode()` already handles this via `isMcpToolReadOnly()` —
since MCP tools are in the `tools` array, they're filtered by mode naturally
if we tag them properly.

### C.3 Audit Log

No changes to `AuditEntry` schema. MCP tool calls log with qualified name
(`mcp__github__create_issue`). Existing audit code handles this automatically.

### C.4 Files to Modify

| File | Action |
|------|--------|
| `src/config/resolve.ts` | **Modify** |
| `src/agent/modes/index.ts` | **Modify** (dynamic MCP tools in mode filtering) |
| `tests/test-mcp-permissions.ts` | **Create** |

---

## Issue D: MCP Connection Robustness

**Goal**: Handle server crashes, timeouts, and reconnection gracefully.

**Depends on**: Issue B

### D.1 Error Stubs

When a server disconnects, keep its tools in the registry. The `execute`
function returns: `"MCP server '<name>' is disconnected. Tool unavailable.
The server is attempting to reconnect."`

### D.2 Auto-Reconnect

Exponential backoff: 1s, 2s, 4s, max 30s. Max 3 attempts. On success,
refresh tool list and clear error state.

### D.3 Async Startup

`connectAll()` is non-blocking. TUI renders immediately. McpManager fires
a `'tools-changed'` event when tools become available.

### D.4 Graceful Shutdown

On process exit (SIGINT, SIGTERM): call `disconnectAll()` which sends SIGTERM
to stdio processes, waits 5s, then SIGKILL.

### D.5 Server Stderr Capture

Capture and store last N lines of stderr per server. Visible via `/mcp` command
for debugging.

### D.6 Files to Modify

| File | Action |
|------|--------|
| `src/agent/mcp/manager.ts` | **Modify** (reconnection, error stubs, shutdown) |
| `tests/test-mcp-robustness.ts` | **Create** (crash, timeout, reconnect tests) |

---

## Issue E: MCP TUI Integration

**Goal**: Users can see MCP status and manage servers from the TUI.

**Depends on**: Issue B

### E.1 Status Bar

```
MCP: github(3) context7(2)     # connected, tool counts
MCP: github(err) context7(2)   # error state
MCP: connecting...              # during startup
```

### E.2 `/mcp` Slash Command

Shows: server list, status, tool counts, tool names, error messages, stderr tail.

### E.3 Tool Call Display

Parse `mcp__server__tool` → display as `server > tool` in the conversation view.

### E.4 Toast Notifications

- Server connected: "MCP: github connected (3 tools)"
- Server error: "MCP: github disconnected"
- Tool list changed: "MCP: github tools updated"

---

## Issue F: Remote MCP Servers (Streamable HTTP + SSE)

**Goal**: Support `type: "remote"` servers.

**Depends on**: Issue A

### F.1 Transport Selection

Try `StreamableHTTPClientTransport` first. On 4xx error, fall back to
`SSEClientTransport` for legacy servers.

### F.2 Headers + Env Var Expansion

Apply `expandEnvVars()` to `url` and all `headers` values.

### F.3 OAuth Schema

The `oauth` field is in the config schema (from Issue A) but not implemented.
This issue just ensures the transport layer works with headers/API keys.

---

## Issue G: Project-Scoped `.mcp.json`

**Goal**: Support a project-root `.mcp.json` file for team-shared MCP configs.

**Independent** — can be done any time after Issue A.

### G.1 File Format

```json
{
  "mcpServers": {
    "project-db": {
      "type": "local",
      "command": ["npx", "-y", "@bytebase/dbhub", "--dsn", "${DATABASE_URL}"]
    }
  }
}
```

### G.2 Merge Order

Global `~/.ollie/config.json` < project `.ollie/config.json` < project `.mcp.json`.
Same-named servers: later source wins.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Status |
|------|-----------|--------|------------|--------|
| Ollama struggles with complex MCP JSON Schemas | Medium | High | Test early with server-everything; may need schema simplification | Open |
| MCP SDK doesn't work with Bun | — | — | **Confirmed working** via OpenCode (Bun 1.3.11) | Resolved |
| Long tool names confuse the model | Low | Medium | Test with real models; can add aliasing if needed | Open |
| MCP server processes leak on crash | Medium | Medium | Signal handlers + SIGTERM/SIGKILL in McpManager | Mitigated by Issue D |
| Context explosion from many MCP tools | Medium | Medium | Warn at 30+ tools, no hard cap | Mitigated |
| `fromJSONSchema()` fails on exotic schemas | Low | Low | Fall back to `z.any()` with warning | Mitigated |

---

## Testing Strategy

### Phase 1 (Issues A + B): Minimal Mock

- One mock MCP server with 2-3 tools (echo, add, write_test)
- Happy path: connect → discover → call → result
- Unit tests for env expand, types, risk mapping, name parsing

### Phase 2 (Issues C + D): Edge Cases

- Server crash mid-call
- Startup timeout
- Reconnection behavior
- Permission resolution with MCP tools + autoApprove
- Plan mode filtering with readOnlyHint
- Multiple servers with overlapping tool names

### Manual Testing (All phases)

- `@modelcontextprotocol/server-everything` — official test server
- `@modelcontextprotocol/server-filesystem` — real file system tools
- `@modelcontextprotocol/server-github` — real GitHub API

---

## Reference Links

### MCP Protocol
- Spec: https://modelcontextprotocol.io/docs/concepts/transports
- Tools: https://modelcontextprotocol.io/docs/concepts/tools
- TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk

### Prior Art
- OpenCode MCP docs: https://opencode.ai/docs/mcp-servers/
- OpenCode source: https://github.com/anomalyco/opencode (Bun, 144k stars)
  - `packages/opencode/src/mcp/mcp.ts` — MCP client (924 lines)
  - `packages/opencode/src/tool/registry.ts` — tool registry
  - `packages/opencode/src/tool/tool.ts` — tool definition type
- Cline MCP: https://github.com/cline/cline (`src/services/mcp/McpHub.ts`)

### OllieCode Integration Points
- `src/agent/types.ts` — `ToolDefinition`, `ToolRisk`, `ToolContext`, `ToolsConfig`
- `src/agent/tools/index.ts` — tool registry, `executeTool()`, `toOllamaTool()`
- `src/agent/modes/index.ts` — `MODE_TOOLS`, plan/build filtering
- `src/config/schema.ts` — `ConfigSchema`, Zod validation
- `src/config/resolve.ts` — `AUTONOMY_BASELINES`, `resolvePermissions()`
- `src/agent/safety/types.ts` — `SafetyConfig`, `ToolPermission`
- `src/agent/safety/index.ts` — permission checks, audit logging

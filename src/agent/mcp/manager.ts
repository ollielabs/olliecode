/**
 * McpManager — lifecycle management for MCP server connections.
 *
 * Responsibilities (Issue #89):
 * - Connect to local (stdio) MCP servers
 * - Discover tools via tools/list (with pagination)
 * - Track connection status per server
 * - Graceful shutdown (SIGTERM → SIGKILL)
 *
 * Tool registration (Issue #90) and robustness (Issue #92) are separate.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { z, fromJSONSchema } from 'zod';
import type {
  McpLocalServerConfig,
  McpServerConfig,
} from '../../config/schema';
import { expandArray, expandRecord } from '../../config/env-expand';
import type { ToolDefinition } from '../types';
import type {
  McpConnectionStatus,
  McpStatusMap,
  McpToolAnnotations,
  McpToolInfo,
} from './types';
import { mcpAnnotationsToRisk } from './types';

// Package version for MCP client identification
const PKG_VERSION = '0.5.1';

/** Max stderr lines to retain per server for debugging */
const STDERR_BUFFER_SIZE = 50;

/** Auto-reconnect configuration */
const RECONNECT = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
} as const;

/**
 * Internal state for a single MCP server connection.
 * `client` and `transport` are undefined until connection succeeds.
 */
type McpConnection = {
  name: string;
  client?: Client;
  transport?: StdioClientTransport;
  tools: McpToolInfo[];
  status: McpConnectionStatus;
  error?: string;
  config: McpLocalServerConfig;
  /** Last N lines of stderr from the server process */
  stderrBuffer: string[];
  /** Number of reconnect attempts since last successful connection */
  reconnectAttempts: number;
  /** Whether a reconnect is currently in progress */
  reconnecting: boolean;
  /** Timer for scheduled reconnect (for cancellation) */
  reconnectTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Listener callback for tool list changes.
 */
export type McpToolsChangedListener = (tools: McpToolInfo[]) => void;

/**
 * MCP tool call content item types (from MCP SDK CallToolResult).
 * Typed precisely to avoid `unknown[]` casts in consumers (Issue #90).
 */
export type McpContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; text?: string } }
  | { type: string; [key: string]: unknown };

/**
 * Create a cancellable timeout promise.
 * Returns the promise and a cancel function to clear the timer.
 */
function timeoutPromise(
  ms: number,
  message: string,
): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer!) };
}

/**
 * Create a ToolDefinition from an MCP tool discovery result.
 *
 * Uses fromJSONSchema() for real Zod validation of MCP tool parameters.
 * Falls back to z.any() only when the JSON Schema is too exotic to convert.
 */
export function createMcpToolDef(
  mcpTool: McpToolInfo,
  client: Client,
  serverTimeout: number,
  maxOutputChars: number,
  // biome-ignore lint/suspicious/noExplicitAny: MCP tools have dynamic schemas
): ToolDefinition<any, any> {
  // Convert JSON Schema -> Zod for real validation
  let zodParams: z.ZodType;
  try {
    zodParams = fromJSONSchema(mcpTool.inputSchema);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(
      `MCP tool ${mcpTool.qualifiedName}: JSON Schema conversion failed, falling back to z.any(): ${message}`,
    );
    zodParams = z.any();
  }

  return {
    name: mcpTool.qualifiedName,
    description: mcpTool.description,
    parameters: zodParams,
    rawInputSchema: mcpTool.inputSchema,
    outputSchema: z.string(),
    risk: mcpAnnotationsToRisk(mcpTool.annotations),
    execute: async (args: unknown, signal?: AbortSignal) => {
      const result = await client.callTool(
        {
          name: mcpTool.name,
          arguments: (args as Record<string, unknown>) ?? {},
        },
        undefined,
        { timeout: serverTimeout, signal },
      );

      // Serialize MCP content array to string
      const parts: string[] = [];
      const contentItems = (result.content ?? []) as McpContentItem[];
      for (const item of contentItems) {
        switch (item.type) {
          case 'text':
            parts.push((item as { type: 'text'; text: string }).text);
            break;
          case 'image':
            parts.push(
              `[Image content (${(item as { type: 'image'; mimeType: string }).mimeType}) omitted — not supported by current model]`,
            );
            break;
          case 'resource': {
            const res = (
              item as {
                type: 'resource';
                resource: { uri: string; text?: string };
              }
            ).resource;
            const text = res?.text ?? '';
            parts.push(text || `[Resource: ${res?.uri}]`);
            break;
          }
          default:
            parts.push(`[${item.type} content omitted — not supported]`);
        }
      }

      let output = parts.join('\n');

      // Truncate to maxOutputChars
      if (output.length > maxOutputChars) {
        output =
          output.slice(0, maxOutputChars) +
          `\n\n[OUTPUT TRUNCATED — showing first ${maxOutputChars.toLocaleString()} chars]`;
      }

      if (result.isError) {
        throw new Error(output || 'MCP tool returned an error with no content');
      }

      return output;
    },
  };
}

export class McpManager {
  private connections = new Map<string, McpConnection>();
  private toolsChangedListeners: McpToolsChangedListener[] = [];
  /** MCP ToolDefinitions currently registered in the shared tools array */
  // biome-ignore lint/suspicious/noExplicitAny: MCP tools have dynamic schemas
  private registeredToolDefs: ToolDefinition<any, any>[] = [];
  /** Cached reference to the shared tools array for re-registration after reconnect */
  // biome-ignore lint/suspicious/noExplicitAny: Shared tools array holds heterogeneous types
  private toolsArrayRef?: ToolDefinition<any, any>[];
  /** Cached maxOutputChars for re-registration after reconnect */
  private maxOutputCharsRef = 50_000;

  static readonly TOOL_COUNT_WARNING_THRESHOLD = 30;

  /**
   * Connect all enabled servers from config.
   * Non-blocking per server — errors are caught and logged, not thrown.
   */
  async connectAll(servers: Record<string, McpServerConfig>): Promise<void> {
    const promises = Object.entries(servers)
      .filter(([_, config]) => config.enabled !== false)
      .filter(([_, config]) => config.type === 'local') // Only stdio in Issue #89
      .map(([name, config]) =>
        this.connect(name, config as McpLocalServerConfig).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`MCP server "${name}" failed to connect: ${message}`);
          // Record error state so TUI can display it
          this.connections.set(name, {
            name,
            tools: [],
            status: 'error',
            error: message,
            config: config as McpLocalServerConfig,
            stderrBuffer: [],
            reconnectAttempts: 0,
            reconnecting: false,
          });
        }),
      );

    await Promise.allSettled(promises);
    this.checkToolCountWarning();
    this.notifyToolsChanged();
  }

  /**
   * Connect a single local (stdio) MCP server.
   */
  async connect(name: string, config: McpLocalServerConfig): Promise<void> {
    // Mark as connecting (preserve existing stderr/reconnect state if reconnecting)
    const existing = this.connections.get(name);
    this.connections.set(name, {
      name,
      tools: existing?.tools ?? [],
      status: 'connecting',
      config,
      stderrBuffer: existing?.stderrBuffer ?? [],
      reconnectAttempts: existing?.reconnectAttempts ?? 0,
      reconnecting: existing?.reconnecting ?? false,
    });

    const client = new Client(
      { name: 'olliecode', version: PKG_VERSION },
      { capabilities: {} },
    );

    // Expand env vars in both command args and environment values
    const expanded = expandArray(config.command);
    const [cmd, ...args] = expanded;
    if (!cmd) throw new Error(`MCP "${name}" has empty command array`);
    const env = expandRecord(config.environment);

    // Merge process.env (filtering out undefined values) with expanded config env
    const mergedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) mergedEnv[k] = v;
    }
    Object.assign(mergedEnv, env);

    const transport = new StdioClientTransport({
      command: cmd,
      args,
      env: mergedEnv,
      stderr: 'pipe',
    });

    transport.onerror = (err) => this.handleTransportError(name, err);
    transport.onclose = () => this.handleTransportClose(name);

    // Connect with cancellable timeout (prevents timer leak on success)
    const timeout = timeoutPromise(
      config.timeout,
      `MCP "${name}" startup timed out after ${config.timeout}ms`,
    );
    try {
      await Promise.race([client.connect(transport), timeout.promise]);
    } finally {
      timeout.cancel();
    }

    // Capture stderr for debugging (D.5)
    const stderrBuffer = this.connections.get(name)?.stderrBuffer ?? [];
    this.captureStderr(name, transport, stderrBuffer);

    // Discover tools (paginated)
    const tools = await this.fetchAllTools(name, client);

    this.connections.set(name, {
      name,
      client,
      transport,
      tools,
      status: 'connected',
      config,
      stderrBuffer,
      reconnectAttempts: 0, // Reset on successful connection
      reconnecting: false,
    });

    // Subscribe to dynamic tool list changes (MCP notification)
    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        try {
          const refreshed = await this.fetchAllTools(name, client);
          const conn = this.connections.get(name);
          if (conn) {
            conn.tools = refreshed;
            this.notifyToolsChanged();
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`MCP "${name}" failed to refresh tools: ${message}`);
        }
      },
    );
  }

  /**
   * Fetch all tools from an MCP server, handling pagination.
   */
  /** Maximum number of pagination pages to fetch (guards against infinite loops). */
  private static readonly MAX_TOOL_PAGES = 100;

  private async fetchAllTools(
    serverName: string,
    client: Client,
  ): Promise<McpToolInfo[]> {
    const allTools: McpToolInfo[] = [];
    let cursor: string | undefined;
    let page = 0;

    do {
      if (++page > McpManager.MAX_TOOL_PAGES) {
        console.warn(
          `MCP "${serverName}": exceeded ${McpManager.MAX_TOOL_PAGES} tool pages, ` +
            `stopping at ${allTools.length} tools`,
        );
        break;
      }

      const result = await client.listTools(cursor ? { cursor } : undefined);

      for (const tool of result.tools) {
        allTools.push({
          name: tool.name,
          qualifiedName: `mcp__${serverName}__${tool.name}`,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema as Record<string, unknown>,
          annotations: tool.annotations as McpToolAnnotations | undefined,
          serverName,
        });
      }

      cursor = result.nextCursor;
    } while (cursor);

    return allTools;
  }

  /**
   * Get all discovered tools across all connected servers.
   */
  getAllTools(): McpToolInfo[] {
    const allTools: McpToolInfo[] = [];
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') {
        allTools.push(...conn.tools);
      }
    }
    return allTools;
  }

  /**
   * Get tools for a specific server.
   */
  getServerTools(serverName: string): McpToolInfo[] {
    return this.connections.get(serverName)?.tools ?? [];
  }

  /**
   * Call a tool on an MCP server.
   * The qualifiedName is parsed to route to the correct server.
   */
  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: McpContentItem[]; isError?: boolean }> {
    const parsed = McpManager.parseQualifiedName(qualifiedName);
    if (!parsed) {
      throw new Error(`Invalid MCP tool name: ${qualifiedName}`);
    }

    const conn = this.connections.get(parsed.serverName);
    if (!conn || conn.status !== 'connected') {
      const status = conn?.status ?? 'unknown';
      const error = conn?.error ? `: ${conn.error}` : '';
      throw new Error(
        `MCP server "${parsed.serverName}" is ${status}${error}. Tool unavailable.`,
      );
    }

    if (!conn.client) {
      throw new Error(
        `MCP server "${parsed.serverName}" has no active client. Tool unavailable.`,
      );
    }

    const result = await conn.client.callTool({
      name: parsed.toolName,
      arguments: args,
    });

    return {
      content: (result.content ?? []) as McpContentItem[],
      isError: result.isError as boolean | undefined,
    };
  }

  /**
   * Parse a qualified tool name into server and tool components.
   * Returns null if the name doesn't match the mcp__server__tool pattern.
   */
  static parseQualifiedName(
    qualifiedName: string,
  ): { serverName: string; toolName: string } | null {
    const match = qualifiedName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
    if (!match?.[1] || !match[2]) return null;
    return { serverName: match[1], toolName: match[2] };
  }

  /**
   * Get status map for all servers (for TUI display).
   */
  getStatus(): McpStatusMap {
    const status: McpStatusMap = new Map();
    for (const [name, conn] of this.connections) {
      status.set(name, {
        status: conn.status,
        toolCount: conn.tools.length,
        error: conn.error,
      });
    }
    return status;
  }

  /**
   * Check if any servers are still connecting.
   */
  isConnecting(): boolean {
    for (const conn of this.connections.values()) {
      if (conn.status === 'connecting') return true;
    }
    return false;
  }

  /**
   * Get the number of connected servers.
   */
  get connectedCount(): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') count++;
    }
    return count;
  }

  /**
   * Register a listener for tool list changes.
   */
  onToolsChanged(listener: McpToolsChangedListener): () => void {
    this.toolsChangedListeners.push(listener);
    return () => {
      const idx = this.toolsChangedListeners.indexOf(listener);
      if (idx >= 0) this.toolsChangedListeners.splice(idx, 1);
    };
  }

  /**
   * Register MCP tools into the shared tools array as ToolDefinitions.
   * Called after connectAll() or when tools change dynamically.
   *
   * @param toolsArray - The mutable shared tools array from tools/index.ts
   * @param maxOutputChars - Max chars for MCP tool output truncation
   */
  registerTools(
    // biome-ignore lint/suspicious/noExplicitAny: Shared tools array holds heterogeneous types
    toolsArray: ToolDefinition<any, any>[],
    maxOutputChars: number,
  ): void {
    // Cache refs for auto-re-registration after reconnect
    this.toolsArrayRef = toolsArray;
    this.maxOutputCharsRef = maxOutputChars;

    // First remove any previously registered MCP tools
    this.unregisterTools(toolsArray);

    const newDefs: ToolDefinition<any, any>[] = [];

    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected' || !conn.client) continue;

      for (const mcpTool of conn.tools) {
        const def = createMcpToolDef(
          mcpTool,
          conn.client,
          conn.config.timeout,
          maxOutputChars,
        );
        newDefs.push(def);
      }
    }

    // Push into shared array
    toolsArray.push(...newDefs);
    this.registeredToolDefs = newDefs;
  }

  /**
   * Remove all MCP tools from the shared tools array.
   */
  unregisterTools(
    // biome-ignore lint/suspicious/noExplicitAny: Shared tools array holds heterogeneous types
    toolsArray: ToolDefinition<any, any>[],
  ): void {
    if (this.registeredToolDefs.length === 0) return;

    const mcpNames = new Set(this.registeredToolDefs.map((d) => d.name));
    // Remove in-place by filtering
    for (let i = toolsArray.length - 1; i >= 0; i--) {
      if (mcpNames.has(toolsArray[i]!.name)) {
        toolsArray.splice(i, 1);
      }
    }
    this.registeredToolDefs = [];
  }

  /**
   * Get the currently registered MCP ToolDefinitions.
   */
  // biome-ignore lint/suspicious/noExplicitAny: MCP tools have dynamic schemas
  getRegisteredToolDefs(): ToolDefinition<any, any>[] {
    return [...this.registeredToolDefs];
  }

  /**
   * Disconnect all servers gracefully.
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.entries()).map(
      async ([name, conn]) => {
        try {
          // Cancel any pending reconnect
          if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
          conn.reconnecting = false;

          if (conn.client && conn.status === 'connected') {
            await conn.client.close();
          }
          conn.status = 'disconnected';
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`MCP "${name}" error during disconnect: ${message}`);
          conn.status = 'disconnected';
        }
      },
    );

    await Promise.allSettled(promises);
    this.connections.clear();
  }

  /**
   * Disconnect a single server.
   */
  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;

    // Cancel any pending reconnect
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    conn.reconnecting = false;

    try {
      if (conn.client && conn.status === 'connected') {
        await conn.client.close();
      }
    } catch {
      // Best effort
    }

    this.connections.delete(name);
    this.notifyToolsChanged();
  }

  // --- Internal handlers ---

  private handleTransportError(name: string, err: Error): void {
    const conn = this.connections.get(name);
    if (conn) {
      conn.status = 'error';
      conn.error = err.message;
      conn.client = undefined;
      conn.transport = undefined;
      console.error(`MCP "${name}" transport error: ${err.message}`);
      this.notifyToolsChanged();
      // Attempt auto-reconnect
      this.scheduleReconnect(name);
    }
  }

  private handleTransportClose(name: string): void {
    const conn = this.connections.get(name);
    if (conn && conn.status === 'connected') {
      conn.status = 'disconnected';
      conn.client = undefined;
      conn.transport = undefined;
      console.error(`MCP "${name}" transport closed unexpectedly`);
      this.notifyToolsChanged();
      // Attempt auto-reconnect (D.2)
      this.scheduleReconnect(name);
    }
  }

  /**
   * Schedule an auto-reconnect attempt with exponential backoff (D.2).
   * Max 3 attempts, delays: 1s, 2s, 4s (capped at 30s).
   */
  private scheduleReconnect(name: string): void {
    const conn = this.connections.get(name);
    if (!conn || conn.reconnecting) return;
    if (conn.reconnectAttempts >= RECONNECT.maxAttempts) {
      console.error(
        `MCP "${name}" exceeded max reconnect attempts (${RECONNECT.maxAttempts}). Giving up.`,
      );
      conn.status = 'error';
      conn.error = `Disconnected after ${RECONNECT.maxAttempts} reconnect attempts`;
      this.notifyToolsChanged();
      return;
    }

    const delay = Math.min(
      RECONNECT.initialDelayMs *
        RECONNECT.backoffMultiplier ** conn.reconnectAttempts,
      RECONNECT.maxDelayMs,
    );
    conn.reconnectAttempts++;
    conn.reconnecting = true;

    console.error(
      `MCP "${name}" scheduling reconnect attempt ${conn.reconnectAttempts}/${RECONNECT.maxAttempts} in ${delay}ms`,
    );

    conn.reconnectTimer = setTimeout(async () => {
      const current = this.connections.get(name);
      if (!current || current.status === 'connected') {
        if (current) current.reconnecting = false;
        return;
      }

      // Reset flag before connect so transport errors during connect can re-trigger
      current.reconnecting = false;

      try {
        await this.connect(name, current.config);
        console.error(`MCP "${name}" reconnected successfully`);
        // Re-register tools with fresh client references
        if (this.toolsArrayRef) {
          this.registerTools(this.toolsArrayRef, this.maxOutputCharsRef);
        }
        this.notifyToolsChanged();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`MCP "${name}" reconnect failed: ${message}`);
        const c = this.connections.get(name);
        if (c) {
          c.status = 'error';
          c.error = message;
          // Try again if we haven't hit the limit
          this.scheduleReconnect(name);
        }
      }
    }, delay);
  }

  /**
   * Capture stderr output from the server process (D.5).
   * Stores the last STDERR_BUFFER_SIZE lines for debugging.
   */
  private captureStderr(
    name: string,
    transport: StdioClientTransport,
    buffer: string[],
  ): void {
    // Access the underlying process stderr via the transport
    // StdioClientTransport exposes stderr when configured with stderr: 'pipe'
    const proc = (
      transport as unknown as { _process?: { stderr?: NodeJS.ReadableStream } }
    )._process;
    const stderr = proc?.stderr;
    if (!stderr) return;

    let partial = '';
    stderr.on('data', (chunk: Buffer) => {
      partial += chunk.toString();
      const lines = partial.split('\n');
      // Keep the last incomplete line as partial
      partial = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          buffer.push(line);
          if (buffer.length > STDERR_BUFFER_SIZE) {
            buffer.shift();
          }
        }
      }
    });
  }

  /**
   * Get captured stderr lines for a server (for /mcp command display).
   */
  getServerStderr(serverName: string): string[] {
    return [...(this.connections.get(serverName)?.stderrBuffer ?? [])];
  }

  private checkToolCountWarning(): void {
    const total = this.getAllTools().length;
    if (total > McpManager.TOOL_COUNT_WARNING_THRESHOLD) {
      console.warn(
        `MCP: ${total} tools registered (>${McpManager.TOOL_COUNT_WARNING_THRESHOLD}). ` +
          'This adds to context — consider disabling unused servers.',
      );
    }
  }

  private notifyToolsChanged(): void {
    const tools = this.getAllTools();
    for (const listener of this.toolsChangedListeners) {
      try {
        listener(tools);
      } catch {
        // Don't let a bad listener break the manager
      }
    }
  }
}

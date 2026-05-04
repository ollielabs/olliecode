import type { Tool } from 'ollama';
import { z } from 'zod';
import { BUILTIN_BUILD_AGENT, BUILTIN_PLAN_AGENT } from '../agents/builtins';
import { TOOL_TO_PERMISSION_KEY } from '../agents/schema';
import type { AgentMode } from '../modes';
import { isMcpToolReadOnly } from '../mcp/types';
import type { McpToolInfo } from '../mcp/types';
import { fromConfig, evaluate } from '../permission/index';
import type { PermissionConfig } from '../permission/types';
import type { ToolContext, ToolDefinition, ToolResult } from '../types';
import { editFileTool } from './edit-file';
import { globTool } from './glob';
import { grepTool } from './grep';
import { listDirTool } from './list-dir';
import { readFileTool } from './read-file';
import { runCommandTool } from './run-command';
import { taskTool } from './task';
import { todoReadTool, todoWriteTool } from './todo';
import { webFetchTool } from './web-fetch';
import { writeFileTool } from './write-file';

// All registered tools — mutable to allow MCP tool registration/unregistration
// biome-ignore lint/suspicious/noExplicitAny: Tools array holds heterogeneous tool types with different schemas
const tools: ToolDefinition<any, any>[] = [
  readFileTool,
  listDirTool,
  globTool,
  grepTool,
  writeFileTool,
  editFileTool,
  runCommandTool,
  todoWriteTool,
  todoReadTool,
  taskTool,
  webFetchTool,
];

/**
 * Get the mutable tools array for MCP registration.
 * McpManager.registerTools() and unregisterTools() operate on this array.
 */
// biome-ignore lint/suspicious/noExplicitAny: Tools array holds heterogeneous tool types
export function getToolsArray(): ToolDefinition<any, any>[] {
  return tools;
}

// Tool name constants for reference
export const TOOL_NAMES = {
  READ_FILE: 'read_file',
  LIST_DIR: 'list_dir',
  GLOB: 'glob',
  GREP: 'grep',
  WRITE_FILE: 'write_file',
  EDIT_FILE: 'edit_file',
  RUN_COMMAND: 'run_command',
  TODO_WRITE: 'todo_write',
  TODO_READ: 'todo_read',
  TASK: 'task',
  WEB_FETCH: 'web_fetch',
} as const;

// Convert ToolDefinition to Ollama Tool format
// biome-ignore lint/suspicious/noExplicitAny: Generic tool definition accepts any schema
function toOllamaTool(def: ToolDefinition<any, any>): Tool {
  // Prefer raw JSON Schema (MCP tools) over Zod conversion to avoid lossy round-trip
  const jsonSchema = def.rawInputSchema ?? z.toJSONSchema(def.parameters);

  // Extract only the fields Ollama expects
  type OllamaParameters = NonNullable<Tool['function']['parameters']>;
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

/**
 * Get Ollama-compatible tool schemas for all currently registered tools.
 * Dynamic — includes MCP tools when registered.
 */
export function getOllamaTools(): Tool[] {
  return tools.map(toOllamaTool);
}

/**
 * Get a tool definition by name.
 * Useful for checking tool properties like risk level.
 */
export function getToolDefinition(
  name: string,
  // biome-ignore lint/suspicious/noExplicitAny: Returns generic tool definition
): ToolDefinition<any, any> | undefined {
  return tools.find((t) => t.name === name);
}

/**
 * Check if a tool is safe for parallel execution.
 * Safe tools have risk: "safe" and don't require confirmation.
 */
export function isToolSafeForParallel(name: string): boolean {
  const tool = getToolDefinition(name);
  return tool?.risk === 'safe';
}

/**
 * Get all tools that are safe for parallel execution.
 */
export function getSafeParallelTools(): string[] {
  return tools.filter((t) => t.risk === 'safe').map((t) => t.name);
}

/**
 * Check if a tool name is an MCP tool (mcp__server__tool pattern).
 */
function isMcpTool(name: string): boolean {
  return name.startsWith('mcp__');
}

/**
 * Check if a single tool is allowed by the given permission config.
 *
 * For native tools: looks up the permission key via TOOL_TO_PERMISSION_KEY
 * and evaluates against the permission config.
 *
 * For MCP tools: evaluates the 'mcp' permission key with the qualified name.
 * If no 'mcp' rules exist, falls back to the wildcard '*' rule.
 */
export function isToolAllowedByPermission(
  toolName: string,
  permissionConfig: PermissionConfig,
): boolean {
  const ruleset = fromConfig(permissionConfig);

  if (isMcpTool(toolName)) {
    // MCP tools are checked against the 'mcp' permission key
    const action = evaluate('mcp', toolName, ruleset);
    return action !== 'deny';
  }

  // Native tool: find its permission key
  const permKey = TOOL_TO_PERMISSION_KEY[toolName];
  if (permKey) {
    const action = evaluate(permKey, '*', ruleset);
    return action !== 'deny';
  }

  // Unknown tool: evaluate against wildcard
  const action = evaluate(toolName, '*', ruleset);
  return action !== 'deny';
}

/**
 * Get Ollama-compatible tools filtered by an agent's permission config.
 *
 * Native tools: filtered by evaluating each tool's permission key.
 * MCP tools: filtered by 'mcp' permission key with qualified name matching.
 * When no permission config is provided (undefined), all tools are included.
 *
 * Pre-parses the permission config into a ruleset once, then filters all
 * tools against it (avoids re-parsing per tool).
 *
 * @param permissionConfig - The agent's permission config (undefined = all tools allowed)
 */
export function getToolsForAgent(permissionConfig?: PermissionConfig): Tool[] {
  if (!permissionConfig) {
    // No permission config = all tools allowed
    return tools.map(toOllamaTool);
  }

  // Parse once, filter all tools against the cached ruleset
  const ruleset = fromConfig(permissionConfig);

  return tools
    .filter((t) => {
      if (isMcpTool(t.name)) {
        return evaluate('mcp', t.name, ruleset) !== 'deny';
      }
      const permKey = TOOL_TO_PERMISSION_KEY[t.name];
      if (permKey) {
        return evaluate(permKey, '*', ruleset) !== 'deny';
      }
      return evaluate(t.name, '*', ruleset) !== 'deny';
    })
    .map(toOllamaTool);
}

/**
 * Get Ollama-compatible tools filtered by mode.
 *
 * Backward-compatible wrapper that resolves mode to built-in agent permissions.
 * Prefer `getToolsForAgent()` for new code.
 *
 * @deprecated Use getToolsForAgent() with the agent's permission config instead.
 */
export function getToolsForMode(mode: AgentMode): Tool[] {
  const agent = mode === 'plan' ? BUILTIN_PLAN_AGENT : BUILTIN_BUILD_AGENT;
  return getToolsForAgent(agent.permission);
}

// Execute a tool by name with validated args
export async function executeTool(
  name: string,
  args: unknown,
  signal?: AbortSignal,
  context?: ToolContext,
): Promise<ToolResult> {
  // Check for abort before execution
  if (signal?.aborted) {
    return { tool: name, output: '', error: 'Aborted' };
  }

  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    return { tool: name, output: '', error: `Unknown tool: ${name}` };
  }

  const parsed = tool.parameters.safeParse(args);
  if (!parsed.success) {
    // Format Zod errors more clearly for debugging
    const issues = parsed.error.issues
      .map(
        (i: { path: (string | number)[]; message: string }) =>
          `${i.path.join('.')}: ${i.message}`,
      )
      .join('; ');
    return {
      tool: name,
      output: '',
      error: `Invalid arguments: ${issues}. Received: ${JSON.stringify(args)}`,
    };
  }

  try {
    const result = await tool.execute(parsed.data, signal, context);

    // Validate output
    const outputParsed = tool.outputSchema.safeParse(result);
    if (!outputParsed.success) {
      return {
        tool: name,
        output: '',
        error: `Invalid output: ${outputParsed.error.message}`,
      };
    }

    // Serialize for LLM
    const output =
      typeof outputParsed.data === 'string'
        ? outputParsed.data
        : JSON.stringify(outputParsed.data, null, 2);

    return { tool: name, output };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { tool: name, output: '', error: message };
  }
}

import { z } from "zod";
import type { Tool } from "ollama";
import type { ToolDefinition, ToolResult, ToolContext } from "../types";
import type { AgentMode } from "../modes";
import { MODE_TOOLS } from "../modes";
import { readFileTool } from "./read-file";
import { listDirTool } from "./list-dir";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { writeFileTool } from "./write-file";
import { editFileTool } from "./edit-file";
import { runCommandTool } from "./run-command";
import { todoWriteTool, todoReadTool } from "./todo";
import { taskTool } from "./task";

// All registered tools
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
];

// Tool name constants for reference
export const TOOL_NAMES = {
  READ_FILE: "read_file",
  LIST_DIR: "list_dir",
  GLOB: "glob",
  GREP: "grep",
  WRITE_FILE: "write_file",
  EDIT_FILE: "edit_file",
  RUN_COMMAND: "run_command",
  TODO_WRITE: "todo_write",
  TODO_READ: "todo_read",
  TASK: "task",
} as const;

// Convert ToolDefinition to Ollama Tool format
function toOllamaTool(def: ToolDefinition<any, any>): Tool {
  const jsonSchema = z.toJSONSchema(def.parameters);
  
  // Extract only the fields Ollama expects
  type OllamaParameters = NonNullable<Tool["function"]["parameters"]>;
  const { type, properties, required } = jsonSchema as {
    type?: OllamaParameters["type"];
    properties?: OllamaParameters["properties"];
    required?: OllamaParameters["required"];
  };

  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: { type, properties, required },
    },
  };
}

// Ollama-compatible tool schemas (all tools)
export const ollamaTools: Tool[] = tools.map(toOllamaTool);

/**
 * Get a tool definition by name.
 * Useful for checking tool properties like risk level.
 */
export function getToolDefinition(
  name: string
): ToolDefinition<any, any> | undefined {
  return tools.find((t) => t.name === name);
}

/**
 * Check if a tool is safe for parallel execution.
 * Safe tools have risk: "safe" and don't require confirmation.
 */
export function isToolSafeForParallel(name: string): boolean {
  const tool = getToolDefinition(name);
  return tool?.risk === "safe";
}

/**
 * Get all tools that are safe for parallel execution.
 */
export function getSafeParallelTools(): string[] {
  return tools.filter((t) => t.risk === "safe").map((t) => t.name);
}

/**
 * Get Ollama-compatible tools filtered by mode
 * Plan mode: read-only tools only
 * Build mode: all tools
 */
export function getToolsForMode(mode: AgentMode): Tool[] {
  const allowedTools = MODE_TOOLS[mode];
  return tools
    .filter((t) => allowedTools.includes(t.name))
    .map(toOllamaTool);
}

// Execute a tool by name with validated args
export async function executeTool(
  name: string,
  args: unknown,
  signal?: AbortSignal,
  context?: ToolContext
): Promise<ToolResult> {
  // Check for abort before execution
  if (signal?.aborted) {
    return { tool: name, output: "", error: "Aborted" };
  }

  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    return { tool: name, output: "", error: `Unknown tool: ${name}` };
  }

  const parsed = tool.parameters.safeParse(args);
  if (!parsed.success) {
    // Format Zod errors more clearly for debugging
    const issues = parsed.error.issues
      .map((i: { path: (string | number)[]; message: string }) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { tool: name, output: "", error: `Invalid arguments: ${issues}. Received: ${JSON.stringify(args)}` };
  }

  try {
    const result = await tool.execute(parsed.data, signal, context);

    // Validate output
    const outputParsed = tool.outputSchema.safeParse(result);
    if (!outputParsed.success) {
      return { tool: name, output: "", error: `Invalid output: ${outputParsed.error.message}` };
    }

    // Serialize for LLM
    const output =
      typeof outputParsed.data === "string"
        ? outputParsed.data
        : JSON.stringify(outputParsed.data, null, 2);

    return { tool: name, output };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { tool: name, output: "", error: message };
  }
}

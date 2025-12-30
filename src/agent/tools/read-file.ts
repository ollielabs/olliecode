import { z } from "zod";
import type { ToolDefinition } from "../types";

const inputSchema = z.object({
  path: z.string().describe("The file path to read"),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Line number to start reading from (0-based, default: 0)"),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Maximum number of lines to read (default: 2000)"),
});

const outputSchema = z.string().describe("The file contents with line numbers");

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

/**
 * Add line numbers to content in the format "   42|code"
 * Matches OpenCode's view tool format for consistency.
 */
function addLineNumbers(content: string, startLine: number): string {
  const lines = content.split("\n");
  const maxLineNum = startLine + lines.length;
  const padWidth = Math.max(6, String(maxLineNum).length);

  return lines
    .map((line, i) => {
      const lineNum = String(startLine + i).padStart(padWidth, " ");
      // Truncate very long lines
      const truncatedLine =
        line.length > MAX_LINE_LENGTH
          ? line.slice(0, MAX_LINE_LENGTH) + "..."
          : line;
      return `${lineNum}|${truncatedLine}`;
    })
    .join("\n");
}

export const readFileTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "read_file",
  description: `Read the contents of a file at the given path.

Returns file contents with line numbers in format: "   42|code"

Parameters:
- path: File path to read (required)
- offset: Line number to start from, 0-based (optional, default: 0)  
- limit: Max lines to read (optional, default: 2000)

Use offset and limit for large files to read specific sections.`,
  parameters: inputSchema,
  outputSchema,
  risk: "safe",
  execute: async ({ path, offset = 0, limit = DEFAULT_LIMIT }) => {
    const content = await Bun.file(path).text();
    const lines = content.split("\n");

    // Apply offset and limit
    const startLine = Math.min(offset, lines.length);
    const endLine = Math.min(startLine + limit, lines.length);
    const selectedLines = lines.slice(startLine, endLine);

    // Format with line numbers (1-based for display)
    const formatted = addLineNumbers(selectedLines.join("\n"), startLine + 1);

    // Add metadata about truncation
    let result = `<file path="${path}">\n${formatted}\n</file>`;

    if (endLine < lines.length) {
      result += `\n\n(File has ${lines.length} total lines. Showing lines ${startLine + 1}-${endLine}. Use offset parameter to read more.)`;
    }

    return result;
  },
};

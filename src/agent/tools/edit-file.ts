import { z } from "zod";
import type { ToolDefinition } from "../types";

const inputSchema = z.object({
  path: z.string().min(1, { message: "Path must not be empty" }).describe("The file path to edit"),
  oldString: z.string().min(1, { message: "oldString must not be empty" }).describe("The exact string to find and replace"),
  newString: z.string().min(1, { message: "newString must not be empty" }).describe("The string to replace it with"),
});

const outputSchema = z.string().describe("Success message confirming the edit");

export const editFileTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "edit_file",
  description: "Replace a specific string in a file. The oldString must match exactly (including whitespace). Use read_file first to see the exact content.",
  parameters: inputSchema,
  outputSchema,
  risk: "medium",
  execute: async ({ path, oldString, newString }) => {
    const file = Bun.file(path);
    
    if (!await file.exists()) {
      throw new Error(`File not found: ${path}`);
    }
    
    const content = await file.text();
    
    if (!content.includes(oldString)) {
      throw new Error(`String not found in file. Make sure it matches exactly, including whitespace.`);
    }
    
    // Count occurrences
    const occurrences = content.split(oldString).length - 1;
    if (occurrences > 1) {
      throw new Error(`String found ${occurrences} times. Please provide a more specific string that matches exactly once.`);
    }
    
    const newContent = content.replace(oldString, newString);
    await Bun.write(path, newContent);
    
    return `Replaced 1 occurrence in ${path}`;
  },
};

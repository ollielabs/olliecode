import { z } from "zod";
import { readdir } from "fs/promises";
import type { ToolDefinition } from "../types";

const inputSchema = z.object({
  path: z.string().describe("The directory path to list"),
});

const outputSchema = z.array(z.string()).describe("Array of file and directory names");

export const listDirTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "list_dir",
  description: "List files and directories at the given path",
  parameters: inputSchema,
  outputSchema,
  risk: "safe",
  execute: async ({ path }) => {
    return await readdir(path);
  },
};

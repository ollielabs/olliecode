import { z } from "zod";
import type { ToolDefinition } from "../types";

const inputSchema = z.object({
  path: z.string().describe("The file path to read"),
});

const outputSchema = z.string().describe("The file contents");

export const readFileTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "read_file",
  description: "Read the contents of a file at the given path",
  parameters: inputSchema,
  outputSchema,
  risk: "safe",
  execute: async ({ path }) => {
    return await Bun.file(path).text();
  },
};

import { z } from "zod";
import { Glob } from "bun";
import type { ToolDefinition } from "../types";

// Directories to always exclude from glob results
const EXCLUDED_DIRS = ["node_modules", ".git", "dist", "build", ".next", ".cache"];

const inputSchema = z.object({
  pattern: z.string().min(1, { message: "Pattern must not be empty" }).describe("Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.tsx')"),
  cwd: z.string().optional().describe("Directory to search from (defaults to working directory)"),
});

const outputSchema = z.array(z.string()).describe("Array of matching file paths");

export const globTool: ToolDefinition<typeof inputSchema, typeof outputSchema> = {
  name: "glob",
  description: "Find files matching a glob pattern. Excludes node_modules, .git, and build directories. Useful for discovering source files across nested directories.",
  parameters: inputSchema,
  outputSchema,
  risk: "safe",
  execute: async ({ pattern, cwd }) => {
    const searchDir = cwd ?? ".";
    const glob = new Glob(pattern);
    const matches: string[] = [];
    
    for await (const file of glob.scan({ cwd: searchDir, onlyFiles: true })) {
      // Skip excluded directories
      const shouldExclude = EXCLUDED_DIRS.some(dir => file.includes(`${dir}/`) || file.startsWith(`${dir}/`));
      if (shouldExclude) continue;
      
      // Return full path relative to working directory so paths can be used directly with read_file
      const fullPath = searchDir === "." ? file : `${searchDir}/${file}`;
      matches.push(fullPath);
    }
    
    return matches.sort();
  },
};

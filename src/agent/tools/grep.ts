import { z } from 'zod';
import { Glob } from 'bun';
import type { ToolDefinition } from '../types';

const inputSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for in file contents'),
  filePattern: z
    .string()
    .optional()
    .describe(
      "Glob pattern to filter files (e.g., '**/*.ts'). Defaults to all files.",
    ),
  cwd: z
    .string()
    .optional()
    .describe('Directory to search from (defaults to working directory)'),
});

type GrepMatch = {
  file: string;
  line: number;
  content: string;
};

const outputSchema = z
  .array(
    z.object({
      file: z.string(),
      line: z.number(),
      content: z.string(),
    }),
  )
  .describe(
    'Array of matches with file path, line number, and matching line content',
  );

export const grepTool: ToolDefinition<typeof inputSchema, typeof outputSchema> =
  {
    name: 'grep',
    description:
      'Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.',
    parameters: inputSchema,
    outputSchema,
    risk: 'safe',
    execute: async ({ pattern, filePattern, cwd }) => {
      const regex = new RegExp(pattern, 'i');
      const glob = new Glob(filePattern ?? '**/*');
      const matches: GrepMatch[] = [];
      const searchDir = cwd ?? '.';

      for await (const filePath of glob.scan({
        cwd: searchDir,
        onlyFiles: true,
      })) {
        // Skip binary files and node_modules
        if (filePath.includes('node_modules') || filePath.includes('.git')) {
          continue;
        }

        try {
          const fullPath =
            searchDir === '.' ? filePath : `${searchDir}/${filePath}`;
          const content = await Bun.file(fullPath).text();
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line && regex.test(line)) {
              matches.push({
                file: filePath,
                line: i + 1,
                content: line.trim().slice(0, 200), // Limit line length
              });
            }
          }
        } catch {
          // Skip files that can't be read (binary, permissions, etc.)
        }
      }

      return matches;
    },
  };

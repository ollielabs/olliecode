import { z } from 'zod';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolDefinition } from '../types';

const inputSchema = z.object({
  path: z.string().describe('The file path to write to'),
  content: z.string().describe('The content to write to the file'),
});

const outputSchema = z.string().describe('Success message with bytes written');

export const writeFileTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: 'write_file',
  description:
    'Create or overwrite a file with the given content. Creates parent directories if needed.',
  parameters: inputSchema,
  outputSchema,
  risk: 'prompt', // Requires user confirmation in Phase 3
  execute: async ({ path, content }) => {
    // Ensure parent directory exists
    const dir = dirname(path);
    if (dir && dir !== '.') {
      await mkdir(dir, { recursive: true });
    }

    await Bun.write(path, content);

    return `Wrote ${content.length} bytes to ${path}`;
  },
};

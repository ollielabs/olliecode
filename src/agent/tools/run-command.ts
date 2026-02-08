import { z } from 'zod';
import type { ToolContext, ToolDefinition } from '../types';

const inputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  cwd: z
    .string()
    .optional()
    .describe(
      'Working directory for the command (defaults to current directory)',
    ),
  timeout: z
    .number()
    .optional()
    .describe('Timeout in milliseconds (defaults to 30000)'),
});

const outputSchema = z
  .object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  })
  .describe('Command output with stdout, stderr, and exit code');

export const runCommandTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: 'run_command',
  description:
    'Execute a shell command and return its output. Use with caution.',
  parameters: inputSchema,
  outputSchema,
  risk: 'prompt', // Requires user confirmation in Phase 3
  execute: async (
    {
      command,
      cwd,
      timeout,
    }: { command: string; cwd?: string; timeout?: number },
    signal?: AbortSignal,
    context?: ToolContext,
  ) => {
    const defaultTimeout = context?.toolsConfig?.run_command.timeout ?? 30000;
    const maxOutputSize =
      context?.toolsConfig?.run_command.maxOutputSize ?? 10000;
    const timeoutMs = timeout ?? defaultTimeout;

    const proc = Bun.spawn(['sh', '-c', command], {
      cwd: cwd ?? '.',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Handle abort signal
    if (signal) {
      signal.addEventListener('abort', () => {
        proc.kill();
      });
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      proc.kill();
    }, timeoutMs);

    try {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;

      return {
        stdout: stdout.slice(0, maxOutputSize),
        stderr: stderr.slice(0, maxOutputSize),
        exitCode,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

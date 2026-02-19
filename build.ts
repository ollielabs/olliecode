/**
 * Production build script using Bun.build() with the Solid JSX plugin.
 *
 * The Solid JSX transform requires a Bun plugin which can't be registered
 * via the CLI `bun build --compile` command. This script wraps Bun.build()
 * to register the plugin before compilation.
 *
 * Usage:
 *   bun run build.ts                                           # default: compile for current platform
 *   bun run build.ts --target=bun-darwin-arm64 --outfile=dist/ollie-darwin-arm64
 *   bun run build.ts --target=bun-darwin-x64 --outfile=dist/ollie-darwin-x64
 */

import { parseArgs } from 'node:util';
import solidPlugin from '@opentui/solid/bun-plugin';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    target: { type: 'string' },
    outfile: { type: 'string' },
  },
  strict: false,
});

const outfile = values.outfile ?? 'ollie';
const target = values.target as
  | 'bun-darwin-arm64'
  | 'bun-darwin-x64'
  | undefined;

const result = await Bun.build({
  entrypoints: [
    'src/index.tsx',
    './node_modules/@opentui/core/parser.worker.js',
  ],
  target: (target ?? 'bun') as 'bun',
  outfile,
  plugins: [solidPlugin],
  define: {
    OTUI_TREE_SITTER_WORKER_PATH:
      '"/$bunfs/root/node_modules/@opentui/core/parser.worker.js"',
  },
  compile: true,
} as Parameters<typeof Bun.build>[0] & { compile: boolean });

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Build succeeded: ${outfile}`);

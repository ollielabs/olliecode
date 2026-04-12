/**
 * Production build script using Bun.build() with the Solid JSX plugin.
 *
 * Uses the compile object API (not `compile: true`) to produce standalone
 * binaries with the Solid JSX transform applied via Bun plugin.
 *
 * Based on OpenCode's build approach:
 * https://github.com/anomalyco/opencode/blob/dev/packages/opencode/script/build.ts
 *
 * Usage:
 *   bun run build.ts                                           # default: compile for current platform
 *   bun run build.ts --target=bun-darwin-arm64 --outfile=dist/ollie-darwin-arm64
 *   bun run build.ts --target=bun-darwin-x64 --outfile=dist/ollie-darwin-x64
 */

import { parseArgs } from 'node:util';
import { createSolidTransformPlugin } from '@opentui/solid/bun-plugin';

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

const plugin = createSolidTransformPlugin();
const parserWorker = './node_modules/@opentui/core/parser.worker.js';
const workerRelativePath = 'node_modules/@opentui/core/parser.worker.js';

// The compile object API is supported by Bun but not yet in bun-types.
// biome-ignore lint/suspicious/noExplicitAny: Bun.build compile API ahead of type defs
const result = await Bun.build({
  entrypoints: ['src/index.tsx', parserWorker],
  plugins: [plugin],
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    target: target ?? `bun-${process.platform}-${process.arch}`,
    outfile,
  },
  define: {
    OTUI_TREE_SITTER_WORKER_PATH: `"/$bunfs/root/${workerRelativePath}"`,
  },
} as any);

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Build succeeded: ${outfile}`);

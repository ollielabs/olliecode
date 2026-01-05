import { addDefaultParsers, getTreeSitterClient } from '@opentui/core';

export async function initializeTreeSitterParsers(tsworkerDebug: boolean) {
  // Register additional language parsers
  addDefaultParsers([
    {
      filetype: 'python',
      wasm: 'https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm',
      queries: {
        highlights: [
          'https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/highlights.scm',
        ],
      },
    },
    {
      filetype: 'rust',
      wasm: 'https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm',
      queries: {
        highlights: [
          'https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/master/queries/highlights.scm',
        ],
      },
    },
    {
      filetype: 'go',
      wasm: 'https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm',
      queries: {
        highlights: [
          'https://raw.githubusercontent.com/tree-sitter/tree-sitter-go/master/queries/highlights.scm',
        ],
      },
    },
    {
      filetype: 'bash',
      wasm: 'https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.23.3/tree-sitter-bash.wasm',
      queries: {
        highlights: [
          'https://raw.githubusercontent.com/tree-sitter/tree-sitter-bash/master/queries/highlights.scm',
        ],
      },
    },
    {
      filetype: 'json',
      wasm: 'https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm',
      queries: {
        highlights: [
          'https://raw.githubusercontent.com/tree-sitter/tree-sitter-json/master/queries/highlights.scm',
        ],
      },
    },
  ]);

  // Initialize tree-sitter client for syntax highlighting
  const treeSitterClient = getTreeSitterClient();

  // Suppress TSWorker loading logs during initialization (set TSWORKER_DEBUG=1 to show)
  const originalLog = console.log;
  if (!tsworkerDebug) {
    console.log = (...args: unknown[]) => {
      const msg = String(args[0] ?? '');
      if (!msg.startsWith('TSWorker:')) {
        originalLog(...args);
      }
    };
  }

  await treeSitterClient.initialize();

  // Preload commonly used parsers for faster first render
  await Promise.all([
    treeSitterClient.preloadParser('javascript'),
    treeSitterClient.preloadParser('typescript'),
    treeSitterClient.preloadParser('python'),
  ]);

  // Restore console.log after initialization
  console.log = originalLog;

  return treeSitterClient;
}

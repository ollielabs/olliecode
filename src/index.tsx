import { Command } from 'commander';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { initializeTreeSitterParsers } from './lib/tree-sitter';
import { App } from './tui';
import {
  initDatabase,
  getSession,
  getLatestSession,
  closeDatabase,
} from './session';
import { getConfigValue } from './config';

const program = new Command();

program
  .name('olly')
  .description('Olly - Local agentic coding assistant')
  .version('0.0.1');

program
  .option('--tsworker-debug', 'enable tsworker debug logging')
  .option('-m, --model <model>', 'ollama model to use', 'llama3.2:latest')
  .option(
    '-h, --host <host>',
    'ollama host to connect to',
    'http://127.0.0.1:11434',
  )
  .option('-s, --session <id>', 'resume a specific session by ID')
  .option('-c, --continue', 'continue the most recent session for this project')
  .action(async (options) => {
    const tsworkerDebug = options.tsworkerDebug ? 1 : undefined;
    const {
      model,
      host,
      session: sessionId,
      continue: continueSession,
    } = options;
    const ollamaHost = process.env.OLLAMA_HOST || host;
    const projectPath = process.cwd();

    // Initialize database
    initDatabase();

    // Resolve session if --session or --continue flags provided
    let initialSessionId: string | undefined;

    if (sessionId) {
      // --session <id>: Resume specific session
      const session = getSession(sessionId);
      if (!session) {
        console.error(`Error: Session not found: ${sessionId}`);
        closeDatabase();
        process.exit(1);
      }
      initialSessionId = session.id;
      console.error(`Resuming session: ${session.title ?? session.id}`);
    } else if (continueSession) {
      // --continue: Resume latest session for current project
      const session = getLatestSession(projectPath);
      if (!session) {
        console.error(
          `No previous session found for this project. Starting fresh.`,
        );
      } else {
        initialSessionId = session.id;
        console.error(`Continuing session: ${session.title ?? session.id}`);
      }
    }

    // Initialize tree-sitter client for syntax highlighting
    const treeSitterClient = await initializeTreeSitterParsers(!!tsworkerDebug);

    const renderer = await createCliRenderer({
      exitOnCtrlC: true,
    });

    // Load theme preference from config
    const initialTheme = getConfigValue('theme');

    createRoot(renderer).render(
      <App
        model={model}
        host={ollamaHost}
        projectPath={projectPath}
        initialSessionId={initialSessionId}
        initialTheme={initialTheme}
      />,
    );

    // Cleanup on exit
    renderer.on('destroy', () => {
      treeSitterClient.destroy();
      closeDatabase();
      setTimeout(() => process.exit(0), 100);
    });
  });

program.parse(process.argv);

import { createCliRenderer } from '@opentui/core';
import { render } from '@opentui/solid';
import { Command } from 'commander';
import { setDebugEnabled } from './agent/logger';
import {
  buildCliOverrides,
  extractAgentRegistry,
  loadMergedConfig,
} from './config';
import { initializeTreeSitterParsers } from './lib/tree-sitter';
import {
  closeDatabase,
  getLatestSession,
  getSession,
  initDatabase,
} from './session';
import { App } from './tui';

const program = new Command();

program
  .name('ollie')
  .description('Ollie Code - Agentic coding tool powered by Ollama')
  .version('0.1.0');

program
  .option('--tsworker-debug', 'enable tsworker debug logging')
  .option('-m, --model <model>', 'ollama model to use', 'llama3.2:latest')
  .option(
    '--host <host>',
    'ollama host to connect to',
    'http://127.0.0.1:11434',
  )
  .option('-s, --session <id>', 'resume a specific session by ID')
  .option('-c, --continue', 'continue the most recent session for this project')
  .option('--config <path>', 'path to custom config file')
  .option(
    '--autonomy <level>',
    'autonomy level (paranoid, cautious, balanced, autonomous)',
  )
  .option('--debug', 'enable debug logging')
  .action(async (options) => {
    const tsworkerDebug = options.tsworkerDebug ? 1 : undefined;
    const {
      session: sessionId,
      continue: continueSession,
      config: customConfigPath,
    } = options;
    const projectPath = process.cwd();

    // Build CLI overrides (only explicitly-provided flags)
    const getSource = (key: string) =>
      program.getOptionValueSource(key) as string | undefined;
    const cliOverrides = buildCliOverrides(options, getSource);

    // Load and merge all config sources
    const {
      config,
      layers: configLayers,
      warnings,
    } = loadMergedConfig(projectPath, customConfigPath, cliOverrides);

    // Wire debug config to logger (env var takes precedence, config enables)
    if (config.debug) {
      setDebugEnabled(true);
    }

    // Log config warnings to stderr
    for (const warning of warnings) {
      console.error(`[config] ${warning}`);
    }

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

    // Build agent registry (async — loads agent files from disk)
    const { registry: agentRegistry, warnings: agentWarnings } =
      await extractAgentRegistry(config, projectPath);

    // Log agent warnings to stderr (mirroring config warnings)
    for (const warning of agentWarnings) {
      console.error(`[agent] ${warning.path}: ${warning.message}`);
    }

    // Initialize tree-sitter client for syntax highlighting
    const treeSitterClient = await initializeTreeSitterParsers(!!tsworkerDebug);

    const renderer = await createCliRenderer({
      exitOnCtrlC: true,
      autoFocus: true,
    });

    void render(
      () => (
        <App
          config={config}
          configLayers={configLayers}
          configWarnings={warnings}
          agentRegistry={agentRegistry}
          agentWarnings={agentWarnings}
          projectPath={projectPath}
          initialSessionId={initialSessionId}
        />
      ),
      renderer,
    );

    // Cleanup on exit
    renderer.on('destroy', () => {
      treeSitterClient.destroy();
      closeDatabase();
      setTimeout(() => process.exit(0), 100);
    });
  });

program.parse(process.argv);

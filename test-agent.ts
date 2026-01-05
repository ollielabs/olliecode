/**
 * Test script to run the agent loop directly and observe behavior.
 * Run with: bun test-agent.ts
 */

import { runAgent } from './src/agent';

const controller = new AbortController();

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n[test] Aborting...');
  controller.abort();
  process.exit(0);
});

async function main() {
  console.log('[test] Starting agent test...\n');

  const result = await runAgent({
    model: 'rnj-1:latest',
    host: 'http://192.168.1.221:11434',
    userMessage:
      'Can you search the nested files in the source code and describe what this application does?',
    history: [],

    onReasoningToken: (token) => {
      process.stdout.write(token);
    },

    onToolCall: (call, index) => {
      console.log(
        `\n[test] Tool call ${index}: ${call.function.name}(${JSON.stringify(call.function.arguments)})`,
      );
    },

    onToolResult: (result, index) => {
      const preview =
        result.output.slice(0, 200) + (result.output.length > 200 ? '...' : '');
      console.log(`[test] Tool result ${index}: ${result.error ?? preview}\n`);
    },

    onStepComplete: (step) => {
      const actionsSummary = step.actions
        .map(
          (a) => `${a.function.name}(${JSON.stringify(a.function.arguments)})`,
        )
        .join(', ');
      console.log(
        `[test] Step complete. Actions: ${actionsSummary}, Duration: ${step.durationMs}ms\n`,
      );
    },

    signal: controller.signal,
  });

  console.log('\n\n[test] ========== RESULT ==========');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);

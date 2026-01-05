#!/usr/bin/env bun
/**
 * Script to run the Olly agent for promptfoo evaluation.
 * Called via promptfoo's exec provider.
 *
 * Usage: bun tests/run-agent.ts "prompt text"
 * Output: JSON with { output, metadata }
 */

import { runAgent } from '../src/agent';
import { initDatabase, createSession } from '../src/session';

const prompt = process.argv[2];

if (!prompt) {
  console.error('Usage: bun tests/run-agent.ts <prompt>');
  process.exit(1);
}

const model = process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';
const host = process.env.OLLAMA_HOST || 'https://ollama.com';

// Initialize database and create a session for todo tools
initDatabase();
const session = await createSession({
  projectPath: process.cwd(),
  model,
  host,
  mode: 'build',
});

const toolsCalled: string[] = [];
const toolResults: Array<{ tool: string; success: boolean }> = [];

try {
  const result = await runAgent({
    model,
    host,
    userMessage: prompt,
    history: [],
    sessionId: session.id,
    signal: new AbortController().signal,
    onReasoningToken: () => {},
    onToolCall: (tc) => {
      toolsCalled.push(tc.function.name);
    },
    onToolResult: (r) => {
      toolResults.push({ tool: r.tool, success: !r.error });
    },
    onStepComplete: () => {},
    onToolBlocked: (tool, _reason) => {
      toolResults.push({ tool, success: false });
    },
  });

  if ('type' in result) {
    // Error result - just output the error message
    console.log(`[Agent Error: ${result.type}]`);
  } else {
    // Success - output the answer
    console.log(result.finalAnswer);
  }
} catch (error) {
  console.log(
    `[Exception: ${error instanceof Error ? error.message : String(error)}]`,
  );
  process.exit(1);
}

#!/usr/bin/env bun
/**
 * Direct test of task tool invocation.
 * Validates that the task tool is actually being called for complex exploration.
 */

import { runAgent } from "../src/agent";
import { initDatabase, createSession } from "../src/session";

const prompt = "What is the architecture of this project? Give me a comprehensive overview.";
const model = process.env.OLLAMA_MODEL || "gpt-oss:120b-cloud";
const host = process.env.OLLAMA_HOST || "https://ollama.com";

initDatabase();
const session = await createSession({
  projectPath: process.cwd(),
  model,
  host,
  mode: "plan",
});

const toolsCalled: string[] = [];

console.log("=== Task Tool Invocation Test ===");
console.log(`Model: ${model}`);
console.log(`Host: ${host}`);
console.log(`Prompt: "${prompt}"`);
console.log("---\n");

try {
  const result = await runAgent({
    model,
    host,
    userMessage: prompt,
    history: [],
    sessionId: session.id,
    mode: "plan",
    signal: new AbortController().signal,
    onReasoningToken: () => {},
    onToolCall: (tc) => {
      toolsCalled.push(tc.function.name);
      const args = JSON.stringify(tc.function.arguments).slice(0, 150);
      console.log(`[TOOL CALL] ${tc.function.name}: ${args}...`);
    },
    onToolResult: (r) => {
      const preview = r.error ? `ERROR: ${r.error}` : `${r.output.slice(0, 80)}...`;
      console.log(`[TOOL RESULT] ${r.tool}: ${preview}`);
    },
    onStepComplete: (step) => {
      console.log(`--- Step complete (${step.actions.length} tool calls) ---\n`);
    },
  });

  console.log("\n=== RESULTS ===");
  
  if ("type" in result) {
    console.log(`Status: ERROR (${result.type})`);
  } else {
    console.log(`Status: SUCCESS`);
    console.log(`Iterations: ${result.stats.totalIterations}`);
    console.log(`Total tool calls: ${result.stats.totalToolCalls}`);
  }
  
  console.log(`\nTools called: ${toolsCalled.join(", ")}`);
  console.log(`\n✅ Task tool invoked: ${toolsCalled.includes("task")}`);
  
  if (!toolsCalled.includes("task")) {
    console.log("\n⚠️  The agent did NOT use the task tool for this complex exploration.");
    console.log("   This may indicate the prompt guidance needs strengthening.");
  }
} catch (error) {
  console.error("Exception:", error);
  process.exit(1);
}

/**
 * Prompt test runner for evaluating model behavior.
 * 
 * Usage:
 *   bun tests/run-prompt-tests.ts --model granite4:latest --category file_reading
 *   bun tests/run-prompt-tests.ts --model granite4:latest --all
 *   bun tests/run-prompt-tests.ts --model granite4:latest --prompt "Read package.json"
 */

import { runAgent } from "../src/agent";
import prompts from "./prompts.json";

type Category = keyof typeof prompts.categories;

type TestResult = {
  prompt: string;
  category: string;
  success: boolean;
  toolsCalled: string[];
  answerLength: number;
  duration: number;
  error?: string;
  notes: string[];
};

const HOST = process.env.OLLAMA_HOST || "http://192.168.1.221:11434";

async function testPrompt(
  model: string,
  prompt: string,
  category: string,
  timeoutMs: number = 60000
): Promise<TestResult> {
  const startTime = Date.now();
  const toolsCalled: string[] = [];
  const notes: string[] = [];
  
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  
  try {
    const result = await runAgent({
      model,
      host: HOST,
      userMessage: prompt,
      history: [],
      signal: ctrl.signal,
      onReasoningToken: () => {},
      onToolCall: (tc) => {
        toolsCalled.push(tc.function.name);
      },
      onToolResult: (r) => {
        if (r.error) {
          notes.push(`Tool error: ${r.error}`);
        }
      },
      onStepComplete: () => {},
      onToolBlocked: (tool, reason) => {
        notes.push(`Blocked: ${tool} - ${reason}`);
      },
    });
    
    clearTimeout(timeout);
    const duration = Date.now() - startTime;
    
    if ("type" in result) {
      return {
        prompt,
        category,
        success: false,
        toolsCalled,
        answerLength: 0,
        duration,
        error: result.type,
        notes,
      };
    }
    
    // Analyze the response for quality
    const answer = result.finalAnswer;
    
    // Check for lazy responses
    if (/\b(shown above|displayed above|see above)\b/i.test(answer)) {
      notes.push("LAZY: References invisible content");
    }
    
    // Check for code output instead of tool use
    if (/```(?:typescript|javascript)\s*\n.*(?:read_file|list_dir|run_command)/s.test(answer)) {
      notes.push("OUTPUT_CODE: Wrote code instead of using tools");
    }
    
    // Check for refusals
    if (/\b(cannot|can't|unable to|don't have access)\b/i.test(answer) && toolsCalled.length === 0) {
      notes.push("REFUSED: Declined without trying");
    }
    
    return {
      prompt,
      category,
      success: true,
      toolsCalled,
      answerLength: answer.length,
      duration,
      notes,
    };
  } catch (e) {
    clearTimeout(timeout);
    return {
      prompt,
      category,
      success: false,
      toolsCalled,
      answerLength: 0,
      duration: Date.now() - startTime,
      error: e instanceof Error ? e.message : String(e),
      notes,
    };
  }
}

function printResult(result: TestResult) {
  const status = result.success ? "✅" : "❌";
  const tools = result.toolsCalled.length > 0 
    ? `[${result.toolsCalled.join(", ")}]` 
    : "[no tools]";
  
  console.log(`${status} ${result.prompt}`);
  console.log(`   Tools: ${tools} | Answer: ${result.answerLength} chars | Time: ${result.duration}ms`);
  
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
  
  for (const note of result.notes) {
    console.log(`   ⚠️  ${note}`);
  }
  console.log();
}

function printSummary(results: TestResult[]) {
  const total = results.length;
  const successful = results.filter(r => r.success).length;
  const withTools = results.filter(r => r.toolsCalled.length > 0).length;
  const lazy = results.filter(r => r.notes.some(n => n.startsWith("LAZY"))).length;
  const codeOutput = results.filter(r => r.notes.some(n => n.startsWith("OUTPUT_CODE"))).length;
  const refused = results.filter(r => r.notes.some(n => n.startsWith("REFUSED"))).length;
  
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total tests:     ${total}`);
  console.log(`Successful:      ${successful} (${Math.round(successful/total*100)}%)`);
  console.log(`Used tools:      ${withTools} (${Math.round(withTools/total*100)}%)`);
  console.log(`Lazy responses:  ${lazy}`);
  console.log(`Code output:     ${codeOutput}`);
  console.log(`Refused:         ${refused}`);
  console.log();
  
  // Group by category
  const byCategory = new Map<string, TestResult[]>();
  for (const r of results) {
    const arr = byCategory.get(r.category) || [];
    arr.push(r);
    byCategory.set(r.category, arr);
  }
  
  console.log("By Category:");
  for (const [cat, catResults] of byCategory) {
    const catSuccess = catResults.filter(r => r.success && r.notes.length === 0).length;
    console.log(`  ${cat}: ${catSuccess}/${catResults.length}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  let model = "granite4:latest";
  let category: Category | null = null;
  let singlePrompt: string | null = null;
  let runAll = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model" && args[i + 1]) {
      model = args[i + 1]!;
      i++;
    } else if (args[i] === "--category" && args[i + 1]) {
      category = args[i + 1] as Category;
      i++;
    } else if (args[i] === "--prompt" && args[i + 1]) {
      singlePrompt = args[i + 1]!;
      i++;
    } else if (args[i] === "--all") {
      runAll = true;
    }
  }
  
  console.log(`Testing model: ${model}`);
  console.log(`Host: ${HOST}`);
  console.log();
  
  const results: TestResult[] = [];
  
  if (singlePrompt) {
    // Test single prompt
    console.log(`Testing: "${singlePrompt}"\n`);
    const result = await testPrompt(model, singlePrompt, "custom");
    printResult(result);
    results.push(result);
  } else if (category) {
    // Test single category
    const cat = prompts.categories[category];
    if (!cat) {
      console.error(`Unknown category: ${category}`);
      console.log("Available:", Object.keys(prompts.categories).join(", "));
      process.exit(1);
    }
    
    console.log(`Category: ${category} - ${cat.description}\n`);
    
    for (const prompt of cat.prompts) {
      const result = await testPrompt(model, prompt, category);
      printResult(result);
      results.push(result);
    }
  } else if (runAll) {
    // Test all categories
    for (const [catName, cat] of Object.entries(prompts.categories)) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`${catName.toUpperCase()}: ${cat.description}`);
      console.log("=".repeat(60) + "\n");
      
      for (const prompt of cat.prompts) {
        const result = await testPrompt(model, prompt, catName);
        printResult(result);
        results.push(result);
      }
    }
  } else {
    console.log("Usage:");
    console.log("  --model <name>     Model to test (default: granite4:latest)");
    console.log("  --category <name>  Test a specific category");
    console.log("  --prompt <text>    Test a single prompt");
    console.log("  --all              Test all categories");
    console.log();
    console.log("Categories:", Object.keys(prompts.categories).join(", "));
    process.exit(0);
  }
  
  if (results.length > 1) {
    console.log();
    printSummary(results);
  }
}

main().catch(console.error);

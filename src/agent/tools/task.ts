/**
 * Task Tool - Delegates complex exploration tasks to a specialized subagent.
 * 
 * This enables the primary agent to offload complex, multi-step exploration
 * to a focused subagent with its own context window and iteration budget.
 */

import { z } from "zod";
import type { ToolDefinition } from "../types";
import { runAgent } from "../index";
import { buildExplorePrompt, type ThoroughnessLevel } from "../prompts/explore";
import { getDefaultContext } from "../prompts/shared";

// ============================================================================
// Schema Definitions
// ============================================================================

const taskInput = z.object({
  description: z
    .string()
    .min(1)
    .describe("Short 3-5 word description of the task"),
  prompt: z
    .string()
    .min(1)
    .describe("Detailed task description for the subagent"),
  thoroughness: z
    .enum(["quick", "medium", "thorough"])
    .optional()
    .default("medium")
    .describe("How thorough the exploration should be"),
});

const taskOutput = z.object({
  success: z.boolean(),
  output: z.string(),
  filesExplored: z.array(z.string()),
  iterations: z.number(),
});

// ============================================================================
// Iteration Limits by Thoroughness
// ============================================================================

const ITERATION_LIMITS: Record<ThoroughnessLevel, number> = {
  quick: 8,
  medium: 15,
  thorough: 25,
};

// ============================================================================
// Task Tool Definition
// ============================================================================

export const taskTool: ToolDefinition<typeof taskInput, typeof taskOutput> = {
  name: "task",
  description: `Delegate complex exploration or research tasks to a specialized subagent.

The explore subagent is a fast file/code search specialist. Use it for:
- Complex searches across multiple directories
- Open-ended exploration ("what does this codebase do?")
- Finding patterns across many files
- Research that requires multiple search iterations

When to use:
- Questions requiring exploration of 5+ files
- "How does X work?" questions about unfamiliar code
- Finding all usages of a pattern across the codebase
- Understanding project architecture

When NOT to use:
- Reading a specific known file (use read_file)
- Simple grep for a single pattern (use grep)
- Quick directory listing (use list_dir)
- Questions you can answer from files already read

Thoroughness levels:
- quick: 2-3 files, surface overview (8 iterations max)
- medium: 5-10 files, balanced exploration (15 iterations max)
- thorough: comprehensive analysis (25 iterations max)

PARALLEL EXECUTION: You can call multiple task tools in a single response!
When exploring different areas of the codebase, launch tasks in parallel:
- task(prompt="explore agent/") AND task(prompt="explore tui/") together
- task(prompt="find error handling") AND task(prompt="find logging patterns")
The tasks will run concurrently and you'll receive all results together.`,

  parameters: taskInput,
  outputSchema: taskOutput,
  risk: "safe",

  execute: async (params, signal, context) => {
    const { prompt, thoroughness = "medium" } = params;

    // Get model and host from context (passed from parent agent)
    const model = context?.model;
    const host = context?.host;

    if (!model || !host) {
      return {
        success: false,
        output: "Task tool requires model and host in context",
        filesExplored: [],
        iterations: 0,
      };
    }

    // Build the explore subagent prompt
    const ctx = getDefaultContext();
    const systemPromptOverride = buildExplorePrompt(ctx, thoroughness);

    // Track files explored by the subagent
    const filesExplored: string[] = [];

    try {
      const result = await runAgent({
        model,
        host,
        userMessage: prompt,
        history: [],
        mode: "plan", // Always read-only for explore subagent
        
        // Callbacks to track progress
        onReasoningToken: () => {}, // Silent - don't stream to parent
        onToolCall: (call) => {
          // Track file reads
          if (call.function.name === "read_file") {
            const args = call.function.arguments as { path?: string };
            if (args.path) {
              filesExplored.push(args.path);
            }
          }
        },
        onToolResult: () => {},
        onStepComplete: () => {},

        signal: signal ?? new AbortController().signal,

        config: {
          maxIterations: ITERATION_LIMITS[thoroughness],
          loopDetection: true,
          loopThreshold: 2,
        },

        systemPromptOverride,
      });

      // Check for error result
      if ("type" in result) {
        return {
          success: false,
          output: `Subagent error: ${result.type}${
            "message" in result ? ` - ${result.message}` : ""
          }`,
          filesExplored,
          iterations: 0,
        };
      }

      return {
        success: true,
        output: result.finalAnswer,
        filesExplored: [...new Set(filesExplored)], // Dedupe
        iterations: result.stats.totalIterations,
      };
    } catch (error) {
      return {
        success: false,
        output: `Task execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        filesExplored,
        iterations: 0,
      };
    }
  },
};

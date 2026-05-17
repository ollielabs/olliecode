/**
 * Task Tool - Delegates tasks to named subagents via the agent registry.
 *
 * The task tool resolves the target agent from the registry, verifies the
 * calling agent has permission to invoke it, then runs the subagent with
 * its configured tools, prompt, and iteration budget in an isolated context.
 */

import { z } from 'zod';
import { ITERATION_PRESETS } from '../agents/schema';
import type { ResolvedAgent } from '../agents/schema';
import { fromConfig, evaluate } from '../permission/index';
import type { PermissionConfig } from '../permission/types';
import { buildExplorePrompt } from '../prompts/explore';
import { getDefaultContext, getSystemPromptForAgent } from '../prompts';
import type { ToolDefinition } from '../types';

// ============================================================================
// Schema Definitions
// ============================================================================

const MaxIterationsInputSchema = z.union([
  z.number().int().positive(),
  z.enum(['quick', 'medium', 'thorough']),
]);

const taskInput = z.object({
  agent: z
    .string()
    .min(1)
    .describe('Name of the agent to delegate to (e.g. "explore", "reviewer")'),
  description: z
    .string()
    .min(1)
    .describe('Short 3-5 word description of the task'),
  prompt: z
    .string()
    .min(1)
    .describe('Detailed task description for the subagent'),
  maxIterations: MaxIterationsInputSchema.optional().describe(
    'Override iteration budget: number or preset (quick/medium/thorough)',
  ),
});

const taskOutput = z.object({
  success: z.boolean(),
  output: z.string(),
  agent: z.string(),
  filesExplored: z.array(z.string()),
  iterations: z.number(),
});

// ============================================================================
// Constants
// ============================================================================

/** Global cap for subagent iterations (safety net). */
const MAX_SUBAGENT_ITERATIONS = 50;

/** Maximum delegation depth to prevent unbounded recursion. */
export const MAX_DELEGATION_DEPTH = 3;

/** Default iteration budget when no override or agent config exists. */
const DEFAULT_ITERATIONS = ITERATION_PRESETS.medium;

// ============================================================================
// Helpers (exported for testing)
// ============================================================================

/**
 * Resolve the effective maxIterations for a subagent invocation.
 *
 * Priority: task call override -> agent config -> global default.
 * Always capped by MAX_SUBAGENT_ITERATIONS.
 */
export function resolveMaxIterations(
  callOverride: number | 'quick' | 'medium' | 'thorough' | undefined,
  agentConfig: number | 'quick' | 'medium' | 'thorough' | undefined,
): number {
  const raw = callOverride ?? agentConfig;
  let value: number;

  if (raw === undefined) {
    value = DEFAULT_ITERATIONS;
  } else if (typeof raw === 'string') {
    value = ITERATION_PRESETS[raw];
  } else {
    value = raw;
  }

  return Math.min(value, MAX_SUBAGENT_ITERATIONS);
}

/**
 * Check if the calling agent is permitted to invoke a subagent.
 *
 * Evaluates the caller's `task` permission key with the target agent name.
 * No caller permission config = default allow (can invoke any subagent).
 */
function isSubagentAllowed(
  callerPermission: PermissionConfig | undefined,
  targetAgentName: string,
): boolean {
  if (!callerPermission) return true;
  const ruleset = fromConfig(callerPermission);
  const action = evaluate('task', targetAgentName, ruleset);
  return action !== 'deny';
}

/**
 * Build the system prompt for the subagent invocation.
 *
 * Built-in explore agent gets its dedicated prompt builder with thoroughness.
 * Other agents get their systemPrompt via getSystemPromptForAgent().
 */
function buildSubagentPrompt(
  agent: ResolvedAgent,
  maxIterations: number,
  projectRoot?: string,
  configInstructions?: string[],
): string {
  // Built-in explore agent uses its dedicated prompt builder
  if (agent.source.type === 'builtin' && agent.name === 'explore') {
    const ctx = getDefaultContext(projectRoot, configInstructions);
    // Map iteration count to thoroughness level for explore prompt
    const thoroughness =
      maxIterations <= ITERATION_PRESETS.quick
        ? 'quick'
        : maxIterations >= ITERATION_PRESETS.thorough
          ? 'thorough'
          : 'medium';
    return buildExplorePrompt(ctx, thoroughness);
  }

  // All other agents: use getSystemPromptForAgent()
  const ctx = getDefaultContext(projectRoot, configInstructions);
  return getSystemPromptForAgent(agent, ctx);
}

/**
 * Build the dynamic task tool description listing available agents.
 *
 * Called when the registry is available to produce a description that shows
 * the LLM which agents it can delegate to.
 */
export function buildTaskToolDescription(
  availableAgents: ReadonlyArray<{ name: string; description: string }>,
): string {
  const agentList = availableAgents
    .map((a) => `- ${a.name}: ${a.description}`)
    .join('\n');

  return `Delegate tasks to a specialized subagent. You MUST specify which agent to use.

Available agents:
${agentList}

When to use:
- Complex multi-step tasks that benefit from a focused specialist
- Research or exploration requiring many iterations
- Tasks that need a restricted tool set for safety

PARALLEL EXECUTION: You can call multiple task tools in a single response!
Launch parallel tasks for independent work:
- task(agent="explore", prompt="find auth logic") AND task(agent="explore", prompt="find DB schema")

Parameters:
- agent (required): Name of the agent from the list above
- prompt (required): Detailed task description for the subagent
- description (required): Short 3-5 word label
- maxIterations (optional): Override iteration budget (number or "quick"/"medium"/"thorough")`;
}

// ============================================================================
// Task Tool Definition
// ============================================================================

export const taskTool: ToolDefinition<typeof taskInput, typeof taskOutput> = {
  name: 'task',
  description: buildTaskToolDescription([
    {
      name: 'explore',
      description: 'Fast codebase search specialist for targeted exploration',
    },
  ]),

  parameters: taskInput,
  outputSchema: taskOutput,
  risk: 'safe',

  execute: async (params, signal, context) => {
    const {
      agent: agentName,
      prompt,
      maxIterations: callMaxIterations,
    } = params;

    // --- Validate context ---
    const model = context?.model;
    const host = context?.host;
    const parentSafetyConfig = context?.safetyConfig;
    const registry = context?.agentRegistry;
    const runSubagent = context?.runSubagent;

    if (!model || !host || !parentSafetyConfig) {
      return {
        success: false,
        output: 'Task tool requires model, host, and safetyConfig in context',
        agent: agentName,
        filesExplored: [],
        iterations: 0,
      };
    }

    if (!registry) {
      return {
        success: false,
        output: 'Task tool requires agentRegistry in context',
        agent: agentName,
        filesExplored: [],
        iterations: 0,
      };
    }

    if (!runSubagent) {
      return {
        success: false,
        output: 'Task tool requires runSubagent in context',
        agent: agentName,
        filesExplored: [],
        iterations: 0,
      };
    }

    // --- Delegation depth guard ---
    const currentDepth = context?.delegationDepth ?? 0;
    if (currentDepth >= MAX_DELEGATION_DEPTH) {
      return {
        success: false,
        output: `Maximum delegation depth (${MAX_DELEGATION_DEPTH}) exceeded. Cannot nest subagent calls deeper.`,
        agent: agentName,
        filesExplored: [],
        iterations: 0,
      };
    }

    // --- Resolve agent from registry ---
    const targetAgent = registry.get(agentName);

    if (!targetAgent) {
      return {
        success: false,
        output: `Unknown agent: "${agentName}". Use one of the available agents listed in the tool description.`,
        agent: agentName,
        filesExplored: [],
        iterations: 0,
      };
    }

    // Verify agent is available as subagent
    if (targetAgent.mode === 'primary') {
      return {
        success: false,
        output: `Agent "${agentName}" is a primary agent and cannot be invoked as a subagent. Only agents with mode "subagent" or "all" can be delegated to.`,
        agent: agentName,
        filesExplored: [],
        iterations: 0,
      };
    }

    // --- Permission check ---
    if (!isSubagentAllowed(context?.callerPermission, agentName)) {
      return {
        success: false,
        output: `Permission denied: calling agent is not allowed to invoke "${agentName}" via task delegation.`,
        agent: agentName,
        filesExplored: [],
        iterations: 0,
      };
    }

    // --- Resolve iteration budget ---
    const maxIterations = resolveMaxIterations(
      callMaxIterations,
      targetAgent.maxIterations,
    );

    // --- Build system prompt ---
    const systemPromptOverride = buildSubagentPrompt(
      targetAgent,
      maxIterations,
      context?.projectRoot,
      context?.configInstructions,
    );

    // --- Run subagent ---
    const filesExplored: string[] = [];

    try {
      const result = await runSubagent({
        model: targetAgent.model ?? model,
        host,
        userMessage: prompt,
        history: [],
        agent: targetAgent,
        agentRegistry: registry,
        delegationDepth: currentDepth + 1,

        // Silent callbacks — don't stream to parent
        onReasoningToken: () => {},
        onToolCall: (call: {
          function: { name: string; arguments: unknown };
        }) => {
          // Track file reads for reporting
          if (call.function.name === 'read_file') {
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
          maxIterations,
          loopDetection: true,
          loopThreshold: 2,
        },

        temperature: targetAgent.temperature,
        safetyConfig: parentSafetyConfig,
        toolsConfig: context?.toolsConfig,
        configInstructions: context?.configInstructions,
        systemPromptOverride,
      });

      // Check for error result (AgentError has 'type', AgentResult has 'finalAnswer')
      if (!('finalAnswer' in result)) {
        const errorType = 'type' in result ? result.type : 'unknown';
        const errorMessage = 'message' in result ? ` - ${result.message}` : '';
        return {
          success: false,
          output: `Subagent error: ${errorType}${errorMessage}`,
          agent: agentName,
          filesExplored,
          iterations: 0,
        };
      }

      return {
        success: true,
        output: result.finalAnswer,
        agent: agentName,
        filesExplored: [...new Set(filesExplored)],
        iterations: result.stats.totalIterations,
      };
    } catch (error) {
      return {
        success: false,
        output: `Task execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        agent: agentName,
        filesExplored,
        iterations: 0,
      };
    }
  },
};

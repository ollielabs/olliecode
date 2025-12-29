/**
 * Loop detection for agent actions.
 * Detects when the agent is stuck repeating the same action or in a doom loop.
 */

import type { AgentStep } from "./types";

export type LoopDetectionResult = {
  detected: boolean;
  action?: string;
  /** The repeated action signature for diagnostics */
  signature?: string;
};

/**
 * Extended doom loop detection result
 */
export type DoomLoopResult = {
  detected: boolean;
  type: "identical" | "error_pattern" | "oscillating" | "none";
  /** Suggestion for how to break the loop */
  suggestion?: string;
  /** The tool that's stuck */
  tool?: string;
};

/**
 * Creates a unique signature for a tool call action.
 * Used to compare actions across steps.
 */
function getActionSignature(action: { function: { name: string; arguments: unknown } }): string {
  return `${action.function.name}:${JSON.stringify(action.function.arguments)}`;
}

/**
 * Detects if the agent is stuck in a loop by checking for repeated actions.
 * 
 * Compares the last N steps (where N = threshold) to see if they all
 * contain the same first action with identical arguments.
 * 
 * @param steps - Array of completed agent steps
 * @param threshold - Number of consecutive identical steps to trigger detection
 * @returns Detection result with action name if loop found
 */
export function detectLoop(steps: AgentStep[], threshold: number): LoopDetectionResult {
  if (steps.length < threshold) {
    return { detected: false };
  }

  const recentSteps = steps.slice(-threshold);
  const firstAction = recentSteps[0]?.actions[0];

  if (!firstAction) {
    return { detected: false };
  }

  const targetSignature = getActionSignature(firstAction);

  const allSame = recentSteps.every((step) => {
    const action = step.actions[0];
    if (!action) return false;
    return getActionSignature(action) === targetSignature;
  });

  if (allSame) {
    return {
      detected: true,
      action: firstAction.function.name,
      signature: targetSignature,
    };
  }

  return { detected: false };
}

/**
 * Extended loop detection that checks all actions in each step,
 * not just the first one. Useful for detecting more complex loops.
 * 
 * @param steps - Array of completed agent steps
 * @param threshold - Number of consecutive identical steps to trigger detection
 * @returns Detection result with action name if loop found
 */
export function detectLoopExtended(steps: AgentStep[], threshold: number): LoopDetectionResult {
  if (steps.length < threshold) {
    return { detected: false };
  }

  const recentSteps = steps.slice(-threshold);
  
  // Create signature for all actions in first step
  const firstStepActions = recentSteps[0]?.actions ?? [];
  if (firstStepActions.length === 0) {
    return { detected: false };
  }

  const targetSignatures = firstStepActions.map(getActionSignature);
  const targetKey = targetSignatures.join("|");

  const allSame = recentSteps.every((step) => {
    const stepSignatures = step.actions.map(getActionSignature);
    return stepSignatures.join("|") === targetKey;
  });

  if (allSame) {
    return {
      detected: true,
      action: firstStepActions[0]?.function.name,
      signature: targetKey,
    };
  }

  return { detected: false };
}

/**
 * Detects doom loops - patterns where the agent is stuck but not necessarily
 * making identical calls. This catches:
 * 
 * 1. Identical loops - Same exact call repeated (handled by detectLoop)
 * 2. Error patterns - Same tool failing repeatedly with different args
 * 3. Oscillating patterns - Agent alternating between two states (A->B->A->B)
 * 
 * @param steps - Array of completed agent steps
 * @param threshold - Number of steps to analyze (default 4)
 * @returns Doom loop detection result with type and suggestion
 */
export function detectDoomLoop(steps: AgentStep[], threshold: number = 4): DoomLoopResult {
  if (steps.length < threshold) {
    return { detected: false, type: "none" };
  }

  const recent = steps.slice(-threshold);
  
  // Check for identical loops first (existing logic)
  const identicalLoop = detectLoop(steps, threshold);
  if (identicalLoop.detected) {
    return {
      detected: true,
      type: "identical",
      tool: identicalLoop.action,
      suggestion: `Tool "${identicalLoop.action}" called ${threshold} times with identical arguments. Try a different approach or tool.`,
    };
  }

  // Check for error pattern - same tool failing repeatedly
  const toolErrors = new Map<string, number>();
  for (const step of recent) {
    for (const obs of step.observations) {
      if (obs.error) {
        const count = toolErrors.get(obs.tool) ?? 0;
        toolErrors.set(obs.tool, count + 1);
      }
    }
  }

  for (const [tool, errorCount] of toolErrors) {
    if (errorCount >= threshold - 1) {
      return {
        detected: true,
        type: "error_pattern",
        tool,
        suggestion: `Tool "${tool}" has failed ${errorCount} times in the last ${threshold} steps. The approach isn't working - try a different strategy.`,
      };
    }
  }

  // Check for oscillating pattern (A->B->A->B or similar)
  if (recent.length >= 4) {
    const toolSequence = recent.map((s) => s.actions[0]?.function.name ?? "none");
    
    // Check for 2-step oscillation: [A, B, A, B]
    if (
      toolSequence.length >= 4 &&
      toolSequence[0] === toolSequence[2] &&
      toolSequence[1] === toolSequence[3] &&
      toolSequence[0] !== toolSequence[1]
    ) {
      return {
        detected: true,
        type: "oscillating",
        tool: toolSequence[0],
        suggestion: `Agent is oscillating between "${toolSequence[0]}" and "${toolSequence[1]}". This pattern won't make progress - try a different approach.`,
      };
    }
  }

  return { detected: false, type: "none" };
}

/**
 * Check if the agent appears to be making progress.
 * Returns false if the agent seems stuck.
 */
export function isProgressBeingMade(steps: AgentStep[], windowSize: number = 5): boolean {
  if (steps.length < windowSize) {
    return true; // Not enough data
  }

  const recent = steps.slice(-windowSize);
  
  // Check if there's variety in tools being used
  const toolsUsed = new Set<string>();
  for (const step of recent) {
    for (const action of step.actions) {
      toolsUsed.add(action.function.name);
    }
  }
  
  // If only using 1-2 tools in the window, might be stuck
  if (toolsUsed.size <= 1) {
    // Check if results are changing
    const results = recent.map((s) => 
      s.observations.map((o) => o.output.slice(0, 100)).join("|")
    );
    const uniqueResults = new Set(results);
    
    // If same results, definitely stuck
    if (uniqueResults.size === 1) {
      return false;
    }
  }

  // Check for high error rate
  let totalObs = 0;
  let errorObs = 0;
  for (const step of recent) {
    for (const obs of step.observations) {
      totalObs++;
      if (obs.error) errorObs++;
    }
  }
  
  // More than 50% errors is a bad sign
  if (totalObs > 0 && errorObs / totalObs > 0.5) {
    return false;
  }

  return true;
}

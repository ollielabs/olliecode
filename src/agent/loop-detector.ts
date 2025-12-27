/**
 * Loop detection for agent actions.
 * Detects when the agent is stuck repeating the same action.
 */

import type { AgentStep } from "./types";

export type LoopDetectionResult = {
  detected: boolean;
  action?: string;
  /** The repeated action signature for diagnostics */
  signature?: string;
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

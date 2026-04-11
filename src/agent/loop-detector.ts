/**
 * Loop detection for agent actions.
 * Detects when the agent is stuck repeating the same action or in a doom loop.
 */

import type { AgentStep } from './types';

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
  type: 'identical' | 'error_pattern' | 'oscillating' | 'none';
  /** Suggestion for how to break the loop */
  suggestion?: string;
  /** The tool that's stuck */
  tool?: string;
};

/**
 * Creates a unique signature for a tool call action.
 * Used to compare actions across steps.
 *
 * Prefer using pre-computed `step.actionSignatures[i]` when available
 * to avoid redundant JSON.stringify calls in the hot path.
 */
function getActionSignature(action: {
  function: { name: string; arguments: unknown };
}): string {
  return `${action.function.name}:${JSON.stringify(action.function.arguments)}`;
}

/**
 * Get the pre-computed signature for action at index `i` in a step.
 * Falls back to computing it if signatures aren't cached.
 */
function getStepActionSignature(step: AgentStep, actionIndex: number): string {
  return (
    step.actionSignatures[actionIndex] ??
    getActionSignature(step.actions[actionIndex]!)
  );
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
export function detectLoop(
  steps: AgentStep[],
  threshold: number,
): LoopDetectionResult {
  if (steps.length < threshold) {
    return { detected: false };
  }

  const recentSteps = steps.slice(-threshold);
  const firstAction = recentSteps[0]?.actions[0];

  if (!firstAction) {
    return { detected: false };
  }

  const targetSignature = getStepActionSignature(recentSteps[0]!, 0);

  const allSame = recentSteps.every((step) => {
    if (!step.actions[0]) return false;
    return getStepActionSignature(step, 0) === targetSignature;
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
export function detectLoopExtended(
  steps: AgentStep[],
  threshold: number,
): LoopDetectionResult {
  if (steps.length < threshold) {
    return { detected: false };
  }

  const recentSteps = steps.slice(-threshold);

  // Create signature for all actions in first step
  const firstStepActions = recentSteps[0]?.actions ?? [];
  if (firstStepActions.length === 0) {
    return { detected: false };
  }

  const targetKey = (
    recentSteps[0]!.actionSignatures.length > 0
      ? recentSteps[0]!.actionSignatures
      : firstStepActions.map(getActionSignature)
  ).join('|');

  const allSame = recentSteps.every((step) => {
    const sigs =
      step.actionSignatures.length > 0
        ? step.actionSignatures
        : step.actions.map(getActionSignature);
    return sigs.join('|') === targetKey;
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
export function detectDoomLoop(
  steps: AgentStep[],
  threshold: number = 4,
): DoomLoopResult {
  if (steps.length < threshold) {
    return { detected: false, type: 'none' };
  }

  const recent = steps.slice(-threshold);

  // Check for identical loops first (existing logic)
  const identicalLoop = detectLoop(steps, threshold);
  if (identicalLoop.detected) {
    return {
      detected: true,
      type: 'identical',
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
        type: 'error_pattern',
        tool,
        suggestion: `Tool "${tool}" has failed ${errorCount} times in the last ${threshold} steps. The approach isn't working - try a different strategy.`,
      };
    }
  }

  // Check for oscillating pattern (A->B->A->B or similar)
  // Only flag as a loop if the arguments are also repeating, meaning the agent
  // is truly stuck rather than making a series of productive edit→read→edit calls.
  const searchTools = new Set(['grep', 'glob', 'read_file', 'list_dir']);
  if (recent.length >= 4) {
    const toolSequence = recent.map(
      (s) => s.actions[0]?.function.name ?? 'none',
    );

    // Check for 2-step oscillation: [A, B, A, B]
    if (
      toolSequence.length >= 4 &&
      toolSequence[0] === toolSequence[2] &&
      toolSequence[1] === toolSequence[3] &&
      toolSequence[0] !== toolSequence[1]
    ) {
      // Don't flag oscillation between search tools - that's normal exploration
      const isSearchOscillation =
        searchTools.has(toolSequence[0] ?? '') &&
        searchTools.has(toolSequence[1] ?? '');

      if (!isSearchOscillation) {
        // Check if arguments are actually repeating — if the agent is calling
        // the same tools with different arguments, it's making progress
        const sigA0 = getStepActionSignature(recent[0]!, 0);
        const sigA1 = getStepActionSignature(recent[2]!, 0);
        const sigB0 = getStepActionSignature(recent[1]!, 0);
        const sigB1 = getStepActionSignature(recent[3]!, 0);

        const argsRepeating = sigA0 === sigA1 && sigB0 === sigB1;

        if (argsRepeating) {
          return {
            detected: true,
            type: 'oscillating',
            tool: toolSequence[0],
            suggestion: `Agent is oscillating between "${toolSequence[0]}" and "${toolSequence[1]}" with identical arguments. This pattern won't make progress - try a different approach.`,
          };
        }
      }
    }
  }

  return { detected: false, type: 'none' };
}

/**
 * Detects truly consecutive identical tool calls.
 *
 * Unlike detectLoop() which checks if steps have the same first action,
 * this flattens all tool calls and only triggers when the EXACT same
 * tool+args appears N times in a row without ANY different tool in between.
 *
 * This allows patterns like:
 *   read_file(A) → edit_file(A) → read_file(A)  ← OK (different tool between)
 *
 * But catches:
 *   read_file(A) → read_file(A) → read_file(A)  ← LOOP (truly consecutive)
 *
 * @param steps - Array of completed agent steps
 * @param threshold - Number of consecutive identical calls to trigger detection
 * @returns Detection result with action name if loop found
 */
export function detectConsecutiveLoop(
  steps: AgentStep[],
  threshold: number,
): LoopDetectionResult {
  // Flatten all pre-computed signatures across all steps into a single sequence
  const allSigs: Array<{ sig: string; name: string }> = [];
  for (const step of steps) {
    for (let i = 0; i < step.actions.length; i++) {
      allSigs.push({
        sig: getStepActionSignature(step, i),
        name: step.actions[i]!.function.name,
      });
    }
  }

  if (allSigs.length < threshold) {
    return { detected: false };
  }

  // Check for consecutive identical calls
  let consecutiveCount = 1;
  let currentSignature = allSigs[0]?.sig ?? '';

  for (let i = 1; i < allSigs.length; i++) {
    const entry = allSigs[i]!;

    if (entry.sig === currentSignature) {
      consecutiveCount++;
      if (consecutiveCount >= threshold) {
        return {
          detected: true,
          action: entry.name,
          signature: entry.sig,
        };
      }
    } else {
      consecutiveCount = 1;
      currentSignature = entry.sig;
    }
  }

  return { detected: false };
}

/**
 * Result of not-found pattern detection
 */
export type NotFoundResult = {
  detected: boolean;
  /** The search term or pattern that wasn't found */
  searchTerm?: string;
  /** The tool(s) that returned empty results */
  tools?: string[];
  /** Suggestion for what to do */
  suggestion?: string;
};

/**
 * Detects when the agent is searching for something that doesn't exist.
 *
 * Triggers when search tools (grep, glob) return empty results or errors
 * repeatedly, suggesting the item being searched for doesn't exist.
 *
 * @param steps - Array of completed agent steps
 * @param threshold - Number of failed searches to trigger detection (default 3)
 * @returns Detection result with search info if pattern found
 */
export function detectNotFoundPattern(
  steps: AgentStep[],
  threshold: number = 3,
): NotFoundResult {
  if (steps.length < 2) {
    return { detected: false };
  }

  // Track search tool results
  const searchTools = ['grep', 'glob', 'read_file'];
  const emptySearches: Array<{ tool: string; args: unknown }> = [];
  const recentSteps = steps.slice(-Math.max(threshold + 2, 5));

  for (const step of recentSteps) {
    for (let i = 0; i < step.actions.length; i++) {
      const action = step.actions[i];
      const observation = step.observations[i];

      if (!action || !observation) continue;

      const toolName = action.function.name;
      if (!searchTools.includes(toolName)) continue;

      // Check if search returned empty or error
      const isEmptyOrError =
        observation.error !== undefined ||
        observation.output === '' ||
        observation.output === '[]' ||
        observation.output.includes('No matches found') ||
        observation.output.includes('no matches') ||
        observation.output.includes('0 matches') ||
        (toolName === 'read_file' &&
          (observation.output.includes('ENOENT') ||
            observation.output.includes('no such file') ||
            observation.output.includes('does not exist')));

      if (isEmptyOrError) {
        emptySearches.push({ tool: toolName, args: action.function.arguments });
      }
    }
  }

  if (emptySearches.length >= threshold) {
    // Try to extract what was being searched for
    const searchTerms = new Set<string>();
    const tools = new Set<string>();

    for (const search of emptySearches) {
      tools.add(search.tool);
      const args = search.args as Record<string, unknown>;
      if (args.pattern) searchTerms.add(String(args.pattern));
      if (args.path) searchTerms.add(String(args.path));
    }

    const searchTerm = [...searchTerms].join(', ') || 'unknown';

    return {
      detected: true,
      searchTerm,
      tools: [...tools],
      suggestion: `Searches for "${searchTerm}" have returned empty ${emptySearches.length} times. The item likely doesn't exist in this codebase.`,
    };
  }

  return { detected: false };
}

/**
 * Check if the agent appears to be making progress.
 * Returns false if the agent seems stuck.
 */
export function isProgressBeingMade(
  steps: AgentStep[],
  windowSize: number = 5,
): boolean {
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
      s.observations.map((o) => o.output.slice(0, 100)).join('|'),
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

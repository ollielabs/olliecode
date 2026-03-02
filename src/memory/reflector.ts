/**
 * Reflector agent for Observational Memory.
 *
 * The Reflector condenses observations when they grow too large.
 * It's the "memory consolidation" layer — compressing older observations
 * more aggressively while retaining recent detail.
 *
 * Key design: compression escalation (levels 0-3). If the first attempt
 * doesn't compress enough, retry with progressively stronger compression
 * guidance. Max 4 attempts.
 *
 * Follows Mastra's pattern: the Reflector's system prompt embeds the
 * Observer's instructions so it understands the format and conventions.
 */

import { Ollama } from 'ollama';

import { log } from '../agent/logger';
import {
  detectDegenerateRepetition,
  extractListItems,
  extractTag,
  getObserverSystemPrompt,
} from './observer';
import { countTextTokens } from './token-counter';
import type { ReflectorResult } from './types';

// ============================================================================
// Compression escalation levels
// ============================================================================

type CompressionLevel = {
  level: number;
  guidance: string;
  detailTarget: string;
};

const COMPRESSION_LEVELS: CompressionLevel[] = [
  {
    level: 0,
    guidance: '',
    detailTarget: 'full detail',
  },
  {
    level: 1,
    guidance:
      'COMPRESSION REQUIRED: The previous reflection was too long. Aim for 8/10 detail. Combine related items, remove redundant sub-bullets, condense older observations.',
    detailTarget: '8/10 detail',
  },
  {
    level: 2,
    guidance:
      'AGGRESSIVE COMPRESSION REQUIRED: The previous reflection was still too long. Aim for 6/10 detail. Merge related topics into summary bullets, drop LOW priority items older than today, condense tool call sequences into single lines.',
    detailTarget: '6/10 detail',
  },
  {
    level: 3,
    guidance:
      'CRITICAL COMPRESSION REQUIRED: The previous reflection was far too long. Aim for 4/10 detail. Summarize the oldest 50-70% of observations into brief paragraphs. Keep only HIGH priority items at full detail. Recent observations (last hour) get moderate detail.',
    detailTarget: '4/10 detail',
  },
];

const MAX_COMPRESSION_ATTEMPTS = COMPRESSION_LEVELS.length;

// ============================================================================
// Reflector system prompt
// ============================================================================

/**
 * Build the Reflector system prompt.
 *
 * Embeds the Observer's instructions so the Reflector understands the
 * format conventions used to create the observations it's condensing.
 */
export function getReflectorSystemPrompt(): string {
  const observerInstructions = getObserverSystemPrompt();

  return `You are the memory consolidation layer of Ollie, an AI coding assistant. Your reflections will be the ONLY information Ollie has about past interactions in this coding session.

The following instructions were given to the observation extractor (the observer) to create these observations. Use this to understand how the observations were created.

<observational-memory-instruction>
${observerInstructions}
</observational-memory-instruction>

You are another part of the same system — the observation reflector.
Your purpose is to reflect on all observations, reorganize and streamline them, and draw connections between what has been learned, done, and decided.

You are the broader context keeper. The observer may get lost in details or side quests. Think hard about what the observed goal is, whether work got off track, and how to get back on track. If on track, note that.

Take the existing observations and rewrite them to make it easier to continue into the future with this knowledge.

IMPORTANT: your reflections are THE ENTIRETY of Ollie's memory. Any information you do not include in your reflections will be immediately forgotten. Do not leave anything out. Your reflections must assume the agent knows nothing — your reflections ARE the entire memory system.

When consolidating observations:
- Preserve dates/times when present (temporal context is critical)
- Retain the most relevant timestamps (start times, completion times, significant events)
- Combine related items where it makes sense (e.g., "agent read 5 files in auth module")
- Condense older observations more aggressively, retain more detail for recent ones
- Group related decisions and their rationale together
- Preserve specific error messages, file paths with line numbers, and test results
- Keep user assertions and goals at full detail regardless of age

CRITICAL: USER ASSERTIONS vs QUESTIONS
- "User stated: X" = authoritative assertion (user told us something about themselves/their goals)
- "User asked: X" = question/request (user seeking information)
When consolidating, USER ASSERTIONS TAKE PRECEDENCE. Never drop them.

Output your reflections using the same format as the observer:
- Same priority levels (HIGH, MED, LOW)
- Same date grouping with 24-hour timestamps
- Same <observations>, <current-task>, <suggested-response> XML tags`;
}

// ============================================================================
// Reflector prompt builder
// ============================================================================

/**
 * Build the prompt for the Reflector.
 *
 * @param observations - Current observation text to condense
 * @param compressionLevel - Escalation level (0-3)
 * @param targetTokens - Target token count for the output
 */
export function buildReflectorPrompt(
  observations: string,
  compressionLevel: number,
  targetTokens?: number,
): string {
  const level =
    COMPRESSION_LEVELS[
      Math.min(compressionLevel, COMPRESSION_LEVELS.length - 1)
    ];

  let prompt = `## Observations to Reflect On\n\n${observations}\n\n---\n\n`;
  prompt += '## Your Task\n\n';
  prompt +=
    'Rewrite these observations into a condensed, well-organized reflection. ';
  prompt +=
    'Preserve all important information but eliminate redundancy and verbosity.\n\n';

  if (level?.guidance) {
    prompt += `**${level.guidance}**\n\n`;
  }

  if (targetTokens) {
    prompt += `Target output size: approximately ${targetTokens} tokens.\n\n`;
  }

  prompt +=
    'Output your reflections using the exact XML tag format: <observations>, <current-task>, <suggested-response>.';

  return prompt;
}

// ============================================================================
// Output parser (reuses Observer's parsing logic)
// ============================================================================

/**
 * Parse the Reflector's output. Same format as Observer output.
 */
export function parseReflectorOutput(output: string): ReflectorResult {
  // Check for degenerate repetition
  if (detectDegenerateRepetition(output)) {
    return {
      observations: '',
      rawOutput: output,
      degenerate: true,
    };
  }

  // Parse XML tags (same logic as observer)
  const observations = extractTag(output, 'observations');
  const currentTask = extractTag(output, 'current-task');
  const suggestedResponse = extractTag(output, 'suggested-response');

  // Fallback: if no <observations> tag, try to extract list items
  const finalObservations = observations || extractListItems(output);

  return {
    observations: finalObservations,
    currentTask: currentTask || undefined,
    suggestedResponse: suggestedResponse || undefined,
    rawOutput: output,
  };
}

// ============================================================================
// Reflector runner with compression escalation
// ============================================================================

/**
 * Run the Reflector with compression escalation.
 *
 * Attempts up to MAX_COMPRESSION_ATTEMPTS times, increasing compression
 * guidance each time if the output exceeds the target token count.
 *
 * @param observations - Current observation text to condense
 * @param model - LLM model to use
 * @param host - Ollama host
 * @param temperature - LLM temperature (default: 0 for deterministic output)
 * @param targetTokenRatio - Target output as fraction of input tokens (default: 0.5)
 * @returns Reflector result, or null if all attempts fail
 */
export async function runReflector(
  observations: string,
  model: string,
  host: string,
  temperature = 0,
  targetTokenRatio = 0.5,
): Promise<ReflectorResult | null> {
  const inputTokens = countTextTokens(observations);
  const targetTokens = Math.floor(inputTokens * targetTokenRatio);
  const client = new Ollama({ host });
  const systemPrompt = getReflectorSystemPrompt();

  log(
    `[OM] Running reflector: ${inputTokens} input tokens, target ${targetTokens} tokens`,
  );

  for (let attempt = 0; attempt < MAX_COMPRESSION_ATTEMPTS; attempt++) {
    const prompt = buildReflectorPrompt(observations, attempt, targetTokens);

    try {
      const response = await client.chat({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: {
          temperature: temperature + attempt * 0.05,
        },
      });

      const parsed = parseReflectorOutput(response.message.content);

      if (parsed.degenerate) {
        log(
          `[OM] Reflector produced degenerate output at level ${attempt}, retrying...`,
        );
        continue;
      }

      if (!parsed.observations) {
        log(
          `[OM] Reflector produced empty observations at level ${attempt}, retrying...`,
        );
        continue;
      }

      const outputTokens = countTextTokens(parsed.observations);
      const compressionRatio = outputTokens / inputTokens;

      log(
        `[OM] Reflector level ${attempt}: ${outputTokens} tokens (${Math.round(compressionRatio * 100)}% of input)`,
      );

      // Accept if output is smaller than input (any compression is good)
      // At higher levels, we're more lenient because the model is trying harder
      if (outputTokens < inputTokens) {
        log(
          `[OM] Reflector succeeded at level ${attempt}: ${inputTokens} -> ${outputTokens} tokens`,
        );
        return parsed;
      }

      // Output is >= input — escalate compression
      log(
        `[OM] Reflector output too large at level ${attempt} (${outputTokens} >= ${inputTokens}), escalating...`,
      );
    } catch (error) {
      log(`[OM] Reflector error at level ${attempt}:`, error);
      // Don't retry on network errors — they won't resolve with escalation
      return null;
    }
  }

  log('[OM] Reflector failed after all compression levels');
  return null;
}

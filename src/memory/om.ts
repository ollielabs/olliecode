/**
 * Observational Memory orchestrator.
 *
 * Core logic for the Observer/Reflector system. Manages the lifecycle:
 * 1. Track unobserved message tokens
 * 2. Trigger observation when threshold is exceeded
 * 3. Call the Observer LLM to extract observations
 * 4. Store observations and update the record
 * 5. Build the observation block for the Actor's context
 * 6. Filter observed messages from the Actor's context
 *
 * Phase 1: Sync-only observation (blocking when threshold is hit).
 * Phase 3 will add async buffering for instant activation.
 */

import type { Message } from 'ollama';
import { Ollama } from 'ollama';

import { log } from '../agent/logger';
import {
  buildObserverPrompt,
  getObserverSystemPrompt,
  optimizeObservationsForContext,
  parseObserverOutput,
} from './observer';
import { runReflector } from './reflector';
import {
  getOrCreateOMRecord,
  setObservingFlag,
  setReflectingFlag,
  updateAfterObservation,
  updateAfterReflection,
  updatePendingTokens,
} from './store';
import { countMessagesTokens, countTextTokens } from './token-counter';
import {
  DEFAULT_MEMORY_CONFIG,
  formatMessagesForObserver,
  type MemoryConfig,
  type ObservationalMemoryRecord,
} from './types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Continuation hint injected as a system message when observations exist.
 * Tells the Actor to continue from observations rather than expecting full history.
 */
const CONTINUATION_HINT = `The conversation history was compressed into the observations above. Continue from where the observations left off. Do not mention your "observations" or "memory" directly to the user — just continue the conversation naturally.`;

/**
 * Preamble for the observation block injected into the Actor's context.
 */
const OBSERVATION_CONTEXT_PREAMBLE = `The following observations are your memory of this coding session. They contain key facts, decisions, file modifications, and current progress. Reference specific details from observations when relevant.`;

// ============================================================================
// Core orchestrator
// ============================================================================

/**
 * Check if observation should be triggered based on message token count.
 * Returns true if unobserved messages exceed the threshold.
 */
export function shouldObserve(
  unobservedTokens: number,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): boolean {
  return unobservedTokens >= config.observation.messageTokens;
}

/**
 * Check if reflection should be triggered based on observation token count.
 * Returns true if observations exceed the reflection threshold.
 */
export function shouldReflect(
  observationTokenCount: number,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): boolean {
  return observationTokenCount >= config.reflection.observationTokens;
}

/**
 * Get unobserved messages — messages that haven't been observed yet.
 * Uses the lastObservedAt timestamp and observedMessageIds as filters.
 *
 * Since Ollama messages don't have IDs or timestamps, we track the
 * observation boundary by message count: all messages in `allMessages`
 * after the last observed count are unobserved.
 */
export function getUnobservedMessages(
  allMessages: Message[],
  record: ObservationalMemoryRecord,
): Message[] {
  // If nothing has been observed yet, all messages are unobserved
  if (!record.lastObservedAt && record.observedMessageIds.length === 0) {
    return allMessages;
  }

  // Use observedMessageIds count as the boundary.
  // Since Ollama messages don't have IDs, we track by position:
  // the record's observedMessageIds length tells us how many messages
  // from the start have been observed.
  const observedCount = record.observedMessageIds.length;
  return allMessages.slice(observedCount);
}

/**
 * Run synchronous observation. Calls the Observer LLM to extract
 * observations from unobserved messages.
 *
 * This is the blocking path — the agent pauses while the Observer runs.
 * Phase 3 will add async buffering to avoid this pause.
 */
export async function runSyncObservation(
  sessionId: string,
  allMessages: Message[],
  model: string,
  host: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): Promise<{
  success: boolean;
  record: ObservationalMemoryRecord;
  observedCount: number;
}> {
  const record = getOrCreateOMRecord(sessionId);

  // Get unobserved messages
  const unobserved = getUnobservedMessages(allMessages, record);
  if (unobserved.length === 0) {
    return { success: true, record, observedCount: 0 };
  }

  // Set observing flag
  setObservingFlag(sessionId, true);

  try {
    // Format messages for the Observer
    const formattedMessages = formatMessagesForObserver(unobserved);

    // Build the Observer prompt
    const prompt = buildObserverPrompt(
      record.activeObservations || undefined,
      formattedMessages,
    );

    log(
      `[OM] Running sync observation: ${unobserved.length} messages, ${formattedMessages.length} chars`,
    );

    // Call the Observer LLM
    const client = new Ollama({ host });
    const response = await client.chat({
      model,
      messages: [
        { role: 'system', content: getObserverSystemPrompt() },
        { role: 'user', content: prompt },
      ],
      stream: false,
      options: {
        temperature: config.observation.temperature,
      },
    });

    // Parse the Observer's output
    let parsed = parseObserverOutput(response.message.content);

    // Retry once if degenerate
    if (parsed.degenerate) {
      log('[OM] Observer produced degenerate output, retrying...');
      const retryResponse = await client.chat({
        model,
        messages: [
          { role: 'system', content: getObserverSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: {
          temperature: config.observation.temperature + 0.1,
        },
      });
      parsed = parseObserverOutput(retryResponse.message.content);

      if (parsed.degenerate) {
        log('[OM] Observer produced degenerate output after retry, aborting');
        setObservingFlag(sessionId, false);
        return { success: false, record, observedCount: 0 };
      }
    }

    if (!parsed.observations) {
      log('[OM] Observer produced empty observations');
      setObservingFlag(sessionId, false);
      return { success: false, record, observedCount: 0 };
    }

    // Append new observations to existing
    const newObservations = record.activeObservations
      ? `${record.activeObservations}\n\n${parsed.observations}`
      : parsed.observations;

    const observationTokenCount = countTextTokens(newObservations);

    // Build updated observedMessageIds — we track by index position.
    // All messages up to (currentObservedCount + unobserved.length) are now observed.
    const totalObservedCount =
      record.observedMessageIds.length + unobserved.length;
    const newObservedMessageIds = Array.from(
      { length: totalObservedCount },
      (_, i) => String(i),
    );

    // Calculate token stats
    const unobservedTokens = countMessagesTokens(unobserved);

    // Update the record
    updateAfterObservation(sessionId, {
      activeObservations: newObservations,
      observationTokenCount,
      lastObservedAt: Date.now(),
      observedMessageIds: newObservedMessageIds,
      pendingMessageTokens: 0,
      totalTokensObserved: record.totalTokensObserved + unobservedTokens,
      currentTask: parsed.currentTask ?? record.currentTask,
      suggestedResponse: parsed.suggestedResponse ?? record.suggestedResponse,
    });

    log(
      `[OM] Observation complete: ${parsed.observations.length} chars, ${observationTokenCount} tokens`,
    );

    const updatedRecord = getOrCreateOMRecord(sessionId);
    return {
      success: true,
      record: updatedRecord,
      observedCount: unobserved.length,
    };
  } catch (error) {
    log('[OM] Observation failed:', error);
    setObservingFlag(sessionId, false);
    return { success: false, record, observedCount: 0 };
  }
}

/**
 * Run synchronous reflection. Calls the Reflector LLM to condense
 * observations when they grow too large.
 *
 * Uses compression escalation: if the first attempt doesn't compress
 * enough, the Reflector retries with progressively stronger guidance.
 */
export async function runSyncReflection(
  sessionId: string,
  model: string,
  host: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): Promise<{
  success: boolean;
  record: ObservationalMemoryRecord;
}> {
  const record = getOrCreateOMRecord(sessionId);

  if (!record.activeObservations) {
    return { success: false, record };
  }

  // Don't reflect if already reflecting
  if (record.isReflecting) {
    log('[OM] Reflection already in progress, skipping');
    return { success: false, record };
  }

  setReflectingFlag(sessionId, true);

  try {
    log(
      `[OM] Running sync reflection: ${record.observationTokenCount} observation tokens, generation ${record.generationCount}`,
    );

    const result = await runReflector(
      record.activeObservations,
      model,
      host,
      config.reflection.temperature,
    );

    if (!result || !result.observations) {
      log('[OM] Reflection produced no output');
      setReflectingFlag(sessionId, false);
      return { success: false, record };
    }

    const newTokenCount = countTextTokens(result.observations);

    log(
      `[OM] Reflection complete: ${record.observationTokenCount} -> ${newTokenCount} tokens (gen ${record.generationCount + 1})`,
    );

    updateAfterReflection(sessionId, {
      activeObservations: result.observations,
      observationTokenCount: newTokenCount,
      currentTask: result.currentTask ?? record.currentTask,
      suggestedResponse: result.suggestedResponse ?? record.suggestedResponse,
    });

    const updatedRecord = getOrCreateOMRecord(sessionId);
    return { success: true, record: updatedRecord };
  } catch (error) {
    log('[OM] Reflection failed:', error);
    setReflectingFlag(sessionId, false);
    return { success: false, record };
  }
}

/**
 * Build the observation block for the Actor's context window.
 *
 * Returns a formatted string containing:
 * - Preamble explaining what observations are
 * - The observation content (optimized for the Actor)
 * - Current task and suggested response (if available)
 *
 * Returns null if no observations exist.
 */
export function buildObservationContextBlock(
  record: ObservationalMemoryRecord,
): string | null {
  if (!record.activeObservations) return null;

  const optimized = optimizeObservationsForContext(record.activeObservations);
  if (!optimized) return null;

  let block = `${OBSERVATION_CONTEXT_PREAMBLE}\n\n<observations>\n${optimized}\n</observations>`;

  if (record.currentTask) {
    block += `\n\n<current-task>\n${record.currentTask}\n</current-task>`;
  }

  if (record.suggestedResponse) {
    block += `\n\n<suggested-response>\n${record.suggestedResponse}\n</suggested-response>`;
  }

  return block;
}

/**
 * Get the continuation hint message.
 * Injected as a system message when observations exist.
 */
export function getContinuationHint(): string {
  return CONTINUATION_HINT;
}

/**
 * Process a step in the agent loop: check if observation is needed,
 * run it if so, check if reflection is needed, and return the updated context.
 *
 * This is the main entry point called from the agent loop on each iteration.
 *
 * Pipeline:
 * 1. Check unobserved message tokens -> run Observer if threshold exceeded
 * 2. Check observation token count -> run Reflector if threshold exceeded
 * 3. Build observation block and continuation hint for the Actor
 * 4. Filter messages to only include unobserved ones
 *
 * Returns:
 * - observationBlock: string to inject into system context (or null)
 * - continuationHint: string to inject as system message (or null)
 * - filteredMessages: messages with observed ones removed
 * - didObserve: whether observation ran this step
 * - didReflect: whether reflection ran this step
 */
export async function processOMStep(
  sessionId: string,
  allMessages: Message[],
  model: string,
  host: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): Promise<{
  observationBlock: string | null;
  continuationHint: string | null;
  filteredMessages: Message[];
  didObserve: boolean;
  didReflect: boolean;
}> {
  const record = getOrCreateOMRecord(sessionId);

  // Get unobserved messages
  const unobserved = getUnobservedMessages(allMessages, record);
  const unobservedTokens = countMessagesTokens(unobserved);

  // Update pending token count
  updatePendingTokens(sessionId, unobservedTokens);

  // Check if observation is needed
  let didObserve = false;
  let didReflect = false;
  let currentRecord = record;

  if (shouldObserve(unobservedTokens, config)) {
    log(
      `[OM] Threshold exceeded: ${unobservedTokens} tokens > ${config.observation.messageTokens}`,
    );

    const result = await runSyncObservation(
      sessionId,
      allMessages,
      model,
      host,
      config,
    );

    didObserve = result.success;
    currentRecord = result.record;
  }

  // Check if reflection is needed (observations too large)
  if (
    currentRecord.activeObservations &&
    shouldReflect(currentRecord.observationTokenCount, config)
  ) {
    log(
      `[OM] Reflection threshold exceeded: ${currentRecord.observationTokenCount} tokens > ${config.reflection.observationTokens}`,
    );

    const reflectResult = await runSyncReflection(
      sessionId,
      model,
      host,
      config,
    );

    if (reflectResult.success) {
      didReflect = true;
      currentRecord = reflectResult.record;
    }
  }

  // Build context for the Actor
  const observationBlock = buildObservationContextBlock(currentRecord);
  const continuationHint = observationBlock ? getContinuationHint() : null;

  // Build filtered messages — only unobserved messages go to the Actor
  const filteredMessages = getUnobservedMessages(allMessages, currentRecord);

  return {
    observationBlock,
    continuationHint,
    filteredMessages,
    didObserve,
    didReflect,
  };
}

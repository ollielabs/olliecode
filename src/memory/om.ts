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
  getLatestChunkMetadata,
  mergeChunkObservations,
  needsSyncFallback,
  recordBufferingTrigger,
  registerBufferingOp,
  resetSessionBoundary,
  resolveBlockAfter,
  selectChunksForActivation,
  shouldTriggerAsyncBuffering,
  waitForBuffering,
} from './buffering';
import {
  buildObserverPrompt,
  getObserverSystemPrompt,
  optimizeObservationsForContext,
  parseObserverOutput,
} from './observer';
import { runReflector } from './reflector';
import {
  addBufferedChunk,
  getOrCreateOMRecord,
  setBufferingObservationFlag,
  setObservingFlag,
  setReflectingFlag,
  updateAfterActivation,
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
 *
 * Uses `observedUpTo` as a slice boundary: the number of Ollama messages
 * from the start of history that have already been observed.
 *
 * The Ollama message array can grow between processOMStep calls (as tool
 * calls complete and results are added), so we clamp the boundary to never
 * exceed the current array length.
 */
export function getUnobservedMessages(
  allMessages: Message[],
  record: ObservationalMemoryRecord,
): Message[] {
  if (record.observedUpTo <= 0) {
    return allMessages;
  }

  // Clamp to array length — if the array shrank (e.g., session change),
  // don't return an empty array
  const boundary = Math.min(record.observedUpTo, allMessages.length);
  return allMessages.slice(boundary);
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

    // All messages passed to this function are now observed.
    // observedUpTo = total Ollama message count at observation time.
    const newObservedUpTo = allMessages.length;

    // Calculate token stats
    const unobservedTokens = countMessagesTokens(unobserved);

    // Update the record
    updateAfterObservation(sessionId, {
      activeObservations: newObservations,
      observationTokenCount,
      lastObservedAt: Date.now(),
      observedUpTo: newObservedUpTo,
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
 * Fire an async buffering Observer call (non-blocking).
 * Produces a BufferedObservationChunk and stores it on the record.
 */
export function fireAsyncBuffering(
  sessionId: string,
  allMessages: Message[],
  record: ObservationalMemoryRecord,
  model: string,
  host: string,
  config: MemoryConfig,
  unobservedTokens: number,
): void {
  const unobserved = getUnobservedMessages(allMessages, record);
  if (unobserved.length === 0) return;

  recordBufferingTrigger(sessionId, unobservedTokens);
  setBufferingObservationFlag(sessionId, true);

  const op = (async () => {
    try {
      const formattedMessages = formatMessagesForObserver(unobserved);
      const prompt = buildObserverPrompt(
        record.activeObservations || undefined,
        formattedMessages,
      );

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

      const parsed = parseObserverOutput(response.message.content);

      if (parsed.degenerate || !parsed.observations) {
        log('[OM] Async buffering produced empty/degenerate output');
        setBufferingObservationFlag(sessionId, false);
        return;
      }

      // Build chunk — messageIds are the position indices of the unobserved messages
      const messageIds = Array.from({ length: unobserved.length }, (_, i) =>
        String(record.observedUpTo + i),
      );

      const chunk = {
        cycleId: crypto.randomUUID(),
        observations: parsed.observations,
        tokenCount: countTextTokens(parsed.observations),
        messageIds,
        messageTokens: countMessagesTokens(unobserved),
        lastObservedAt: Date.now(),
        currentTask: parsed.currentTask,
        suggestedResponse: parsed.suggestedResponse,
      };

      addBufferedChunk(sessionId, chunk);

      log(
        `[OM] Async buffering complete: chunk ${chunk.cycleId}, ${chunk.tokenCount} tokens`,
      );
    } catch (error) {
      log('[OM] Async buffering failed:', error);
      setBufferingObservationFlag(sessionId, false);
    }
  })();

  registerBufferingOp(sessionId, op);
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
 * Process a step in the agent loop using the three-zone threshold system.
 *
 * This is the main entry point called from the submit hook before each
 * agent invocation.
 *
 * Three-zone pipeline:
 * 1. Zone 1 (below messageTokens): fire async buffering at intervals
 * 2. Zone 2 (messageTokens → blockAfter): activate buffered chunks
 * 3. Zone 3 (above blockAfter): synchronous blocking observation
 * 4. After observation/activation: check if reflection is needed
 * 5. Build observation block and continuation hint for the Actor
 * 6. Filter messages to only include unobserved ones
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
  let currentRecord = getOrCreateOMRecord(sessionId);

  // Get unobserved messages and token count
  const unobserved = getUnobservedMessages(allMessages, currentRecord);
  const unobservedTokens = countMessagesTokens(unobserved);

  // Update pending token count
  updatePendingTokens(sessionId, unobservedTokens);

  let didObserve = false;
  let didReflect = false;

  const blockAfterTokens = resolveBlockAfter(config);

  // === Zone 3: above blockAfter — synchronous blocking (last resort) ===
  if (needsSyncFallback(unobservedTokens, currentRecord, config)) {
    log(
      `[OM] Zone 3: sync fallback — ${unobservedTokens} tokens > blockAfter ${blockAfterTokens}, no buffered chunks`,
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

    // Reset buffering boundary so intervals start fresh after sync observation
    if (result.success) {
      resetSessionBoundary(sessionId);
    }
  }
  // === Zone 2: at/above messageTokens — try activate buffered chunks ===
  else if (shouldObserve(unobservedTokens, config)) {
    log(
      `[OM] Zone 2: threshold reached — ${unobservedTokens} tokens >= ${config.observation.messageTokens}`,
    );

    // Wait for in-flight buffering to complete
    await waitForBuffering(sessionId);

    // Re-fetch record for latest chunks
    currentRecord = getOrCreateOMRecord(sessionId);

    if (currentRecord.bufferedObservationChunks.length > 0) {
      // Activate buffered chunks
      const { chunksToActivate, remainingChunks, messageIdsToExclude } =
        selectChunksForActivation(
          currentRecord.bufferedObservationChunks,
          unobservedTokens,
          config,
        );

      if (chunksToActivate.length > 0) {
        const mergedObservations = mergeChunkObservations(
          currentRecord.activeObservations,
          chunksToActivate,
        );
        const { currentTask, suggestedResponse } = getLatestChunkMetadata(
          chunksToActivate,
          currentRecord.currentTask,
          currentRecord.suggestedResponse,
        );

        // Calculate new observed boundary.
        // The highest message index in the activated chunks + 1 is the new boundary.
        const maxActivatedIndex = Math.max(
          ...messageIdsToExclude.map((id) => Number.parseInt(id, 10)),
        );
        const newObservedUpTo = Math.max(
          currentRecord.observedUpTo,
          maxActivatedIndex + 1,
        );

        updateAfterActivation(sessionId, {
          activeObservations: mergedObservations,
          observationTokenCount: countTextTokens(mergedObservations),
          observedUpTo: newObservedUpTo,
          remainingChunks,
          currentTask,
          suggestedResponse,
        });

        currentRecord = getOrCreateOMRecord(sessionId);
        didObserve = true;
        resetSessionBoundary(sessionId);

        log(
          `[OM] Activated ${chunksToActivate.length} chunks, ${remainingChunks.length} remaining`,
        );
      }
    }

    // If no chunks were available or activation didn't help, fall back to sync
    if (!didObserve) {
      log(
        '[OM] No buffered chunks available, falling back to sync observation',
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

      if (result.success) {
        resetSessionBoundary(sessionId);
      }
    }
  }
  // === Zone 1: below threshold — check if async buffering should fire ===
  else if (
    shouldTriggerAsyncBuffering(
      sessionId,
      unobservedTokens,
      currentRecord,
      config,
    )
  ) {
    log(`[OM] Zone 1: firing async buffering at ${unobservedTokens} tokens`);

    fireAsyncBuffering(
      sessionId,
      allMessages,
      currentRecord,
      model,
      host,
      config,
      unobservedTokens,
    );
  }

  // === Reflection check — condense if observations are too large ===
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

// ============================================================================
// Mid-loop buffering (called between agent iterations)
// ============================================================================

/**
 * Check and trigger async buffering mid-loop.
 *
 * Mastra runs processInputStep every agent iteration, but gates activation,
 * reflection, and message filtering to step 0 only. Only the Zone 1 async
 * buffering check runs every step — it's cheap (threshold comparison + fire-
 * and-forget background LLM call).
 *
 * This function is the Zone 1 check extracted for mid-loop use. It does NOT
 * activate chunks or run sync observation — the agent's message array must
 * not be mutated while the loop is running.
 */
export function checkMidLoopBuffering(
  sessionId: string,
  allMessages: Message[],
  model: string,
  host: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): void {
  if (!config.enabled) return;

  const record = getOrCreateOMRecord(sessionId);
  const unobserved = getUnobservedMessages(allMessages, record);
  const unobservedTokens = countMessagesTokens(unobserved);

  // Update pending token count for tracking
  updatePendingTokens(sessionId, unobservedTokens);

  // Only Zone 1: async buffering trigger. No activation, no sync fallback.
  if (
    shouldTriggerAsyncBuffering(sessionId, unobservedTokens, record, config)
  ) {
    log(
      `[OM] Mid-loop Zone 1: firing async buffering at ${unobservedTokens} tokens`,
    );

    fireAsyncBuffering(
      sessionId,
      allMessages,
      record,
      model,
      host,
      config,
      unobservedTokens,
    );
  }
}

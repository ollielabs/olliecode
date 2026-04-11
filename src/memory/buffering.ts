/**
 * Async buffering for Observational Memory.
 *
 * Background Observer calls fire at regular token-count intervals,
 * producing buffered observation chunks. When the message token count
 * crosses the threshold, chunks are activated instantly — no blocking
 * pause for the user. "Never compacts" experience.
 *
 * Three-zone threshold system:
 * - Below messageTokens (30k): async buffering at ~6k token intervals
 * - messageTokens → blockAfter (30k-36k): activate buffered chunks
 * - Above blockAfter (>36k): synchronous blocking observation (last resort)
 *
 * Ramp mechanism: near the threshold, the buffering interval halves
 * for finer-grained chunks that align with the retention floor.
 */

import { log } from '../agent/logger';
import type {
  BufferedObservationChunk,
  MemoryConfig,
  ObservationalMemoryRecord,
} from './types';

// ============================================================================
// In-memory state (process-level, shared across calls)
// ============================================================================

/**
 * Track in-flight async buffering operations to prevent duplicate fires.
 * Maps sessionId -> Promise of the buffering operation.
 */
const activeBufferingOps = new Map<string, Promise<void>>();

/**
 * Track the last token boundary at which buffering was triggered.
 * Prevents re-triggering at the same interval.
 */
const lastBufferedBoundary = new Map<string, number>();

/**
 * Track how many agent-array messages were included in the last mid-loop
 * buffering trigger. On the next trigger, only messages AFTER this index
 * are sent to the Observer — preventing chunk overlap where successive
 * chunks during the same agent run re-observe the same messages.
 *
 * Reset on session boundary reset (after sync observation or activation).
 */
const lastMidLoopSliceEnd = new Map<string, number>();

// ============================================================================
// Interval trigger logic
// ============================================================================

/**
 * Resolve the absolute buffer interval in tokens.
 * If bufferTokens is a fraction (0-1), multiply by messageTokens.
 */
export function resolveBufferInterval(config: MemoryConfig): number {
  if (config.observation.bufferTokens === false) return 0;
  if (config.observation.bufferTokens <= 1) {
    return Math.floor(
      config.observation.bufferTokens * config.observation.messageTokens,
    );
  }
  return Math.floor(config.observation.bufferTokens);
}

/**
 * Calculate the ramp point — token count above which the interval halves.
 * Default: threshold - bufferTokens * 1.1
 */
export function getRampPoint(config: MemoryConfig): number {
  const interval = resolveBufferInterval(config);
  return config.observation.messageTokens - interval * 1.1;
}

/**
 * Determine if async buffering should be triggered based on current
 * token count and the interval/ramp logic.
 *
 * Returns true if the current token count has crossed a new interval
 * boundary since the last buffering trigger.
 */
export function shouldTriggerAsyncBuffering(
  sessionId: string,
  currentTokens: number,
  record: ObservationalMemoryRecord,
  config: MemoryConfig,
  /** When true, skip the sync threshold guard. Mid-loop buffering is the
   *  only OM activity available during the agent loop — sync observation
   *  can't run because it would mutate the message array. So we keep
   *  firing chunks at every interval boundary regardless of token count. */
  midLoop = false,
): boolean {
  // Buffering disabled
  if (config.observation.bufferTokens === false) return false;

  const interval = resolveBufferInterval(config);
  if (interval <= 0) return false;

  // Don't buffer if already buffering
  if (record.isBufferingObservation) return false;
  if (activeBufferingOps.has(sessionId)) return false;

  // Don't buffer above the sync threshold — that's handled by sync
  // observation. But skip this guard mid-loop, where sync can't run.
  if (!midLoop && currentTokens >= config.observation.messageTokens)
    return false;

  // Calculate effective interval with ramp
  const rampPoint = getRampPoint(config);
  const effectiveInterval =
    currentTokens >= rampPoint ? Math.floor(interval / 2) : interval;

  if (effectiveInterval <= 0) return false;

  // Get last boundary
  const lastBoundary =
    lastBufferedBoundary.get(sessionId) ?? record.lastBufferedAtTokens;

  // Check if we've crossed a new interval boundary
  const currentInterval = Math.floor(currentTokens / effectiveInterval);
  const lastInterval = Math.floor(lastBoundary / effectiveInterval);

  return currentInterval > lastInterval;
}

/**
 * Record that buffering was triggered at the current token count.
 * Call this after successfully starting an async buffering operation.
 */
export function recordBufferingTrigger(
  sessionId: string,
  tokenCount: number,
): void {
  lastBufferedBoundary.set(sessionId, tokenCount);
}

/**
 * Reset the in-memory buffering boundary for a session.
 * Must be called after sync observation or activation resets the
 * observed message tracking, so buffering intervals start fresh.
 */
export function resetSessionBoundary(sessionId: string): void {
  lastBufferedBoundary.delete(sessionId);
  lastMidLoopSliceEnd.delete(sessionId);
}

/**
 * Get the agent-array index where the last mid-loop buffering sliced.
 * Returns 0 if no mid-loop buffering has occurred this run.
 */
export function getMidLoopSliceEnd(sessionId: string): number {
  return lastMidLoopSliceEnd.get(sessionId) ?? 0;
}

/**
 * Record that mid-loop buffering was triggered with messages up to
 * the given agent-array index. Next trigger will slice from here.
 */
export function setMidLoopSliceEnd(sessionId: string, index: number): void {
  lastMidLoopSliceEnd.set(sessionId, index);
}

// ============================================================================
// Chunk activation
// ============================================================================

/**
 * Calculate the retention floor — minimum tokens of raw messages
 * to keep in context after activation.
 *
 * Default: messageTokens * (1 - bufferActivation) = 30k * 0.067 ≈ 2k tokens
 */
export function calculateRetentionFloor(config: MemoryConfig): number {
  return Math.floor(
    config.observation.messageTokens *
      (1 - config.observation.bufferActivation),
  );
}

/**
 * Determine which buffered chunks should be activated.
 *
 * Activates chunks in order until the retention floor is met:
 * the remaining unobserved messages should have at least
 * `retentionFloor` tokens of raw context.
 *
 * Returns the chunks to activate (in order) and the message IDs
 * to exclude from context.
 */
export function selectChunksForActivation(
  chunks: BufferedObservationChunk[],
  totalUnobservedTokens: number,
  config: MemoryConfig,
): {
  chunksToActivate: BufferedObservationChunk[];
  remainingChunks: BufferedObservationChunk[];
  messageIdsToExclude: string[];
} {
  if (chunks.length === 0) {
    return {
      chunksToActivate: [],
      remainingChunks: [],
      messageIdsToExclude: [],
    };
  }

  const retentionFloor = calculateRetentionFloor(config);
  const chunksToActivate: BufferedObservationChunk[] = [];
  const messageIdsToExclude: string[] = [];
  let tokensActivated = 0;

  for (const chunk of chunks) {
    // Check if activating this chunk would leave enough raw context
    const tokensAfterActivation =
      totalUnobservedTokens - tokensActivated - chunk.messageTokens;

    if (tokensAfterActivation < retentionFloor) {
      // Activating this chunk would drop below retention floor.
      // But if we haven't activated anything yet, activate anyway —
      // instant activation with thin context is better than a 10+ second
      // sync fallback. This handles the common case where a single chunk
      // covers most of the unobserved messages.
      if (chunksToActivate.length === 0) {
        chunksToActivate.push(chunk);
        tokensActivated += chunk.messageTokens;
        messageIdsToExclude.push(...chunk.messageIds);
      }
      break;
    }

    chunksToActivate.push(chunk);
    tokensActivated += chunk.messageTokens;
    messageIdsToExclude.push(...chunk.messageIds);
  }

  // Remaining chunks stay in buffer
  const remainingChunks = chunks.slice(chunksToActivate.length);

  return {
    chunksToActivate,
    remainingChunks,
    messageIdsToExclude,
  };
}

/**
 * Prune buffered chunks whose messageIds are entirely within the
 * already-observed range. After activation bumps `observedUpTo`,
 * remaining chunks from a previous agent run may have stale messageIds
 * that overlap with the new boundary. Keeping them causes duplicate
 * observations when they're later activated alongside fresh chunks.
 */
export function pruneStaleChunks(
  chunks: BufferedObservationChunk[],
  observedUpTo: number,
): BufferedObservationChunk[] {
  return chunks.filter((chunk) => {
    if (chunk.messageIds.length === 0) return true;
    // Keep the chunk only if its highest messageId is >= observedUpTo
    // (i.e., it covers at least some unobserved messages)
    const maxId = Math.max(
      ...chunk.messageIds.map((id) => Number.parseInt(id, 10)),
    );
    return maxId >= observedUpTo;
  });
}

/**
 * Merge activated chunks into a single observation string.
 * Deduplicates by discarding chunks whose messageIds are a subset
 * of another chunk's messageIds (keeps the superset's observations).
 * Preserves chunk ordering (oldest first) for non-subset chunks.
 */
export function mergeChunkObservations(
  existingObservations: string,
  chunks: BufferedObservationChunk[],
): string {
  // Deduplicate: discard chunks that are subsets of other chunks.
  // A chunk is a subset if every one of its messageIds appears in
  // another chunk with strictly more messageIds.
  const kept = chunks.filter((chunk, i) => {
    if (chunk.messageIds.length === 0) return true;
    const myIds = new Set(chunk.messageIds);
    for (let j = 0; j < chunks.length; j++) {
      if (i === j) continue;
      const other = chunks[j]!;
      if (other.messageIds.length <= myIds.size) continue;
      const otherIds = new Set(other.messageIds);
      const isSubset = [...myIds].every((id) => otherIds.has(id));
      if (isSubset) return false;
    }
    return true;
  });

  const parts: string[] = [];

  if (existingObservations) {
    parts.push(existingObservations);
  }

  for (const chunk of kept) {
    if (chunk.observations) {
      parts.push(chunk.observations);
    }
  }

  return parts.join('\n\n');
}

/**
 * Get the latest current task and suggested response from activated chunks.
 * Later chunks take precedence (most recent state).
 */
export function getLatestChunkMetadata(
  chunks: BufferedObservationChunk[],
  fallbackTask: string | null,
  fallbackSuggestion: string | null,
): { currentTask: string | null; suggestedResponse: string | null } {
  let currentTask = fallbackTask;
  let suggestedResponse = fallbackSuggestion;

  for (const chunk of chunks) {
    if (chunk.currentTask) {
      currentTask = chunk.currentTask;
    }
    if (chunk.suggestedResponse) {
      suggestedResponse = chunk.suggestedResponse;
    }
  }

  return { currentTask, suggestedResponse };
}

// ============================================================================
// blockAfter check
// ============================================================================

/**
 * Resolve the absolute blockAfter threshold in tokens.
 * If blockAfter is a multiplier (e.g. 1.2), multiply by messageTokens.
 */
export function resolveBlockAfter(config: MemoryConfig): number {
  return Math.floor(
    config.observation.blockAfter * config.observation.messageTokens,
  );
}

/**
 * Check if synchronous blocking observation is needed.
 * This is the last resort when token count exceeds blockAfter
 * and no buffered chunks are available for activation.
 */
export function needsSyncFallback(
  unobservedTokens: number,
  record: ObservationalMemoryRecord,
  config: MemoryConfig,
): boolean {
  const blockAfterTokens = resolveBlockAfter(config);
  return (
    unobservedTokens >= blockAfterTokens &&
    record.bufferedObservationChunks.length === 0
  );
}

// ============================================================================
// Async operation management
// ============================================================================

/**
 * Register an in-flight async buffering operation.
 * Prevents duplicate buffering for the same session.
 */
export function registerBufferingOp(
  sessionId: string,
  op: Promise<void>,
): void {
  activeBufferingOps.set(sessionId, op);
  void op.finally(() => {
    // Only clear if this is still the active op (not replaced by a new one)
    if (activeBufferingOps.get(sessionId) === op) {
      activeBufferingOps.delete(sessionId);
    }
  });
}

/**
 * Wait for any in-flight async buffering to complete.
 * Used during activation to ensure all chunks are available.
 * Times out after the specified duration (default: 60 seconds).
 */
export async function waitForBuffering(
  sessionId: string,
  timeoutMs = 60_000,
): Promise<void> {
  const op = activeBufferingOps.get(sessionId);
  if (!op) return;

  log(
    `[OM] Waiting for in-flight buffering to complete (timeout: ${timeoutMs}ms)`,
  );

  try {
    await Promise.race([
      op,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('Buffering wait timed out')),
          timeoutMs,
        ),
      ),
    ]);
  } catch {
    log(
      '[OM] Buffering wait timed out or failed, proceeding with available chunks',
    );
  }
}

// ============================================================================
// Reflection buffering
// ============================================================================

/**
 * Track in-flight async reflection operations.
 * Maps sessionId -> Promise of the reflection operation.
 */
const activeReflectionOps = new Map<string, Promise<void>>();

/**
 * Resolve the absolute reflection buffer activation threshold in tokens.
 * If bufferActivation is a fraction (0-1), multiply by observationTokens.
 */
export function resolveReflectionBufferThreshold(config: MemoryConfig): number {
  if (config.reflection.bufferActivation === false) return 0;
  return Math.floor(
    config.reflection.bufferActivation * config.reflection.observationTokens,
  );
}

/**
 * Resolve the absolute reflection blockAfter threshold in tokens.
 */
export function resolveReflectionBlockAfter(config: MemoryConfig): number {
  return Math.floor(
    config.reflection.blockAfter * config.reflection.observationTokens,
  );
}

/**
 * Determine if async reflection buffering should be triggered.
 *
 * Returns true when:
 * 1. Observation token count >= 50% of reflection threshold (default 20k)
 * 2. No reflection is already buffering or in progress
 * 3. No buffered reflection already exists (waiting for activation)
 * 4. Async reflection buffering is enabled
 */
export function shouldTriggerAsyncReflection(
  record: ObservationalMemoryRecord,
  config: MemoryConfig,
): boolean {
  // Disabled
  if (config.reflection.bufferActivation === false) return false;

  // Already buffering or reflecting
  if (record.isBufferingReflection) return false;
  if (record.isReflecting) return false;
  if (activeReflectionOps.has(record.sessionId)) return false;

  // Already have a buffered reflection waiting for activation
  if (record.bufferedReflection) return false;

  // No observations to reflect on
  if (!record.activeObservations || record.observationTokenCount === 0) {
    return false;
  }

  // Check threshold
  const threshold = resolveReflectionBufferThreshold(config);
  if (threshold <= 0) return false;

  return record.observationTokenCount >= threshold;
}

/**
 * Check if sync reflection should be forced (above blockAfter).
 * This is the last resort when observations grow too large and
 * no buffered reflection is available.
 */
export function needsSyncReflection(
  record: ObservationalMemoryRecord,
  config: MemoryConfig,
): boolean {
  const blockAfter = resolveReflectionBlockAfter(config);
  return (
    record.observationTokenCount >= blockAfter && !record.bufferedReflection
  );
}

/**
 * Register an in-flight async reflection operation.
 */
export function registerReflectionOp(
  sessionId: string,
  op: Promise<void>,
): void {
  activeReflectionOps.set(sessionId, op);
  void op.finally(() => {
    if (activeReflectionOps.get(sessionId) === op) {
      activeReflectionOps.delete(sessionId);
    }
  });
}

/**
 * Wait for any in-flight async reflection to complete.
 */
export async function waitForReflection(
  sessionId: string,
  timeoutMs = 60_000,
): Promise<void> {
  const op = activeReflectionOps.get(sessionId);
  if (!op) return;

  log(
    `[OM] Waiting for in-flight reflection to complete (timeout: ${timeoutMs}ms)`,
  );

  try {
    await Promise.race([
      op,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('Reflection wait timed out')),
          timeoutMs,
        ),
      ),
    ]);
  } catch {
    log(
      '[OM] Reflection wait timed out or failed, proceeding with sync fallback',
    );
  }
}

/**
 * Split observation text into oldest and newest line groups.
 *
 * @param observations - Full observation text
 * @param splitRatio - Fraction of lines to include in the "oldest" group (0-1)
 * @returns [oldestLines, newestLines] — joined text for each group
 */
export function splitObservationLines(
  observations: string,
  splitRatio: number,
): { oldestText: string; newestText: string; oldestLineCount: number } {
  const lines = observations.split('\n');
  const splitPoint = Math.floor(lines.length * splitRatio);

  // Ensure at least 1 line in each group
  const boundary = Math.max(1, Math.min(splitPoint, lines.length - 1));

  return {
    oldestText: lines.slice(0, boundary).join('\n'),
    newestText: lines.slice(boundary).join('\n'),
    oldestLineCount: boundary,
  };
}

// ============================================================================
// Reset (for testing)
// ============================================================================

/**
 * Clear all in-memory buffering state.
 * @internal Only for use in tests.
 */
export function resetBufferingState(): void {
  activeBufferingOps.clear();
  lastBufferedBoundary.clear();
  lastMidLoopSliceEnd.clear();
  activeReflectionOps.clear();
}

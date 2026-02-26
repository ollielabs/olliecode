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

import type { Message } from 'ollama';

import { log } from '../agent/logger';
import { countMessagesTokens } from './token-counter';
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
): boolean {
  // Buffering disabled
  if (config.observation.bufferTokens === false) return false;

  const interval = resolveBufferInterval(config);
  if (interval <= 0) return false;

  // Don't buffer if already buffering
  if (record.isBufferingObservation) return false;
  if (activeBufferingOps.has(sessionId)) return false;

  // Don't buffer above the sync threshold — that's handled by sync observation
  if (currentTokens >= config.observation.messageTokens) return false;

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

// ============================================================================
// Chunk activation
// ============================================================================

/**
 * Calculate the retention floor — minimum tokens of raw messages
 * to keep in context after activation.
 *
 * Default: messageTokens * (1 - bufferActivation) = 30k * 0.2 = 6k tokens
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
      // Activating this chunk would drop below retention floor
      // Keep remaining chunks in buffer
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
 * Merge activated chunks into a single observation string.
 * Preserves chunk ordering (oldest first).
 */
export function mergeChunkObservations(
  existingObservations: string,
  chunks: BufferedObservationChunk[],
): string {
  const parts: string[] = [];

  if (existingObservations) {
    parts.push(existingObservations);
  }

  for (const chunk of chunks) {
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

/**
 * Check if there's an active buffering operation for a session.
 */
export function isBufferingActive(sessionId: string): boolean {
  return activeBufferingOps.has(sessionId);
}

/**
 * Filter messages to exclude those that have been observed via buffered chunks.
 * Uses message position indices (stored as string IDs in chunks).
 */
export function filterActivatedMessages(
  allMessages: Message[],
  observedMessageIds: string[],
): Message[] {
  if (observedMessageIds.length === 0) return allMessages;

  // observedMessageIds are position indices as strings
  // All messages up to the max observed index are excluded
  const maxObserved = Math.max(
    ...observedMessageIds.map((id) => Number.parseInt(id, 10)),
  );

  return allMessages.slice(maxObserved + 1);
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
}

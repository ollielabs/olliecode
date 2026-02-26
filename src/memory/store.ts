/**
 * Observational Memory persistence layer.
 *
 * CRUD operations for the `observational_memory` table.
 * Single-record design: one row per session holds all OM state.
 *
 * Stateless module functions using the shared SQLite singleton.
 * Follows the same pattern as session/todo.ts.
 */

import { getDatabase } from '../session/db';
import type {
  BufferedObservationChunk,
  ObservationalMemoryRecord,
} from './types';

// ============================================================================
// Internal row type (snake_case DB columns)
// ============================================================================

type OMRow = {
  id: string;
  session_id: string;
  active_observations: string;
  observation_token_count: number;
  origin_type: string;
  generation_count: number;
  last_observed_at: number | null;
  observed_message_ids: string;
  buffered_observation_chunks: string;
  is_buffering_observation: number;
  last_buffered_at_tokens: number;
  last_buffered_at_time: number | null;
  buffered_reflection: string | null;
  buffered_reflection_tokens: number | null;
  buffered_reflection_input_tokens: number | null;
  reflected_observation_line_count: number | null;
  is_buffering_reflection: number;
  is_observing: number;
  is_reflecting: number;
  pending_message_tokens: number;
  total_tokens_observed: number;
  current_task: string | null;
  suggested_response: string | null;
  created_at: number;
  updated_at: number;
};

// ============================================================================
// Row <-> Record conversion
// ============================================================================

function rowToRecord(row: OMRow): ObservationalMemoryRecord {
  let observedMessageIds: string[] = [];
  try {
    observedMessageIds = JSON.parse(row.observed_message_ids) as string[];
  } catch {
    // Corrupted JSON — use empty array
  }

  let bufferedObservationChunks: BufferedObservationChunk[] = [];
  try {
    bufferedObservationChunks = JSON.parse(
      row.buffered_observation_chunks,
    ) as BufferedObservationChunk[];
  } catch {
    // Corrupted JSON — use empty array
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    activeObservations: row.active_observations,
    observationTokenCount: row.observation_token_count,
    originType: row.origin_type as 'initial' | 'observation' | 'reflection',
    generationCount: row.generation_count,
    lastObservedAt: row.last_observed_at,
    observedMessageIds,
    bufferedObservationChunks,
    isBufferingObservation: row.is_buffering_observation === 1,
    lastBufferedAtTokens: row.last_buffered_at_tokens,
    lastBufferedAtTime: row.last_buffered_at_time,
    bufferedReflection: row.buffered_reflection,
    bufferedReflectionTokens: row.buffered_reflection_tokens,
    bufferedReflectionInputTokens: row.buffered_reflection_input_tokens,
    reflectedObservationLineCount: row.reflected_observation_line_count,
    isBufferingReflection: row.is_buffering_reflection === 1,
    isObserving: row.is_observing === 1,
    isReflecting: row.is_reflecting === 1,
    pendingMessageTokens: row.pending_message_tokens,
    totalTokensObserved: row.total_tokens_observed,
    currentTask: row.current_task,
    suggestedResponse: row.suggested_response,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// CRUD operations
// ============================================================================

/**
 * Get the OM record for a session. Returns null if none exists.
 */
export function getOMRecord(
  sessionId: string,
): ObservationalMemoryRecord | null {
  const db = getDatabase();
  const row = db
    .query('SELECT * FROM observational_memory WHERE session_id = ?')
    .get(sessionId) as OMRow | null;

  if (!row) return null;
  return rowToRecord(row);
}

/**
 * Get or create the OM record for a session.
 * Creates an initial record if none exists.
 */
export function getOrCreateOMRecord(
  sessionId: string,
): ObservationalMemoryRecord {
  const existing = getOMRecord(sessionId);
  if (existing) return existing;

  const now = Date.now();
  const id = crypto.randomUUID();

  const db = getDatabase();
  db.run(
    `INSERT INTO observational_memory (
      id, session_id, active_observations, observation_token_count,
      origin_type, generation_count, last_observed_at, observed_message_ids,
      buffered_observation_chunks, is_buffering_observation,
      last_buffered_at_tokens, last_buffered_at_time,
      buffered_reflection, buffered_reflection_tokens,
      buffered_reflection_input_tokens, reflected_observation_line_count,
      is_buffering_reflection, is_observing, is_reflecting,
      pending_message_tokens, total_tokens_observed,
      current_task, suggested_response, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sessionId,
      '', // active_observations
      0, // observation_token_count
      'initial', // origin_type
      0, // generation_count
      null, // last_observed_at
      '[]', // observed_message_ids
      '[]', // buffered_observation_chunks
      0, // is_buffering_observation
      0, // last_buffered_at_tokens
      null, // last_buffered_at_time
      null, // buffered_reflection
      null, // buffered_reflection_tokens
      null, // buffered_reflection_input_tokens
      null, // reflected_observation_line_count
      0, // is_buffering_reflection
      0, // is_observing
      0, // is_reflecting
      0, // pending_message_tokens
      0, // total_tokens_observed
      null, // current_task
      null, // suggested_response
      now, // created_at
      now, // updated_at
    ],
  );

  return getOMRecord(sessionId)!;
}

/**
 * Update the OM record after a successful observation.
 */
export function updateAfterObservation(
  sessionId: string,
  opts: {
    activeObservations: string;
    observationTokenCount: number;
    lastObservedAt: number;
    observedMessageIds: string[];
    pendingMessageTokens: number;
    totalTokensObserved: number;
    currentTask: string | null;
    suggestedResponse: string | null;
  },
): void {
  const db = getDatabase();
  db.run(
    `UPDATE observational_memory SET
      active_observations = ?,
      observation_token_count = ?,
      origin_type = 'observation',
      last_observed_at = ?,
      observed_message_ids = ?,
      pending_message_tokens = ?,
      total_tokens_observed = ?,
      current_task = ?,
      suggested_response = ?,
      is_observing = 0,
      updated_at = ?
    WHERE session_id = ?`,
    [
      opts.activeObservations,
      opts.observationTokenCount,
      opts.lastObservedAt,
      JSON.stringify(opts.observedMessageIds),
      opts.pendingMessageTokens,
      opts.totalTokensObserved,
      opts.currentTask,
      opts.suggestedResponse,
      Date.now(),
      sessionId,
    ],
  );
}

/**
 * Set the isObserving lock flag.
 */
export function setObservingFlag(
  sessionId: string,
  isObserving: boolean,
): void {
  const db = getDatabase();
  db.run(
    'UPDATE observational_memory SET is_observing = ?, updated_at = ? WHERE session_id = ?',
    [isObserving ? 1 : 0, Date.now(), sessionId],
  );
}

/**
 * Update pending message token count.
 */
export function updatePendingTokens(
  sessionId: string,
  pendingMessageTokens: number,
): void {
  const db = getDatabase();
  db.run(
    'UPDATE observational_memory SET pending_message_tokens = ?, updated_at = ? WHERE session_id = ?',
    [pendingMessageTokens, Date.now(), sessionId],
  );
}

/**
 * Set the isReflecting lock flag.
 */
export function setReflectingFlag(
  sessionId: string,
  isReflecting: boolean,
): void {
  const db = getDatabase();
  db.run(
    'UPDATE observational_memory SET is_reflecting = ?, updated_at = ? WHERE session_id = ?',
    [isReflecting ? 1 : 0, Date.now(), sessionId],
  );
}

/**
 * Update the OM record after a successful reflection.
 *
 * Creates a new generation: replaces activeObservations with the
 * condensed reflection output, increments generationCount, sets
 * originType to 'reflection'.
 */
export function updateAfterReflection(
  sessionId: string,
  opts: {
    activeObservations: string;
    observationTokenCount: number;
    currentTask: string | null;
    suggestedResponse: string | null;
  },
): void {
  const db = getDatabase();
  db.run(
    `UPDATE observational_memory SET
      active_observations = ?,
      observation_token_count = ?,
      origin_type = 'reflection',
      generation_count = generation_count + 1,
      current_task = ?,
      suggested_response = ?,
      is_reflecting = 0,
      updated_at = ?
    WHERE session_id = ?`,
    [
      opts.activeObservations,
      opts.observationTokenCount,
      opts.currentTask,
      opts.suggestedResponse,
      Date.now(),
      sessionId,
    ],
  );
}

/**
 * Set the isBufferingObservation lock flag.
 */
export function setBufferingObservationFlag(
  sessionId: string,
  isBuffering: boolean,
): void {
  const db = getDatabase();
  db.run(
    'UPDATE observational_memory SET is_buffering_observation = ?, updated_at = ? WHERE session_id = ?',
    [isBuffering ? 1 : 0, Date.now(), sessionId],
  );
}

/**
 * Add a buffered observation chunk to the record.
 */
export function addBufferedChunk(
  sessionId: string,
  chunk: BufferedObservationChunk,
): void {
  const db = getDatabase();
  const record = getOMRecord(sessionId);
  if (!record) return;

  const chunks = [...record.bufferedObservationChunks, chunk];
  const now = Date.now();

  db.run(
    `UPDATE observational_memory SET
      buffered_observation_chunks = ?,
      last_buffered_at_tokens = ?,
      last_buffered_at_time = ?,
      is_buffering_observation = 0,
      updated_at = ?
    WHERE session_id = ?`,
    [JSON.stringify(chunks), chunk.messageTokens, now, now, sessionId],
  );
}

/**
 * Update the record after activating buffered chunks.
 * Merges activated chunks into active observations and removes them from the buffer.
 */
export function updateAfterActivation(
  sessionId: string,
  opts: {
    activeObservations: string;
    observationTokenCount: number;
    observedMessageIds: string[];
    remainingChunks: BufferedObservationChunk[];
    currentTask: string | null;
    suggestedResponse: string | null;
  },
): void {
  const db = getDatabase();
  db.run(
    `UPDATE observational_memory SET
      active_observations = ?,
      observation_token_count = ?,
      observed_message_ids = ?,
      buffered_observation_chunks = ?,
      current_task = ?,
      suggested_response = ?,
      updated_at = ?
    WHERE session_id = ?`,
    [
      opts.activeObservations,
      opts.observationTokenCount,
      JSON.stringify(opts.observedMessageIds),
      JSON.stringify(opts.remainingChunks),
      opts.currentTask,
      opts.suggestedResponse,
      Date.now(),
      sessionId,
    ],
  );
}

/**
 * Delete the OM record for a session.
 * Used by /new or session clear.
 */
export function deleteOMRecord(sessionId: string): void {
  const db = getDatabase();
  db.run('DELETE FROM observational_memory WHERE session_id = ?', [sessionId]);
}

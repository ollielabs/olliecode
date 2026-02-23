/**
 * Observation persistence for observational memory.
 *
 * Stateless module functions using the shared SQLite singleton.
 * Follows the same pattern as session/todo.ts.
 */

import { getDatabase } from '../session/db';
import type { Observation, ObservationType } from './types';

/** Internal DB row type (snake_case column names) */
type ObservationRow = {
  id: string;
  session_id: string;
  type: string;
  content: string;
  metadata: string;
  importance: number;
  source: string;
  created_at: number;
};

/** Convert a DB row to an Observation */
function rowToObservation(row: ObservationRow): Observation {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    // Corrupted JSON — use empty object
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type as ObservationType,
    content: row.content,
    metadata,
    importance: row.importance,
    source: row.source as 'programmatic' | 'llm',
    createdAt: row.created_at,
  };
}

/**
 * Store observations in a single transaction.
 * No-op if the array is empty.
 */
export function addObservations(observations: Observation[]): void {
  if (observations.length === 0) return;

  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO observations (id, session_id, type, content, metadata, importance, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertAll = db.transaction(() => {
    for (const obs of observations) {
      stmt.run(
        obs.id,
        obs.sessionId,
        obs.type,
        obs.content,
        JSON.stringify(obs.metadata),
        obs.importance,
        obs.source,
        obs.createdAt,
      );
    }
  });

  insertAll();
}

/**
 * Get all observations for a session, ordered chronologically.
 */
export function getObservationsBySession(sessionId: string): Observation[] {
  const db = getDatabase();
  const rows = db
    .query(
      'SELECT * FROM observations WHERE session_id = ? ORDER BY created_at ASC',
    )
    .all(sessionId) as ObservationRow[];
  return rows.map(rowToObservation);
}

/**
 * Get filtered observations for a session.
 *
 * @param sessionId - Session to query
 * @param opts.types - Filter by observation types (OR)
 * @param opts.minImportance - Minimum importance threshold
 * @param opts.limit - Maximum number of results (most recent first)
 */
export function getRecentObservations(
  sessionId: string,
  opts?: {
    types?: ObservationType[];
    minImportance?: number;
    limit?: number;
  },
): Observation[] {
  const db = getDatabase();
  const conditions = ['session_id = ?'];
  const params: (string | number)[] = [sessionId];

  if (opts?.types && opts.types.length > 0) {
    const placeholders = opts.types.map(() => '?').join(', ');
    conditions.push(`type IN (${placeholders})`);
    params.push(...opts.types);
  }

  if (opts?.minImportance !== undefined) {
    conditions.push('importance >= ?');
    params.push(opts.minImportance);
  }

  let sql = `SELECT * FROM observations WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;

  if (opts?.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }

  const rows = db.query(sql).all(...params) as ObservationRow[];
  return rows.map(rowToObservation);
}

/**
 * Delete all observations for a session.
 * Used by /forget or /new session.
 */
export function clearObservations(sessionId: string): void {
  const db = getDatabase();
  db.run('DELETE FROM observations WHERE session_id = ?', [sessionId]);
}

/**
 * Get the timestamp of the most recent observation for a session.
 * Returns null if no observations exist.
 *
 * Useful for LLM-based extraction (fast-follow) to know what's
 * already been observed and avoid re-processing.
 */
export function getLatestObservationTimestamp(
  sessionId: string,
): number | null {
  const db = getDatabase();
  const row = db
    .query(
      'SELECT MAX(created_at) as latest FROM observations WHERE session_id = ?',
    )
    .get(sessionId) as { latest: number | null } | null;
  return row?.latest ?? null;
}

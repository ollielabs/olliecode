/**
 * Session service - main API for session persistence.
 * Re-exports all types and utilities for convenient imports.
 */

import { randomUUID } from "crypto";
import { getDatabase, initDatabase, closeDatabase, getDatabasePath, getDataDirectory } from "./db";
import { getProjectName } from "./project";
import type {
  Session,
  StoredMessage,
  MessagePart,
  CreateSessionOptions,
  ListSessionsOptions,
  UpdateSessionOptions,
} from "./types";

// Re-export for convenient imports
export { initDatabase, closeDatabase, getDatabasePath, getDataDirectory };
export { getProjectName } from "./project";
export * from "./types";
export * from "./convert";

/**
 * Generate a session title from the first user message.
 * Truncates at word boundary if too long.
 */
function generateTitle(firstMessage: string): string {
  const maxLength = 50;

  if (firstMessage.length <= maxLength) {
    return firstMessage;
  }

  const truncated = firstMessage.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  // If we can find a word boundary after position 20, use it
  const title = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
  return title + "...";
}

// ============================================================================
// Session CRUD
// ============================================================================

/**
 * Create a new session.
 */
export async function createSession(opts: CreateSessionOptions): Promise<Session> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();
  const projectName = await getProjectName(opts.projectPath);

  const session: Session = {
    id,
    projectPath: opts.projectPath,
    projectName,
    title: null,
    mode: opts.mode,
    model: opts.model,
    host: opts.host,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO sessions (id, project_path, project_name, title, mode, model, host, message_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.projectPath,
      session.projectName,
      session.title,
      session.mode,
      session.model,
      session.host,
      session.messageCount,
      session.createdAt,
      session.updatedAt,
    ]
  );

  return session;
}

/**
 * Get a session by ID.
 */
export function getSession(id: string): Session | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
  return row ? rowToSession(row) : null;
}

/**
 * Get the most recent session for a project path.
 */
export function getLatestSession(projectPath: string): Session | null {
  const db = getDatabase();
  const row = db
    .query("SELECT * FROM sessions WHERE project_path = ? ORDER BY updated_at DESC LIMIT 1")
    .get(projectPath) as SessionRow | null;
  return row ? rowToSession(row) : null;
}

/**
 * List sessions, optionally filtered by project path.
 */
export function listSessions(opts: ListSessionsOptions = {}): Session[] {
  const db = getDatabase();
  const limit = opts.limit ?? 50;

  let rows: SessionRow[];

  if (opts.projectPath) {
    rows = db
      .query("SELECT * FROM sessions WHERE project_path = ? ORDER BY updated_at DESC LIMIT ?")
      .all(opts.projectPath, limit) as SessionRow[];
  } else {
    rows = db
      .query("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as SessionRow[];
  }

  return rows.map(rowToSession);
}

/**
 * Update session fields.
 */
export function updateSession(id: string, updates: UpdateSessionOptions): void {
  const db = getDatabase();
  const now = Date.now();

  // Build update query dynamically based on provided fields
  if (updates.title !== undefined && updates.mode !== undefined) {
    db.run(
      "UPDATE sessions SET updated_at = ?, title = ?, mode = ? WHERE id = ?",
      [now, updates.title, updates.mode, id]
    );
  } else if (updates.title !== undefined) {
    db.run(
      "UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?",
      [now, updates.title, id]
    );
  } else if (updates.mode !== undefined) {
    db.run(
      "UPDATE sessions SET updated_at = ?, mode = ? WHERE id = ?",
      [now, updates.mode, id]
    );
  } else {
    // Just update timestamp
    db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, id]);
  }
}

/**
 * Delete a session and all its messages (cascades via FK).
 */
export function deleteSession(id: string): void {
  const db = getDatabase();
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
}

// ============================================================================
// Message CRUD
// ============================================================================

/**
 * Add a message to a session.
 * Auto-generates session title from first user message.
 */
export function addMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  parts: MessagePart[]
): StoredMessage {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  const message: StoredMessage = {
    id,
    sessionId,
    role,
    parts,
    createdAt: now,
  };

  db.run("INSERT INTO messages (id, session_id, role, parts, created_at) VALUES (?, ?, ?, ?, ?)", [
    message.id,
    message.sessionId,
    message.role,
    JSON.stringify(message.parts),
    message.createdAt,
  ]);

  // Update session message count and timestamp
  db.run("UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE id = ?", [
    now,
    sessionId,
  ]);

  // Auto-generate title from first user message
  if (role === "user") {
    const session = getSession(sessionId);
    if (session && !session.title) {
      const textPart = parts.find((p): p is MessagePart & { type: "text" } => p.type === "text");
      if (textPart) {
        updateSession(sessionId, { title: generateTitle(textPart.content) });
      }
    }
  }

  return message;
}

/**
 * Get all messages for a session in chronological order.
 */
export function getMessages(sessionId: string): StoredMessage[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as MessageRow[];
  return rows.map(rowToMessage);
}

// ============================================================================
// Internal: DB row types and converters
// ============================================================================

type SessionRow = {
  id: string;
  project_path: string;
  project_name: string | null;
  title: string | null;
  mode: string;
  model: string;
  host: string;
  message_count: number;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: string;
  parts: string;
  created_at: number;
};

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    projectPath: row.project_path,
    projectName: row.project_name,
    title: row.title,
    mode: row.mode as Session["mode"],
    model: row.model,
    host: row.host,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as StoredMessage["role"],
    parts: JSON.parse(row.parts) as MessagePart[],
    createdAt: row.created_at,
  };
}

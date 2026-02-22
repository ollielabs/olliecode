/**
 * Database migrations for session persistence.
 * Uses a simple version-based migration system.
 */

import type { Database } from 'bun:sqlite';

type Migration = {
  version: number;
  name: string;
  sql: string;
};

/**
 * All migrations in order. Each migration should be idempotent
 * (use IF NOT EXISTS, etc.) to handle partial failures.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      -- Version tracking
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        project_name TEXT,
        title TEXT,
        mode TEXT NOT NULL DEFAULT 'build',
        model TEXT NOT NULL,
        host TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

      -- Messages
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        parts TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    `,
  },
  {
    version: 2,
    name: 'add_todos_table',
    sql: `
      -- Todos for session task tracking
      -- Enables agents to maintain persistent task lists across session resumption
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT 'medium',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_todos_session ON todos(session_id);
      CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
    `,
  },
  {
    version: 3,
    name: 'add_message_snapshots',
    sql: `
      -- Compaction snapshots for message history.
      -- Original messages are never deleted — snapshots are overlays.
      -- On load: active = snapshot.messages + raw messages added after snapshot.
      CREATE TABLE IF NOT EXISTS message_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        snapshot_type TEXT NOT NULL,
        messages TEXT NOT NULL,
        original_count INTEGER NOT NULL,
        compacted_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_session ON message_snapshots(session_id);
    `,
  },
  {
    version: 4,
    name: 'compaction_redesign',
    sql: `
      -- Compaction redesign: summary pointer replaces snapshot overlay.
      -- Chat history is never altered. Compaction only affects model context.
      -- summary_message_id points to the latest summary message in the
      -- messages table. When building model context, everything before the
      -- summary is dropped and the summary is sent as context.
      ALTER TABLE sessions ADD COLUMN summary_message_id TEXT;

      -- Drop the snapshot system — no longer needed.
      DROP TABLE IF EXISTS message_snapshots;
    `,
  },
];

/**
 * Get the current schema version from the database.
 * Returns 0 if the schema_version table doesn't exist.
 */
function getCurrentVersion(db: Database): number {
  try {
    const result = db
      .query('SELECT MAX(version) as version FROM schema_version')
      .get() as {
      version: number | null;
    } | null;
    return result?.version ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Record a migration version as applied.
 */
function setVersion(db: Database, version: number): void {
  db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [
    version,
    Date.now(),
  ]);
}

/**
 * Run all pending migrations.
 */
export function runMigrations(db: Database): void {
  const currentVersion = getCurrentVersion(db);

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      console.error(
        `[session] Running migration ${migration.version}: ${migration.name}`,
      );
      db.exec(migration.sql);
      setVersion(db, migration.version);
    }
  }
}

/**
 * Get the latest migration version available.
 */
export function getLatestVersion(): number {
  return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
}

/**
 * Database migrations for session persistence.
 * Uses a simple version-based migration system.
 */

import type { Database } from "bun:sqlite";

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
    name: "initial_schema",
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
];

/**
 * Get the current schema version from the database.
 * Returns 0 if the schema_version table doesn't exist.
 */
function getCurrentVersion(db: Database): number {
  try {
    const result = db.query("SELECT MAX(version) as version FROM schema_version").get() as {
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
  db.run("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)", [
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
      console.error(`[session] Running migration ${migration.version}: ${migration.name}`);
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

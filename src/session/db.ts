/**
 * Database connection and initialization for session persistence.
 * Uses bun:sqlite for zero-dependency SQLite support.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { runMigrations } from './migrations';

/**
 * Get the path to the Olly data directory.
 * Follows XDG convention: ~/.local/share/olly/
 */
export function getDataDirectory(): string {
  return join(homedir(), '.local', 'share', 'olly');
}

/**
 * Get the path to the SQLite database file.
 */
export function getDatabasePath(): string {
  return join(getDataDirectory(), 'olly.db');
}

// Singleton database instance
let db: Database | null = null;

/**
 * Get the database instance.
 * Throws if initDatabase() hasn't been called.
 */
export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Check if the database is initialized.
 */
export function isDatabaseInitialized(): boolean {
  return db !== null;
}

/**
 * Initialize the database connection.
 * Creates the data directory and database file if they don't exist.
 * Runs any pending migrations.
 */
export function initDatabase(): void {
  if (db) {
    return; // Already initialized
  }

  const dbPath = getDatabasePath();
  const dbDir = dirname(dbPath);

  // Ensure data directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Open database with WAL mode for better concurrent performance
  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Run any pending migrations
  runMigrations(db);
}

/**
 * Close the database connection.
 * Safe to call multiple times.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

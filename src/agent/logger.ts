/**
 * Debug logging for the agent.
 * Controlled by OLLY_DEBUG environment variable or config.debug.
 *
 * Writes to .ollie/debug.log using appendFileSync to bypass
 * @opentui/core's console.error capture. See core/gotchas.md.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_LOG_SIZE = 1024 * 1024; // 1MB

let debugEnabled = false;
let logPath: string | null = null;

/**
 * Get the data directory path (.ollie in project root or ~/.local/share/ollie).
 * Uses the same convention as session/db.ts.
 */
function getLogDirectory(): string {
  return join(homedir(), '.local', 'share', 'ollie');
}

/**
 * Initialize the log file. Truncates if over MAX_LOG_SIZE.
 */
function initLogFile(): void {
  const dir = getLogDirectory();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  logPath = join(dir, 'debug.log');

  // Rotate: truncate if over 1MB
  if (existsSync(logPath)) {
    try {
      const stats = statSync(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        writeFileSync(logPath, '');
      }
    } catch {
      // Ignore stat errors
    }
  }

  // Write session separator
  const separator = `\n${'='.repeat(60)}\n[${new Date().toISOString()}] Debug session started\n${'='.repeat(60)}\n`;
  appendFileSync(logPath, separator);
}

/**
 * Check if debug logging is enabled via environment.
 * Set OLLY_DEBUG=1 or OLLY_DEBUG=true to enable.
 */
function isEnvDebugEnabled(): boolean {
  const envValue = process.env.OLLY_DEBUG;
  return envValue === '1' || envValue === 'true';
}

/**
 * Enable or disable debug logging.
 * Called during config resolution to wire config.debug.
 */
export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
  if (enabled && !logPath) {
    initLogFile();
  }
}

// Auto-enable from env var
if (isEnvDebugEnabled()) {
  setDebugEnabled(true);
}

/**
 * Format a value for logging. Handles errors, objects, and primitives.
 */
function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/**
 * Log debug messages to .ollie/debug.log.
 * Only outputs when debug is enabled (via env or config).
 */
export function log(...args: unknown[]): void {
  if (!debugEnabled || !logPath) return;

  const timestamp = new Date().toISOString();
  const message = args.map(formatArg).join(' ');
  appendFileSync(logPath, `[${timestamp}] [agent] ${message}\n`);
}

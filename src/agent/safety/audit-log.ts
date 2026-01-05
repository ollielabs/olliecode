/**
 * Audit logging for safety layer.
 * Records all tool executions for accountability and debugging.
 */

import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEntry, SafetyConfig } from './types';

// Patterns to redact from logs
const REDACT_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI keys
  /ghp_[a-zA-Z0-9]{36,}/g, // GitHub tokens
  /gho_[a-zA-Z0-9]{36,}/g, // GitHub OAuth tokens
  /github_pat_[a-zA-Z0-9_]{22,}/g, // GitHub PATs
  /xox[baprs]-[a-zA-Z0-9-]+/g, // Slack tokens
  /eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, // JWTs
  /AKIA[0-9A-Z]{16}/g, // AWS access keys
  /[a-zA-Z0-9+/]{40,}={0,2}/g, // Base64 encoded secrets (long ones)
  /password['":\s]*['"][^'"]+['"]/gi, // Password fields
  /secret['":\s]*['"][^'"]+['"]/gi, // Secret fields
  /token['":\s]*['"][^'"]+['"]/gi, // Token fields
  /api[_-]?key['":\s]*['"][^'"]+['"]/gi, // API key fields
];

/**
 * Audit logger for a session.
 */
export class AuditLog {
  private sessionId: string;
  private config: SafetyConfig;
  private buffer: AuditEntry[] = [];
  private flushPromise: Promise<void> | null = null;

  constructor(config: SafetyConfig) {
    this.config = config;
    this.sessionId = generateSessionId();
  }

  /**
   * Log a tool execution.
   */
  async log(entry: Omit<AuditEntry, 'timestamp' | 'sessionId'>): Promise<void> {
    if (!this.config.enableAuditLog) return;

    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      args: redactSensitiveData(entry.args),
      output: entry.output
        ? truncate(redactString(entry.output), 1000)
        : undefined,
      error: entry.error ? redactString(entry.error) : undefined,
    };

    this.buffer.push(fullEntry);

    // Flush if buffer is getting large
    if (this.buffer.length >= 10) {
      await this.flush();
    }
  }

  /**
   * Flush buffered entries to disk.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (!this.config.auditLogPath) return;

    // Wait for any existing flush
    if (this.flushPromise) {
      await this.flushPromise;
    }

    const entries = [...this.buffer];
    this.buffer = [];

    this.flushPromise = this.writeEntries(entries);
    await this.flushPromise;
    this.flushPromise = null;
  }

  /**
   * Write entries to log file.
   */
  private async writeEntries(entries: AuditEntry[]): Promise<void> {
    if (!this.config.auditLogPath) return;

    try {
      // Ensure directory exists
      const dir = dirname(this.config.auditLogPath);
      await mkdir(dir, { recursive: true });

      // Append entries as JSONL
      const lines = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
      await appendFile(this.config.auditLogPath, lines);
    } catch (error) {
      // Log to stderr but don't fail
      console.error('[audit] Failed to write audit log:', error);
    }
  }

  /**
   * Get session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Redact sensitive data from an object.
 */
function redactSensitiveData(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Check if key suggests sensitive data
    const isSensitiveKey = /password|secret|token|key|credential|auth/i.test(
      key,
    );

    if (isSensitiveKey && typeof value === 'string') {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      result[key] = redactString(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Redact sensitive patterns from a string.
 */
function redactString(str: string): string {
  let result = str;

  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }

  return result;
}

/**
 * Truncate a string to a maximum length.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return (
    str.slice(0, maxLength) +
    `... [truncated, ${str.length - maxLength} more chars]`
  );
}

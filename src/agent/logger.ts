/**
 * Debug logging for the agent.
 * Controlled by OLLY_DEBUG environment variable or config.debug.
 */

/**
 * Check if debug logging is enabled via environment.
 * Set OLLY_DEBUG=1 or OLLY_DEBUG=true to enable.
 */
function isEnvDebugEnabled(): boolean {
  const envValue = process.env.OLLY_DEBUG;
  return envValue === '1' || envValue === 'true';
}

// Module-level debug flag. Starts with env value, can be enabled by config.
let debugEnabled = isEnvDebugEnabled();

/**
 * Enable or disable debug logging.
 * Called during config resolution to wire config.debug.
 */
export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
}

/**
 * Log debug messages to stderr.
 * Only outputs when debug is enabled (via env or config).
 *
 * @param args - Values to log (same as console.error)
 */
export function log(...args: unknown[]): void {
  if (debugEnabled) {
    console.error('[agent]', ...args);
  }
}

/**
 * Log debug messages with a custom prefix.
 *
 * @param prefix - Custom prefix for the log message
 * @param args - Values to log
 */
export function logWithPrefix(prefix: string, ...args: unknown[]): void {
  if (debugEnabled) {
    console.error(`[${prefix}]`, ...args);
  }
}

/**
 * Check if debug mode is currently enabled.
 */
export function isDebugMode(): boolean {
  return debugEnabled;
}

/**
 * Debug logging for the agent.
 * Controlled by OLLY_DEBUG environment variable.
 */

/**
 * Check if debug logging is enabled.
 * Set OLLY_DEBUG=1 or OLLY_DEBUG=true to enable.
 */
function isDebugEnabled(): boolean {
  const envValue = process.env.OLLY_DEBUG;
  return envValue === '1' || envValue === 'true';
}

// Cache the result at module load time
const DEBUG_ENABLED = isDebugEnabled();

/**
 * Log debug messages to stderr.
 * Only outputs when OLLY_DEBUG environment variable is set.
 *
 * @param args - Values to log (same as console.error)
 */
export function log(...args: unknown[]): void {
  if (DEBUG_ENABLED) {
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
  if (DEBUG_ENABLED) {
    console.error(`[${prefix}]`, ...args);
  }
}

/**
 * Check if debug mode is currently enabled.
 */
export function isDebugMode(): boolean {
  return DEBUG_ENABLED;
}

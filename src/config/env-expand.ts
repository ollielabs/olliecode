/**
 * Environment variable expansion for MCP config values.
 *
 * Supports three patterns:
 * - ${VAR}          — standard shell-style
 * - ${VAR:-default} — with fallback value
 * - {env:VAR}       — OpenCode compatibility
 *
 * Missing variables without fallbacks expand to empty string.
 */

/**
 * Expand environment variable patterns in a single string value.
 */
export function expandEnvVars(value: string): string {
  // Handle ${VAR} and ${VAR:-default}
  let result = value.replace(
    /\$\{(\w+)(?::-(.*?))?\}/g,
    (_, name: string, fallback?: string) => {
      return process.env[name] ?? fallback ?? '';
    },
  );

  // Handle {env:VAR} (OpenCode compat)
  result = result.replace(/\{env:(\w+)\}/g, (_, name: string) => {
    return process.env[name] ?? '';
  });

  return result;
}

/**
 * Expand env vars in all values of a string record.
 * Keys are left unchanged.
 */
export function expandRecord(
  record: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = expandEnvVars(value);
  }
  return result;
}

/**
 * Expand env vars in an array of strings (e.g. command args).
 */
export function expandArray(arr: string[]): string[] {
  return arr.map(expandEnvVars);
}

/**
 * JSONC parsing and write-back utilities.
 *
 * Uses jsonc-parser for:
 * - Parsing JSON with comments (JSONC)
 * - Comment-preserving writes via modify()
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  applyEdits,
  type ModificationOptions,
  modify,
  parse as parseJsonc,
} from 'jsonc-parser';
import type { ResolvedConfig } from './schema';
import { ConfigSchema } from './schema';

/** Errors from parsing a config file */
export type ParseError = {
  message: string;
  path?: string;
};

/** Result of parsing a config file */
export type ParseResult = {
  /** The raw parsed object (before validation) */
  raw: Record<string, unknown>;
  /** The validated and resolved config */
  config: ResolvedConfig;
  /** Non-fatal warnings (e.g. unknown keys, deprecated values) */
  warnings: string[];
};

/**
 * Parse a JSONC string into a raw object.
 * Returns null if the string is empty or invalid.
 */
export function parseJsoncString(
  content: string,
): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (trimmed === '') {
    return null;
  }

  const errors: import('jsonc-parser').ParseError[] = [];
  const result = parseJsonc(trimmed, errors) as unknown;

  if (errors.length > 0) {
    const errorMessages = errors
      .map((e) => `offset ${e.offset}: ${e.error}`)
      .join(', ');
    throw new Error(`Invalid JSONC: ${errorMessages}`);
  }

  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('Config must be a JSON object');
  }

  return result as Record<string, unknown>;
}

/**
 * Parse and validate a config file.
 *
 * @param filePath - Path to the config file
 * @returns ParseResult with resolved config and warnings, or null if file not found
 */
export function parseConfigFile(filePath: string): ParseResult | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, 'utf-8');
  return parseConfigString(content);
}

/**
 * Parse and validate a JSONC config string.
 */
export function parseConfigString(content: string): ParseResult {
  const warnings: string[] = [];

  const raw = parseJsoncString(content);
  if (raw === null) {
    return {
      raw: {},
      config: ConfigSchema.parse({}),
      warnings,
    };
  }

  // Check for legacy top-level "theme" key (migration hint)
  if ('theme' in raw && !('tui' in raw)) {
    warnings.push(
      'Deprecated: top-level "theme" should be moved to "tui.theme". Auto-migrating.',
    );
  }

  const result = ConfigSchema.safeParse(raw);

  if (!result.success) {
    // Collect validation errors as warnings, fall back to defaults for invalid fields
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      warnings.push(`Invalid config at "${path}": ${issue.message}`);
    }
    // Re-parse with defaults by stripping invalid fields
    const config = ConfigSchema.parse({});
    return { raw, config, warnings };
  }

  return { raw, config: result.data, warnings };
}

// === JSONC write-back ===

const MODIFY_OPTIONS: ModificationOptions = {
  formattingOptions: {
    tabSize: 2,
    insertSpaces: true,
    eol: '\n',
  },
};

/**
 * Modify a value in a JSONC string, preserving comments and formatting.
 *
 * @param content - Original JSONC content
 * @param path - JSON path segments (e.g. ["tui", "theme"])
 * @param value - New value to set
 * @returns Modified JSONC content
 */
export function modifyJsoncValue(
  content: string,
  path: string[],
  value: unknown,
): string {
  const edits = modify(content, path, value, MODIFY_OPTIONS);
  return applyEdits(content, edits);
}

/**
 * Set a value in a config file, preserving comments.
 * Creates the file if it doesn't exist.
 *
 * @param filePath - Path to the config file
 * @param path - JSON path segments (e.g. ["tui", "theme"])
 * @param value - New value to set
 */
export function setConfigFileValue(
  filePath: string,
  path: string[],
  value: unknown,
): void {
  let content = '{}';
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf-8');
  }

  const modified = modifyJsoncValue(content, path, value);
  writeFileSync(filePath, `${modified}\n`, 'utf-8');
}

/**
 * Migrate legacy config format.
 * Moves top-level "theme" to "tui.theme" and removes the old key.
 *
 * @param filePath - Path to the config file
 * @returns true if migration was performed
 */
export function migrateConfig(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  const content = readFileSync(filePath, 'utf-8');
  const raw = parseJsoncString(content);
  if (raw === null) {
    return false;
  }

  // Check for legacy top-level "theme"
  if (!('theme' in raw) || 'tui' in raw) {
    return false;
  }

  const theme = raw.theme;

  // Move theme to tui.theme, remove top-level theme
  let modified = modifyJsoncValue(content, ['tui', 'theme'], theme);
  modified = modifyJsoncValue(modified, ['theme'], undefined);

  writeFileSync(filePath, `${modified}\n`, 'utf-8');
  return true;
}

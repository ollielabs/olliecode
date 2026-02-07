/**
 * Configuration management for Ollie.
 *
 * Loads and validates config from ~/.config/ollie/config.json (JSONC).
 * Uses Zod schema for validation and jsonc-parser for comment-preserving writes.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  migrateConfig,
  type ParseResult,
  parseConfigFile,
  setConfigFileValue,
} from './parse';
import type { ResolvedConfig } from './schema';
import { ConfigSchema } from './schema';

// Re-export schema types
export type {
  AutonomyLevel,
  OllieConfig,
  PermissionValue,
  ResolvedConfig,
} from './schema';

/**
 * Get the path to the Ollie config directory.
 * Follows XDG convention: ~/.config/ollie/
 */
export function getConfigDirectory(): string {
  return join(homedir(), '.config', 'ollie');
}

/**
 * Get the path to the global config file.
 */
export function getConfigPath(): string {
  return join(getConfigDirectory(), 'config.json');
}

/**
 * Ensure the config directory exists.
 */
function ensureConfigDirectory(): void {
  const dir = getConfigDirectory();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load and validate the global config file.
 * Runs migration for legacy format, validates with Zod schema.
 *
 * @returns Parsed config with warnings, or defaults if file missing/invalid
 */
export function loadConfig(): ParseResult {
  const configPath = getConfigPath();

  // Run migration before parsing
  migrateConfig(configPath);

  const result = parseConfigFile(configPath);
  if (result === null) {
    return {
      raw: {},
      config: ConfigSchema.parse({}),
      warnings: [],
    };
  }

  return result;
}

/**
 * Get the resolved config with all defaults applied.
 */
export function getResolvedConfig(): ResolvedConfig {
  return loadConfig().config;
}

/**
 * Set a config value in the global config file.
 * Preserves comments and formatting via jsonc-parser modify().
 *
 * @param path - JSON path segments (e.g. ["tui", "theme"])
 * @param value - Value to set
 */
export function setConfigValue(path: string[], value: unknown): void {
  ensureConfigDirectory();
  setConfigFileValue(getConfigPath(), path, value);
}

/**
 * Get a specific top-level config value.
 * Provided for backward compatibility.
 *
 * @deprecated Use getResolvedConfig() instead for typed access.
 */
export function getConfigValueLegacy(key: string): unknown {
  const config = getResolvedConfig();
  return config[key as keyof ResolvedConfig];
}

/**
 * Configuration management for Ollie.
 *
 * Loads and validates config from multiple sources with precedence:
 * global (~/.config/ollie/config.json) -> project (ollie.json) -> custom -> CLI
 *
 * Uses Zod schema for validation and jsonc-parser for comment-preserving writes.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { type MergedConfigResult, mergeConfigs } from './merge';
import { migrateConfig, parseConfigFile, setConfigFileValue } from './parse';
import type { ResolvedConfig } from './schema';
import { ConfigSchema } from './schema';

// Re-export merge types
export type { ConfigLayer, ConfigSource, MergedConfigResult } from './merge';
export { buildCliOverrides } from './merge';
export type { ToolPermissionMap, TuiConfig } from './resolve';
// Re-export resolve functions
export {
  deriveSubagentConfig,
  extractAgentConfig,
  extractAgentRegistry,
  extractCompactionConfig,
  extractSafetyConfig,
  extractToolsConfig,
  extractTuiConfig,
  resolvePermissions,
} from './resolve';
// Re-export schema types
export type {
  AutonomyLevel,
  OllieConfig,
  PermissionValue,
  ResolvedConfig,
} from './schema';

/**
 * Get the path to the Ollie config directory.
 * Follows XDG Base Directory Specification:
 * $XDG_CONFIG_HOME/ollie/ (default: ~/.config/ollie/)
 */
export function getConfigDirectory(): string {
  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdgConfigHome, 'ollie');
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
 * Load the global config file (with migration).
 * Returns raw parsed object for merging.
 */
function loadGlobalConfigRaw(): Record<string, unknown> {
  const configPath = getConfigPath();

  // Run migration before parsing
  migrateConfig(configPath);

  const result = parseConfigFile(configPath);
  return result?.raw ?? {};
}

/**
 * Load and merge all config sources.
 *
 * @param projectRoot - Project root directory (for project config lookup)
 * @param customConfigPath - Optional custom config path (--config or OLLIE_CONFIG)
 * @param cliOverrides - CLI overrides (only explicitly-set flags)
 * @returns Merged config result with all layers and warnings
 */
export function loadMergedConfig(
  projectRoot: string,
  customConfigPath?: string,
  cliOverrides?: Record<string, unknown>,
): MergedConfigResult {
  const globalRaw = loadGlobalConfigRaw();

  // Check OLLIE_CONFIG env var as fallback for custom path
  const effectiveCustomPath =
    customConfigPath ?? process.env.OLLIE_CONFIG ?? undefined;

  // OLLAMA_HOST env var is the highest-precedence host override,
  // winning even over explicit --host CLI flag.
  const envHost = process.env.OLLAMA_HOST;
  const effectiveCliOverrides = envHost
    ? { ...(cliOverrides ?? {}), host: envHost }
    : cliOverrides;

  return mergeConfigs(
    globalRaw,
    projectRoot,
    effectiveCustomPath,
    effectiveCliOverrides,
  );
}

/**
 * Get the resolved config with all defaults applied.
 * Convenience method for single-source (global only) loading.
 */
export function getResolvedConfig(): ResolvedConfig {
  const globalRaw = loadGlobalConfigRaw();
  const result = ConfigSchema.safeParse(globalRaw);
  return result.success ? result.data : ConfigSchema.parse({});
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

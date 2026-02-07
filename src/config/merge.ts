/**
 * Config merging logic.
 *
 * Deep merges multiple config sources with proper precedence:
 * global -> project -> env/custom -> CLI overrides
 *
 * Special behaviors:
 * - `instructions` arrays are concatenated and deduplicated
 * - All other arrays are replaced by later sources
 * - Nested objects are deep merged (not replaced entirely)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseConfigFile } from './parse';
import type { ResolvedConfig } from './schema';
import { ConfigSchema } from './schema';

/** Tracks which source a config was loaded from */
export type ConfigSource = 'default' | 'global' | 'project' | 'custom' | 'cli';

/** A loaded config layer with its source */
export type ConfigLayer = {
  source: ConfigSource;
  path?: string;
  raw: Record<string, unknown>;
  warnings: string[];
};

/** Result of loading and merging all config sources */
export type MergedConfigResult = {
  /** Fully resolved config with all defaults */
  config: ResolvedConfig;
  /** All layers that were loaded (in precedence order) */
  layers: ConfigLayer[];
  /** All warnings from all sources */
  warnings: string[];
};

/**
 * Delete a value at a nested path in an object.
 * Used to strip invalid fields during partial recovery.
 */
function deleteAtPath(obj: Record<string, unknown>, path: string[]): void {
  if (path.length === 0) return;
  if (path.length === 1) {
    delete obj[path[0] as string];
    return;
  }
  const [head, ...rest] = path;
  const child = obj[head as string];
  if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
    deleteAtPath(child as Record<string, unknown>, rest);
  }
}

/**
 * Check if a value is a plain object (not array, not null).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep merge two config objects.
 *
 * - Nested objects are recursively merged
 * - `instructions` arrays are concatenated and deduplicated
 * - All other arrays are replaced by the later source
 * - Primitives are replaced by the later source
 */
export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };

  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overrideVal = override[key];

    if (key === 'instructions' && Array.isArray(overrideVal)) {
      // Concatenate and deduplicate instructions
      const baseArr = Array.isArray(baseVal) ? baseVal : [];
      const combined = [...baseArr, ...overrideVal];
      result[key] = [...new Set(combined)];
    } else if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      // Deep merge nested objects
      result[key] = deepMerge(baseVal, overrideVal);
    } else {
      // Replace (arrays, primitives, etc.)
      result[key] = overrideVal;
    }
  }

  return result;
}

/**
 * Load the project-level config file.
 * Looks for `ollie.json` in the given project root.
 *
 * @param projectRoot - Project root directory
 * @returns ConfigLayer or null if not found
 */
export function loadProjectConfig(projectRoot: string): ConfigLayer | null {
  const configPath = join(projectRoot, 'ollie.json');

  const result = parseConfigFile(configPath);
  if (result === null) {
    return null;
  }

  return {
    source: 'project',
    path: configPath,
    raw: result.raw,
    warnings: result.warnings,
  };
}

/**
 * Load a custom config file from a given path.
 *
 * @param configPath - Path to the config file
 * @returns ConfigLayer or null if not found
 */
export function loadCustomConfig(configPath: string): ConfigLayer | null {
  if (!existsSync(configPath)) {
    return null;
  }

  const result = parseConfigFile(configPath);
  if (result === null) {
    return null;
  }

  return {
    source: 'custom',
    path: configPath,
    raw: result.raw,
    warnings: result.warnings,
  };
}

/**
 * Build a CLI overrides object from explicitly-provided CLI options.
 *
 * Only includes keys where the user explicitly passed a flag.
 * Uses Commander's `getOptionValueSource()` to distinguish
 * explicit args from defaults.
 *
 * @param options - Parsed CLI options object
 * @param getSource - Function to check option source (from Commander)
 * @returns Partial config with only explicitly-set values
 */
export function buildCliOverrides(
  options: Record<string, unknown>,
  getSource: (key: string) => string | undefined,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  // Map CLI flag names to config keys
  const cliToConfig: Record<string, string> = {
    model: 'model',
    host: 'host',
    autonomy: 'autonomy',
    debug: 'debug',
  };

  for (const [cliKey, configKey] of Object.entries(cliToConfig)) {
    const source = getSource(cliKey);
    // Only include if explicitly set via CLI (not default)
    if (source === 'cli') {
      overrides[configKey] = options[cliKey];
    }
  }

  return overrides;
}

/**
 * Load and merge all config sources.
 *
 * Precedence (lowest to highest):
 * 1. Schema defaults
 * 2. Global config (~/.config/ollie/config.json)
 * 3. Project config (<project>/ollie.json)
 * 4. Custom config (OLLIE_CONFIG env var or --config flag)
 * 5. CLI flags (only explicitly provided ones)
 *
 * @param globalRaw - Raw global config (already loaded)
 * @param projectRoot - Project root directory
 * @param customConfigPath - Optional custom config path
 * @param cliOverrides - CLI overrides (only explicitly-set flags)
 */
export function mergeConfigs(
  globalRaw: Record<string, unknown>,
  projectRoot: string,
  customConfigPath?: string,
  cliOverrides?: Record<string, unknown>,
): MergedConfigResult {
  const layers: ConfigLayer[] = [];
  const warnings: string[] = [];

  // Layer 1: Global config
  layers.push({
    source: 'global',
    raw: globalRaw,
    warnings: [],
  });

  // Start with global raw
  let merged = { ...globalRaw };

  // Layer 2: Project config
  const projectLayer = loadProjectConfig(projectRoot);
  if (projectLayer) {
    layers.push(projectLayer);
    warnings.push(...projectLayer.warnings);
    merged = deepMerge(merged, projectLayer.raw);
  }

  // Layer 3: Custom config (OLLIE_CONFIG or --config)
  if (customConfigPath) {
    const customLayer = loadCustomConfig(customConfigPath);
    if (customLayer) {
      layers.push(customLayer);
      warnings.push(...customLayer.warnings);
      merged = deepMerge(merged, customLayer.raw);
    } else {
      warnings.push(`Custom config not found: ${customConfigPath}`);
    }
  }

  // Layer 4: CLI overrides
  if (cliOverrides && Object.keys(cliOverrides).length > 0) {
    layers.push({
      source: 'cli',
      raw: cliOverrides,
      warnings: [],
    });
    merged = deepMerge(merged, cliOverrides);
  }

  // Validate merged result through Zod schema
  const result = ConfigSchema.safeParse(merged);

  if (!result.success) {
    // Strip only the invalid fields and re-parse to preserve valid settings
    const stripped = structuredClone(merged);
    for (const issue of result.error.issues) {
      const path = issue.path.map(String);
      warnings.push(
        `Invalid merged config at "${path.join('.')}": ${issue.message} (using default)`,
      );
      deleteAtPath(stripped, path);
    }
    return {
      config: ConfigSchema.parse(stripped),
      layers,
      warnings,
    };
  }

  return {
    config: result.data,
    layers,
    warnings,
  };
}

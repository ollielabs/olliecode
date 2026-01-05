/**
 * Configuration management for Olly.
 * Stores user settings in ~/.config/olly/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Configuration schema
 */
export type Config = {
  /** Selected theme ID */
  theme?: string;
};

const DEFAULT_CONFIG: Config = {};

/**
 * Get the path to the Olly config directory.
 * Follows XDG convention: ~/.config/olly/
 */
export function getConfigDirectory(): string {
  return join(homedir(), '.config', 'olly');
}

/**
 * Get the path to the config file.
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
 * Load configuration from disk.
 * Returns default config if file doesn't exist or is invalid.
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<Config>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    // Invalid JSON or read error - return defaults
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save configuration to disk.
 */
export function saveConfig(config: Config): void {
  ensureConfigDirectory();
  const configPath = getConfigPath();
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

/**
 * Update specific config values (merges with existing).
 */
export function updateConfig(updates: Partial<Config>): void {
  const current = loadConfig();
  saveConfig({ ...current, ...updates });
}

/**
 * Get a specific config value.
 */
export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  return loadConfig()[key];
}

/**
 * Set a specific config value.
 */
export function setConfigValue<K extends keyof Config>(
  key: K,
  value: Config[K],
): void {
  updateConfig({ [key]: value });
}

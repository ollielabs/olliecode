/**
 * Theme registry - exports all available themes and lookup utilities.
 */

import type { Theme } from '../tokens';

import { ollyTheme } from './olly';
import { draculaTheme } from './dracula';
import { tokyoNightTheme } from './tokyo-night';
import { nordTheme } from './nord';
import { catppuccinTheme } from './catppuccin';
import { monokaiTheme } from './monokai';

// Re-export individual themes
export { ollyTheme } from './olly';
export { draculaTheme } from './dracula';
export { tokyoNightTheme } from './tokyo-night';
export { nordTheme } from './nord';
export { catppuccinTheme } from './catppuccin';
export { monokaiTheme } from './monokai';

/**
 * All available themes indexed by ID
 */
export const themes: Record<string, Theme> = {
  olly: ollyTheme,
  dracula: draculaTheme,
  'tokyo-night': tokyoNightTheme,
  nord: nordTheme,
  catppuccin: catppuccinTheme,
  monokai: monokaiTheme,
};

/**
 * Default theme ID
 */
export const DEFAULT_THEME_ID = 'olly';

/**
 * Get a theme by ID, falling back to default if not found
 */
export function getTheme(themeId: string): Theme {
  return themes[themeId] ?? themes[DEFAULT_THEME_ID] ?? ollyTheme;
}

/**
 * Get list of all available theme IDs
 */
export function getThemeIds(): string[] {
  return Object.keys(themes);
}

/**
 * Get list of all themes with their names
 */
export function getThemeList(): Array<{ id: string; name: string }> {
  return Object.values(themes).map((theme) => ({
    id: theme.id,
    name: theme.name,
  }));
}

/**
 * Ollie Design System
 *
 * Provides theming, design tokens, and styled component patterns.
 */

// Token types
export type {
  HexColor,
  SemanticTokens,
  ThemeSeed,
  ThemeVariant,
  Theme,
} from './tokens';

// Color utilities
export {
  hexToRgb,
  rgbToHex,
  hexToOklch,
  oklchToHex,
  generateScale,
  generateNeutralScale,
  mixColors,
  lighten,
  darken,
  withAlpha,
  adjustChroma,
} from './color';
export type { OklchColor } from './color';

// Theme system
export {
  resolveThemeVariant,
  resolveTheme,
  createSyntaxStyle,
  ThemeContext,
  useTheme,
  detectColorScheme,
} from './theme';
export type { ThemeContextValue } from './theme';

// Theme Provider
export { ThemeProvider } from './ThemeProvider';
export type { ThemeProviderProps } from './ThemeProvider';

// Themes
export {
  themes,
  DEFAULT_THEME_ID,
  getTheme,
  getThemeIds,
  getThemeList,
  ollieTheme,
  draculaTheme,
  tokyoNightTheme,
  nordTheme,
  catppuccinTheme,
  monokaiTheme,
} from './themes';

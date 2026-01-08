/**
 * Theme resolver and React context for the Ollie design system.
 */

import { createContext, useContext } from 'react';
import { SyntaxStyle, RGBA } from '@opentui/core';

import type { Theme, ThemeVariant, SemanticTokens, HexColor } from './tokens';
import { generateScale, generateNeutralScale, withAlpha } from './color';

// Default fallback color (should never be used with valid scales)
const FALLBACK = '#888888' as HexColor;

/** Safe scale access - returns fallback if index is out of bounds */
const s = (scale: HexColor[], idx: number): HexColor => scale[idx] ?? FALLBACK;

/**
 * Resolve a theme variant (dark or light) into semantic tokens.
 * Generates full color scales from seed colors and applies overrides.
 */
export function resolveThemeVariant(
  variant: ThemeVariant,
  isDark: boolean,
): SemanticTokens {
  const { seeds, overrides = {} } = variant;

  // Generate color scales from seeds
  const neutral = generateNeutralScale(seeds.neutral, isDark);
  const primary = generateScale(seeds.primary, isDark);
  const success = generateScale(seeds.success, isDark);
  const warning = generateScale(seeds.warning, isDark);
  const error = generateScale(seeds.error, isDark);
  const info = generateScale(seeds.info, isDark);

  // Build semantic tokens from scales
  // Scale indices: 0-2 = very light/dark, 3-5 = light/dark, 6-7 = mid, 8-9 = base, 10-11 = strong
  const tokens: SemanticTokens = {
    // Backgrounds
    bgBase: s(neutral, 0),
    bgSurface: s(neutral, isDark ? 1 : 0),
    bgSurfaceHover: s(neutral, 2),
    bgOverlay: withAlpha(s(neutral, 0), 0.85),
    bgInput: s(neutral, isDark ? 3 : 1), // Slightly lighter than bgSurface

    // Text
    textBase: s(neutral, 10),
    textMuted: s(neutral, 8),
    textSubtle: s(neutral, 6),
    textAccent: s(primary, isDark ? 9 : 8),
    textInverse: s(neutral, isDark ? 0 : 11),

    // Borders
    borderBase: s(neutral, isDark ? 4 : 5),
    borderMuted: s(neutral, isDark ? 3 : 4),
    borderAccent: s(primary, isDark ? 7 : 6),
    borderStrong: s(neutral, isDark ? 6 : 7),

    // Interactive
    primaryBase: s(primary, 8),
    primaryHover: s(primary, 9),
    primaryMuted: s(primary, isDark ? 2 : 3),
    secondaryBase: s(neutral, isDark ? 3 : 2),
    secondaryHover: s(neutral, isDark ? 4 : 3),
    selected: s(primary, isDark ? 2 : 3),

    // Status
    success: s(success, isDark ? 9 : 8),
    successMuted: s(success, isDark ? 2 : 3),
    warning: s(warning, isDark ? 9 : 8),
    warningMuted: s(warning, isDark ? 2 : 3),
    error: s(error, isDark ? 9 : 8),
    errorMuted: s(error, isDark ? 2 : 3),
    info: s(info, isDark ? 9 : 8),
    infoMuted: s(info, isDark ? 2 : 3),

    // Diff
    diffAdd: s(success, isDark ? 9 : 8),
    diffAddBg: s(success, isDark ? 1 : 2),
    diffDelete: s(error, isDark ? 9 : 8),
    diffDeleteBg: s(error, isDark ? 1 : 2),

    // Syntax highlighting
    syntaxKeyword: s(primary, isDark ? 8 : 7),
    syntaxString: s(success, isDark ? 9 : 7),
    syntaxNumber: s(warning, isDark ? 9 : 8),
    syntaxComment: s(neutral, 6),
    syntaxFunction: s(primary, isDark ? 10 : 9),
    syntaxVariable: s(neutral, 10),
    syntaxType: s(warning, isDark ? 8 : 7),
    syntaxProperty: s(info, isDark ? 9 : 8),
    syntaxOperator: s(neutral, 8),
    syntaxPunctuation: s(neutral, 7),
    syntaxConstant: s(error, isDark ? 8 : 7),
    syntaxDefault: s(neutral, 10),
  };

  // Apply any theme-specific overrides
  return { ...tokens, ...overrides };
}

/**
 * Resolve a complete theme into dark and light token sets.
 */
export function resolveTheme(theme: Theme): {
  dark: SemanticTokens;
  light: SemanticTokens;
} {
  return {
    dark: resolveThemeVariant(theme.dark, true),
    light: resolveThemeVariant(theme.light, false),
  };
}

/**
 * Create a SyntaxStyle from semantic tokens for use with <code> component.
 */
export function createSyntaxStyle(tokens: SemanticTokens): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    keyword: { fg: RGBA.fromHex(tokens.syntaxKeyword) },
    string: { fg: RGBA.fromHex(tokens.syntaxString) },
    number: { fg: RGBA.fromHex(tokens.syntaxNumber) },
    comment: { fg: RGBA.fromHex(tokens.syntaxComment), italic: true },
    function: { fg: RGBA.fromHex(tokens.syntaxFunction) },
    'function.method': { fg: RGBA.fromHex(tokens.syntaxFunction) },
    variable: { fg: RGBA.fromHex(tokens.syntaxVariable) },
    'variable.builtin': { fg: RGBA.fromHex(tokens.syntaxConstant) },
    type: { fg: RGBA.fromHex(tokens.syntaxType) },
    'type.builtin': { fg: RGBA.fromHex(tokens.syntaxType) },
    property: { fg: RGBA.fromHex(tokens.syntaxProperty) },
    'property.definition': { fg: RGBA.fromHex(tokens.syntaxProperty) },
    operator: { fg: RGBA.fromHex(tokens.syntaxOperator) },
    punctuation: { fg: RGBA.fromHex(tokens.syntaxPunctuation) },
    'punctuation.bracket': { fg: RGBA.fromHex(tokens.syntaxPunctuation) },
    'punctuation.delimiter': { fg: RGBA.fromHex(tokens.syntaxPunctuation) },
    constant: { fg: RGBA.fromHex(tokens.syntaxConstant) },
    'constant.builtin': { fg: RGBA.fromHex(tokens.syntaxConstant) },
    boolean: { fg: RGBA.fromHex(tokens.syntaxConstant) },
    label: { fg: RGBA.fromHex(tokens.syntaxProperty) },
    namespace: { fg: RGBA.fromHex(tokens.syntaxType) },
    module: { fg: RGBA.fromHex(tokens.syntaxType) },
    tag: { fg: RGBA.fromHex(tokens.syntaxKeyword) },
    attribute: { fg: RGBA.fromHex(tokens.syntaxProperty) },
    heading: { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    'text.title': { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    'text.emphasis': { fg: RGBA.fromHex(tokens.syntaxString), italic: true },
    'text.strong': { fg: RGBA.fromHex(tokens.syntaxString), bold: true },
    'text.literal': { fg: RGBA.fromHex(tokens.syntaxString) },
    'text.uri': { fg: RGBA.fromHex(tokens.syntaxProperty), underline: true },
    'text.reference': { fg: RGBA.fromHex(tokens.syntaxProperty) },
    default: { fg: RGBA.fromHex(tokens.syntaxDefault) },
  });
}

/**
 * Theme context value
 */
export type ThemeContextValue = {
  theme: Theme;
  themeId: string;
  tokens: SemanticTokens;
  isDark: boolean;
  syntaxStyle: SyntaxStyle;
  setTheme: (themeId: string) => void;
};

/**
 * React context for theme access
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Hook to access the current theme
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Hook to get styled values from a style factory function.
 * This is the primary way to get themed styles in components.
 *
 * @example
 * const styles = useStyles(createInputBoxStyles);
 * return <box style={styles.container} />;
 */
export function useStyles<T>(factory: (tokens: SemanticTokens) => T): T {
  const { tokens } = useTheme();
  return factory(tokens);
}

/**
 * Detect if the terminal is in dark mode.
 * Falls back to dark mode if detection fails.
 */
export function detectColorScheme(): 'dark' | 'light' {
  // Check COLORFGBG environment variable (format: "fg;bg")
  // Low bg values typically indicate dark mode
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(';');
    const bg = parseInt(parts[1] ?? '', 10);
    if (!Number.isNaN(bg)) {
      // Standard terminal colors: 0-7 are "dark", 8-15 are "light"
      // Background < 8 typically means dark background
      return bg < 8 ? 'dark' : 'light';
    }
  }

  // Most modern terminals default to dark mode
  // Default to dark as it's the most common for developer terminals
  return 'dark';
}

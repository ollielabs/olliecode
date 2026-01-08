/**
 * Design token type definitions for the Ollie theme system.
 * Tokens are semantic color values derived from theme seeds.
 */

/**
 * Hex color string type
 */
export type HexColor = `#${string}`;

/**
 * Semantic design tokens generated from theme seeds.
 * These tokens are used throughout the UI for consistent styling.
 */
export type SemanticTokens = {
  // Backgrounds
  bgBase: string; // Main app background
  bgSurface: string; // Elevated surfaces (panels, modals)
  bgSurfaceHover: string; // Surface hover state
  bgOverlay: string; // Modal backdrops (semi-transparent)
  bgInput: string; // Input field backgrounds

  // Text
  textBase: string; // Primary text
  textMuted: string; // Secondary/dimmed text
  textSubtle: string; // Tertiary (hints, placeholders)
  textAccent: string; // Highlighted/accent text
  textInverse: string; // Text on accent backgrounds

  // Borders
  borderBase: string; // Default borders
  borderMuted: string; // Subtle borders
  borderAccent: string; // Focused/active borders
  borderStrong: string; // Emphasized borders

  // Interactive
  primaryBase: string; // Primary accent color
  primaryHover: string; // Primary hover state
  primaryMuted: string; // Primary at reduced intensity
  secondaryBase: string; // Secondary actions
  secondaryHover: string; // Secondary hover
  selected: string; // Selected item background

  // Status
  success: string; // Success color
  successMuted: string; // Success background/muted
  warning: string; // Warning color
  warningMuted: string; // Warning background/muted
  error: string; // Error color
  errorMuted: string; // Error background/muted
  info: string; // Info color
  infoMuted: string; // Info background/muted

  // Diff
  diffAdd: string; // Added text/line color
  diffAddBg: string; // Added line background
  diffDelete: string; // Deleted text/line color
  diffDeleteBg: string; // Deleted line background

  // Syntax highlighting
  syntaxKeyword: string; // Keywords (if, else, return, function)
  syntaxString: string; // String literals
  syntaxNumber: string; // Numeric literals
  syntaxComment: string; // Comments
  syntaxFunction: string; // Function names
  syntaxVariable: string; // Variables
  syntaxType: string; // Type annotations
  syntaxProperty: string; // Object properties
  syntaxOperator: string; // Operators (+, -, =, etc.)
  syntaxPunctuation: string; // Brackets, semicolons
  syntaxConstant: string; // Constants (true, false, null)
  syntaxDefault: string; // Default/fallback text
};

/**
 * Theme seed colors used to generate the full token palette.
 * Each seed is expanded into a color scale via OKLCH.
 */
export type ThemeSeed = {
  neutral: HexColor; // Base gray/neutral color
  primary: HexColor; // Brand/accent color
  success: HexColor; // Success/positive color
  warning: HexColor; // Warning/caution color
  error: HexColor; // Error/danger color
  info: HexColor; // Info/neutral accent color
};

/**
 * Theme variant containing seeds and optional token overrides.
 */
export type ThemeVariant = {
  seeds: ThemeSeed;
  overrides?: Partial<SemanticTokens>;
};

/**
 * Complete theme definition with dark and light variants.
 */
export type Theme = {
  id: string;
  name: string;
  dark: ThemeVariant;
  light: ThemeVariant;
};

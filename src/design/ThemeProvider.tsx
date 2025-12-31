/**
 * ThemeProvider component - wraps app and provides theme context
 */

import { useState, useMemo, useCallback, type ReactNode } from "react";

import {
  ThemeContext,
  resolveThemeVariant,
  createSyntaxStyle,
  detectColorScheme,
  type ThemeContextValue,
} from "./theme";
import { getTheme, DEFAULT_THEME_ID } from "./themes";
import type { Theme, SemanticTokens } from "./tokens";

export type ThemeProviderProps = {
  children: ReactNode;
  /** Initial theme ID (defaults to "olly") */
  initialTheme?: string;
  /** Force dark or light mode (defaults to auto-detect) */
  colorScheme?: "dark" | "light";
};

export function ThemeProvider({
  children,
  initialTheme = DEFAULT_THEME_ID,
  colorScheme,
}: ThemeProviderProps) {
  const [themeId, setThemeId] = useState(initialTheme);

  // Detect color scheme or use override
  const isDark = colorScheme ? colorScheme === "dark" : detectColorScheme() === "dark";

  // Resolve the current theme
  const contextValue = useMemo<ThemeContextValue>(() => {
    const theme = getTheme(themeId);
    const variant = isDark ? theme.dark : theme.light;
    const tokens = resolveThemeVariant(variant, isDark);
    const syntaxStyle = createSyntaxStyle(tokens);

    return {
      theme,
      themeId,
      tokens,
      isDark,
      syntaxStyle,
      setTheme: setThemeId,
    };
  }, [themeId, isDark]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

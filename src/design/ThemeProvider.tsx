/**
 * ThemeProvider component - wraps app and provides theme context
 *
 * Uses a Solid store for the context value so that consumers who destructure
 * (e.g. `const { tokens } = useTheme()`) get a reactive proxy. Reading
 * `tokens.bgBase` inside JSX or createEffect automatically subscribes to
 * changes when the theme is switched.
 */

import { createSignal, createMemo, createEffect, type JSX } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';

import {
  ThemeContext,
  resolveThemeVariant,
  createSyntaxStyle,
  detectColorScheme,
  type ThemeContextValue,
} from './theme';
import { getTheme, DEFAULT_THEME_ID } from './themes';

export type ThemeProviderProps = {
  children: JSX.Element;
  /** Initial theme ID (defaults to "ollie") */
  initialTheme?: string;
  /** Force dark or light mode (defaults to auto-detect) */
  colorScheme?: 'dark' | 'light';
};

export function ThemeProvider(props: ThemeProviderProps) {
  const [themeId, setThemeId] = createSignal(
    props.initialTheme ?? DEFAULT_THEME_ID,
  );

  // Detect color scheme or use override
  const isDark = props.colorScheme
    ? props.colorScheme === 'dark'
    : detectColorScheme() === 'dark';

  // Resolve the current theme (recomputes when themeId signal changes)
  const resolved = createMemo(() => {
    const id = themeId();
    const theme = getTheme(id);
    const variant = isDark ? theme.dark : theme.light;
    const tokens = resolveThemeVariant(variant, isDark);
    const syntaxStyle = createSyntaxStyle(tokens);
    return { theme, id, tokens, isDark, syntaxStyle };
  });

  // Build initial context value
  const initial = resolved();
  const [store, setStore] = createStore<ThemeContextValue>({
    theme: initial.theme,
    themeId: initial.id,
    tokens: initial.tokens,
    isDark: initial.isDark,
    syntaxStyle: initial.syntaxStyle,
    setTheme: setThemeId,
  });

  // Sync the store when the resolved theme changes.
  // Use `reconcile` for tokens (plain object of strings — safe for deep diff)
  // but assign theme/syntaxStyle directly (class instances that reconcile
  // would mangle).
  createEffect(() => {
    const r = resolved();
    setStore(
      produce((s) => {
        s.theme = r.theme;
        s.themeId = r.id;
        s.isDark = r.isDark;
        s.syntaxStyle = r.syntaxStyle;
      }),
    );
    // Reconcile tokens separately — this is a flat Record<string, string>
    // so reconcile does a clean key-by-key diff, only notifying subscribers
    // of tokens whose hex values actually changed.
    setStore('tokens', reconcile(r.tokens));
  });

  return (
    <ThemeContext.Provider value={store}>
      {props.children}
    </ThemeContext.Provider>
  );
}

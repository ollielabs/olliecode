/**
 * ThemeProvider component - wraps app and provides theme context
 *
 * Uses a Solid store for the context value so that consumers who destructure
 * (e.g. `const { tokens } = useTheme()`) get a reactive proxy. Reading
 * `tokens.bgBase` inside JSX or createEffect automatically subscribes to
 * changes when the theme is switched.
 *
 * Dark/light detection uses the renderer's native Mode 2031 terminal query
 * (via `renderer.themeMode`) which works on iTerm2, Ghostty, Kitty, WezTerm,
 * Windows Terminal, and most modern emulators. Auto-switches when the terminal
 * theme changes without requiring a restart.
 */

import {
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  type JSX,
} from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import { useRenderer } from '@opentui/solid';

import {
  ThemeContext,
  resolveThemeVariant,
  createSyntaxStyle,
  type ThemeContextValue,
} from './theme';
import { getTheme, DEFAULT_THEME_ID } from './themes';

export type ThemeProviderProps = {
  children: JSX.Element;
  /** Initial theme ID (defaults to "ollie") */
  initialTheme?: string;
  /** Force dark or light mode (overrides auto-detection). Manual selection wins. */
  colorScheme?: 'dark' | 'light';
};

export function ThemeProvider(props: ThemeProviderProps) {
  const renderer = useRenderer();

  const [themeId, setThemeId] = createSignal(
    props.initialTheme ?? DEFAULT_THEME_ID,
  );

  // Manual override signal — when the user explicitly picks a color scheme
  const [manualScheme, setManualScheme] = createSignal<'dark' | 'light' | null>(
    props.colorScheme ?? null,
  );

  // Detected scheme from the terminal (via renderer.themeMode / Mode 2031)
  const [detectedScheme, setDetectedScheme] = createSignal<'dark' | 'light'>(
    renderer.themeMode ?? 'dark',
  );

  // Listen for terminal theme changes (auto-switches without restart)
  onMount(() => {
    const handler = (mode: 'dark' | 'light') => {
      setDetectedScheme(mode);
    };
    renderer.on('theme_mode', handler);
    onCleanup(() => {
      renderer.off('theme_mode', handler);
    });
  });

  // Effective color scheme: manual override > detected > dark fallback
  const isDark = createMemo(() => {
    const manual = manualScheme();
    if (manual) return manual === 'dark';
    return detectedScheme() === 'dark';
  });

  // Resolve the current theme (recomputes when themeId or isDark changes)
  const resolved = createMemo(() => {
    const id = themeId();
    const dark = isDark();
    const theme = getTheme(id);
    const variant = dark ? theme.dark : theme.light;
    const tokens = resolveThemeVariant(variant, dark);
    const syntaxStyle = createSyntaxStyle(tokens);
    return { theme, id, tokens, isDark: dark, syntaxStyle };
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

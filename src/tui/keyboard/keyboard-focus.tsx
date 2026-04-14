/**
 * Keyboard focus stack system.
 *
 * Replaces the brittle `isModalOpen` prop-threading pattern with a
 * stack-based focus model.  Only the topmost layer (plus any layers
 * marked `global`) receive keyboard events.
 *
 * Usage:
 *   <KeyboardFocusProvider>        — wrap the app once
 *   useFocusLayer("modal")         — push/pop on mount/cleanup
 *   useScopedKeyboard("modal", h)  — gated useKeyboard
 *   useScopedKeyboard("base", h, { global: true })  — always fires
 */

import { useKeyboard } from '@opentui/solid';
import {
  createContext,
  createSignal,
  onCleanup,
  useContext,
  type JSX,
} from 'solid-js';

// ---------------------------------------------------------------------------
// Layer IDs
// ---------------------------------------------------------------------------

/** Well-known focus layer identifiers. */
export const FocusLayer = {
  /** Global shortcuts (Ctrl+K, Ctrl+Y, Ctrl+P) — always fires via `{ global: true }`. */
  BASE: 'base',
  /** Default app layer — textarea monitors, mode toggle, confirmation Y/N/A. */
  APP: 'app',
  /** Full-screen modal (SessionPicker, ThemePicker, ConfigModal, etc.). */
  MODAL: 'modal',
  /** Slash command overlay above the textarea. */
  COMMAND_MENU: 'command-menu',
  /** @ file-mention overlay above the textarea. */
  FILE_PICKER: 'file-picker',
} as const;

export type FocusLayerId = (typeof FocusLayer)[keyof typeof FocusLayer];

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type KeyboardFocusContextValue = {
  /** Push a layer onto the focus stack (called on mount). */
  push: (layerId: string) => void;
  /** Remove a layer from the focus stack (called on cleanup). */
  pop: (layerId: string) => void;
  /** Returns true when `layerId` is the topmost layer. */
  isActive: (layerId: string) => boolean;
  /** The current topmost layer id. */
  activeLayer: () => string | undefined;
};

const KeyboardFocusContext = createContext<KeyboardFocusContextValue>();

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function KeyboardFocusProvider(props: { children: JSX.Element }) {
  const [stack, setStack] = createSignal<string[]>([]);

  const push = (layerId: string) => {
    setStack((prev) => [...prev, layerId]);
  };

  const pop = (layerId: string) => {
    setStack((prev) => {
      // Remove the *last* occurrence of layerId (in case of duplicates).
      const idx = prev.lastIndexOf(layerId);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  };

  const activeLayer = () => {
    const s = stack();
    return s.length > 0 ? s[s.length - 1] : undefined;
  };

  const isActive = (layerId: string) => activeLayer() === layerId;

  const ctx: KeyboardFocusContextValue = {
    push,
    pop,
    isActive,
    activeLayer,
  };

  return (
    <KeyboardFocusContext.Provider value={ctx}>
      {props.children}
    </KeyboardFocusContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useFocusContext(): KeyboardFocusContextValue {
  const ctx = useContext(KeyboardFocusContext);
  if (!ctx) {
    throw new Error(
      'useFocusLayer / useScopedKeyboard must be used inside <KeyboardFocusProvider>',
    );
  }
  return ctx;
}

/**
 * Register a focus layer that auto-pushes on mount and pops on cleanup.
 * Returns `isActive()` — true when this layer is the topmost.
 */
export function useFocusLayer(layerId: FocusLayerId): () => boolean {
  const ctx = useFocusContext();
  ctx.push(layerId);
  onCleanup(() => ctx.pop(layerId));
  return () => ctx.isActive(layerId);
}

/**
 * A scoped version of `useKeyboard` from @opentui/solid.
 *
 * The handler only fires when `layerId` is the active (topmost) focus layer,
 * unless `opts.global` is true — in which case it always fires.
 *
 * **Does NOT push/pop a layer.** Pair with `useFocusLayer` in components
 * that own a layer (e.g. Modal), or use the same layerId as an ancestor
 * that already called `useFocusLayer`.
 */
export function useScopedKeyboard(
  layerId: FocusLayerId,
  handler: (key: {
    name?: string;
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
  }) => void,
  opts?: { global?: boolean },
): void {
  const ctx = useFocusContext();

  useKeyboard(
    (key: {
      name?: string;
      ctrl?: boolean;
      shift?: boolean;
      meta?: boolean;
    }) => {
      if (opts?.global || ctx.isActive(layerId)) {
        handler(key);
      }
    },
  );
}

/**
 * Hook for global keyboard shortcuts.
 * Handles Tab (mode toggle), double-Escape (abort), Ctrl+K (debug), Ctrl+E (expand tools),
 * and Ctrl+Y (copy selected text).
 *
 * In Solid, signal accessors always return current values — no ref-mirror pattern needed.
 */

import { useRenderer } from '@opentui/solid';
import { createSignal } from 'solid-js';
import { toggleMode } from '../../agent/modes';
import type { TuiConfig } from '../../config/resolve';
import { Clipboard } from '../../lib/clipboard';
import { updateSession } from '../../session';
import { DOUBLE_ESCAPE_THRESHOLD_MS } from '../constants';
import { FocusLayer, useScopedKeyboard } from '../keyboard';
import type { AgentMode, Session, Status } from '../types';

export type UseKeyboardShortcutsProps = {
  /** Current status (signal accessor) */
  status: () => Status;
  /** Current mode (signal accessor) */
  mode: () => AgentMode;
  /** Setter for mode */
  setMode: (mode: AgentMode) => void;
  /** Abort function */
  abort: () => void;
  /** Current session for persisting mode changes (signal accessor) */
  currentSession: () => Session | null;
  /** Callback when copy succeeds (shows toast) */
  onCopySuccess: (message: string) => void;
  /** TUI config for double-escape threshold */
  tuiConfig?: TuiConfig;
};

export type UseKeyboardShortcutsReturn = {
  /** Whether tool outputs are expanded */
  toolsExpanded: () => boolean;
  /** Whether keyboard shortcuts help is shown */
  showHelp: () => boolean;
  /** Toggle help visibility */
  setShowHelp: (show: boolean) => void;
};

export function useKeyboardShortcuts(
  props: UseKeyboardShortcutsProps,
): UseKeyboardShortcutsReturn {
  const doubleEscapeThreshold =
    props.tuiConfig?.doubleEscapeThreshold ?? DOUBLE_ESCAPE_THRESHOLD_MS;
  const renderer = useRenderer();
  let lastEscape = 0;
  const [toolsExpanded, setToolsExpanded] = createSignal(false);
  const [showHelp, setShowHelp] = createSignal(false);

  // Global shortcuts — always fire regardless of focus layer
  useScopedKeyboard(
    FocusLayer.BASE,
    (key) => {
      // Ctrl+P: Toggle keyboard shortcuts help
      if (key.ctrl && key.name === 'p') {
        setShowHelp((prev) => !prev);
        return;
      }

      // Ctrl+Y: Copy selected text to clipboard
      if (key.ctrl && key.name === 'y') {
        const selectedText = renderer.getSelection()?.getSelectedText();
        if (selectedText) {
          void Clipboard.copy(selectedText).then(() => {
            props.onCopySuccess('Copied to clipboard');
          });
        }
        return;
      }

      // Ctrl+K: Toggle debug overlay
      if (key.ctrl && key.name === 'k') {
        renderer.toggleDebugOverlay();
        renderer.console.toggle();
      }
    },
    { global: true },
  );

  // App-layer shortcuts — suppressed when a modal/overlay has focus
  useScopedKeyboard(FocusLayer.APP, (key) => {
    // Tab: Toggle mode (only when idle)
    if (key.name === 'tab' && props.status() !== 'thinking') {
      const newMode = toggleMode(props.mode());
      props.setMode(newMode);
      const sessionId = props.currentSession()?.id;
      if (sessionId) updateSession(sessionId, { mode: newMode });
      return;
    }

    // Double-Escape: Abort agent (only when thinking)
    if (key.name === 'escape' && props.status() === 'thinking') {
      const now = Date.now();
      const isDouble = now - lastEscape < doubleEscapeThreshold;
      lastEscape = isDouble ? 0 : now;
      if (isDouble) props.abort();
      return;
    }

    // Ctrl+E: Toggle tool output expansion (works in any status)
    if (key.ctrl && key.name === 'e') {
      setToolsExpanded((prev) => !prev);
    }
  });

  return { toolsExpanded, showHelp, setShowHelp };
}

/**
 * Hook for global keyboard shortcuts.
 * Handles Tab (mode toggle), double-Escape (abort), Ctrl+K (debug), Ctrl+E (expand tools),
 * and Ctrl+Y (copy selected text).
 */

import { useState, useRef } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { toggleMode } from "../../agent/modes";
import { updateSession } from "../../session";
import { Clipboard } from "../../lib/clipboard";
import { DOUBLE_ESCAPE_THRESHOLD_MS } from "../constants";
import type { Status, AgentMode, Session } from "../types";

export type UseKeyboardShortcutsProps = {
  /** Current status */
  status: Status;
  /** Current mode */
  mode: AgentMode;
  /** Setter for mode */
  setMode: (mode: AgentMode) => void;
  /** Abort function */
  abort: () => void;
  /** Whether command menu is open */
  showCommandMenu: boolean;
  /** Whether session picker is open */
  showSessionPicker: boolean;
  /** Current session for persisting mode changes */
  currentSession: Session | null;
  /** Callback when copy succeeds (shows toast) */
  onCopySuccess: (message: string) => void;
};

export type UseKeyboardShortcutsReturn = {
  /** Whether tool outputs are expanded */
  toolsExpanded: boolean;
  /** Whether keyboard shortcuts help is shown */
  showHelp: boolean;
  /** Toggle help visibility */
  setShowHelp: (show: boolean) => void;
};

export function useKeyboardShortcuts({
  status,
  mode,
  setMode,
  abort,
  showCommandMenu,
  showSessionPicker,
  currentSession,
  onCopySuccess,
}: UseKeyboardShortcutsProps): UseKeyboardShortcutsReturn {
  const renderer = useRenderer();
  const lastEscapeRef = useRef<number>(0);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Use refs for values accessed in keyboard handler to avoid stale closures
  const statusRef = useRef(status);
  statusRef.current = status;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const sessionRef = useRef(currentSession);
  sessionRef.current = currentSession;
  const onCopySuccessRef = useRef(onCopySuccess);
  onCopySuccessRef.current = onCopySuccess;

  useKeyboard((key: { ctrl?: boolean; name?: string }) => {
    // Ctrl+P: Toggle keyboard shortcuts help
    if (key.ctrl && key.name === "p") {
      setShowHelp((prev) => !prev);
      return;
    }

    // Ctrl+Y: Copy selected text to clipboard
    if (key.ctrl && key.name === "y") {
      const selection = renderer.getSelection();
      if (selection) {
        const selectedText = selection.getSelectedText();
        if (selectedText) {
          void Clipboard.copy(selectedText).then(() => {
            onCopySuccessRef.current("Copied to clipboard");
          });
        }
      }
      return;
    }

    // Ctrl+K: Toggle debug overlay
    if (key.ctrl && key.name === "k") {
      renderer.toggleDebugOverlay();
      renderer.console.toggle();
      return;
    }

    // Tab: Toggle mode (only when idle and no modals open)
    if (
      key.name === "tab" &&
      statusRef.current === "idle" &&
      !showCommandMenu &&
      !showSessionPicker
    ) {
      const newMode = toggleMode(modeRef.current);
      setMode(newMode);
      if (sessionRef.current) {
        updateSession(sessionRef.current.id, { mode: newMode });
      }
      return;
    }

    // Double-Escape: Abort agent (only when thinking)
    if (key.name === "escape" && statusRef.current === "thinking") {
      const now = Date.now();
      if (now - lastEscapeRef.current < DOUBLE_ESCAPE_THRESHOLD_MS) {
        abort();
        lastEscapeRef.current = 0;
      } else {
        lastEscapeRef.current = now;
      }
      return;
    }

    // Ctrl+E: Toggle tool output expansion (only when idle)
    if (key.ctrl && key.name === "e" && statusRef.current === "idle") {
      setToolsExpanded((prev) => !prev);
    }
  });

  return { toolsExpanded, showHelp, setShowHelp };
}

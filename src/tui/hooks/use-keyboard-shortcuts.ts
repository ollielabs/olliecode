/**
 * Hook for global keyboard shortcuts.
 * Handles Tab (mode toggle), double-Escape (abort), and Ctrl+K (debug).
 */

import { useRef, useCallback } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { toggleMode } from "../../agent/modes";
import { updateSession } from "../../session";
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
};

export function useKeyboardShortcuts({
  status,
  mode,
  setMode,
  abort,
  showCommandMenu,
  showSessionPicker,
  currentSession,
}: UseKeyboardShortcutsProps): void {
  const renderer = useRenderer();
  const lastEscapeRef = useRef<number>(0);

  // Use refs for values accessed in keyboard handler to avoid stale closures
  const statusRef = useRef(status);
  statusRef.current = status;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const sessionRef = useRef(currentSession);
  sessionRef.current = currentSession;

  useKeyboard(
    useCallback(
      (key: { ctrl?: boolean; name?: string }) => {
        // Ctrl+K: Toggle debug overlay
        if (key.ctrl && key.name === "k") {
          renderer.toggleDebugOverlay();
          renderer.console.toggle();
          return;
        }

        // Tab: Toggle mode (only when idle and no modals open)
        if (key.name === "tab" && statusRef.current === "idle" && !showCommandMenu && !showSessionPicker) {
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
          if (now - lastEscapeRef.current < 500) {
            abort();
            lastEscapeRef.current = 0;
          } else {
            lastEscapeRef.current = now;
          }
        }
      },
      [renderer, showCommandMenu, showSessionPicker, setMode, abort]
    )
  );
}

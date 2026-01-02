/**
 * Hook for slash command menu state and logic.
 * Manages command filtering, selection, and actions.
 */

import { useState, useCallback, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import type { SlashCommand } from "../components/command-menu";
import type { Status, TextareaRef } from "../types";

export type UseCommandMenuProps = {
  /** Textarea ref for clearing text after command */
  textareaRef: TextareaRef;
  /** Current status */
  status: Status;
  /** Whether session picker is open */
  showSessionPicker: boolean;
  /** Handlers from other hooks */
  handlers: {
    handleNewSession: () => void;
    handleClearContext: () => void;
    handleCompact: () => Promise<void>;
    handleShowContext: () => Promise<void>;
    handleForget: (n: number) => void;
    setShowSessionPicker: React.Dispatch<React.SetStateAction<boolean>>;
    setShowThemePicker: React.Dispatch<React.SetStateAction<boolean>>;
  };
};

export type UseCommandMenuReturn = {
  /** Whether command menu is visible */
  showCommandMenu: boolean;
  /** Set command menu visibility */
  setShowCommandMenu: React.Dispatch<React.SetStateAction<boolean>>;
  /** Current filter text */
  commandFilter: string;
  /** Set filter text */
  setCommandFilter: React.Dispatch<React.SetStateAction<string>>;
  /** Currently selected index */
  commandSelectedIndex: number;
  /** Set selected index */
  setCommandSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  /** Available slash commands */
  slashCommands: SlashCommand[];
  /** Handle command selection */
  handleCommandSelect: (command: SlashCommand) => void;
  /** Handle command menu cancel */
  handleCommandMenuCancel: () => void;
  /** Handle index change */
  handleCommandIndexChange: (index: number) => void;
};

export function useCommandMenu({
  textareaRef,
  status,
  showSessionPicker,
  handlers,
}: UseCommandMenuProps): UseCommandMenuReturn {
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);

  // Define slash commands with their actions
  const slashCommands: SlashCommand[] = useMemo(
    () => [
      {
        name: "new",
        description: "Start a new session",
        action: () => {
          handlers.handleNewSession();
          textareaRef.current?.setText("");
        },
      },
      {
        name: "session",
        description: "Switch to a different session",
        action: () => {
          handlers.setShowSessionPicker(true);
          textareaRef.current?.setText("");
        },
      },
      {
        name: "clear",
        description: "Clear context (keep session)",
        action: () => {
          handlers.handleClearContext();
          textareaRef.current?.setText("");
        },
      },
      {
        name: "compact",
        description: "Manually compact context",
        action: () => {
          void handlers.handleCompact();
          textareaRef.current?.setText("");
        },
      },
      {
        name: "context",
        description: "Show context usage stats",
        action: () => {
          void handlers.handleShowContext();
          textareaRef.current?.setText("");
        },
      },
      {
        name: "forget",
        description: "Forget last N messages (e.g., /forget 3)",
        action: () => {
          const filterNum = parseInt(commandFilter.replace("forget", "").trim(), 10);
          handlers.handleForget(isNaN(filterNum) || filterNum < 1 ? 1 : filterNum);
          textareaRef.current?.setText("");
        },
      },
      {
        name: "theme",
        description: "Change color theme",
        action: () => {
          handlers.setShowThemePicker(true);
          textareaRef.current?.setText("");
        },
      },
    ],
    [handlers, textareaRef, commandFilter]
  );

  // Detect / in textarea and show command menu
  useKeyboard(
    useCallback(() => {
      setTimeout(() => {
        if (!textareaRef.current || textareaRef.current.isDestroyed) return;
        const currentText = textareaRef.current.plainText ?? "";
        if (status === "idle" && !showSessionPicker) {
          if (currentText.startsWith("/")) {
            const newFilter = currentText.slice(1);
            if (!showCommandMenu) setShowCommandMenu(true);
            setCommandFilter(newFilter);
          } else if (showCommandMenu) {
            setShowCommandMenu(false);
            setCommandFilter("");
            setCommandSelectedIndex(0);
          }
        }
      }, 0);
    }, [textareaRef, status, showSessionPicker, showCommandMenu])
  );

  const handleCommandSelect = useCallback(
    (command: SlashCommand) => {
      setShowCommandMenu(false);
      setCommandFilter("");
      command.action();
    },
    []
  );

  const handleCommandMenuCancel = useCallback(() => {
    setShowCommandMenu(false);
    setCommandFilter("");
    setCommandSelectedIndex(0);
  }, []);

  const handleCommandIndexChange = useCallback((index: number) => {
    setCommandSelectedIndex(index);
  }, []);

  return {
    showCommandMenu,
    setShowCommandMenu,
    commandFilter,
    setCommandFilter,
    commandSelectedIndex,
    setCommandSelectedIndex,
    slashCommands,
    handleCommandSelect,
    handleCommandMenuCancel,
    handleCommandIndexChange,
  };
}

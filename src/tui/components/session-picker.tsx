/**
 * Session picker modal component.
 * Displays sessions grouped by date with keyboard navigation.
 * Supports delete (ctrl+d) and rename (ctrl+r) operations.
 */

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect, useRef } from "react";
import type { InputRenderable } from "@opentui/core";
import { deleteSession, updateSession, type Session } from "../../session";
import { Modal } from "./modal";

export type SessionPickerProps = {
  sessions: Session[];
  projectPath: string;
  onSelect: (session: Session) => void;
  onCancel: () => void;
  onSessionsChanged: () => void;
};

/**
 * Get date group label for a timestamp.
 */
function getDateGroup(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);

  // Reset times to start of day for comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastMonth = new Date(today);
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateStart >= today) {
    return "Today";
  } else if (dateStart >= yesterday) {
    return "Yesterday";
  } else if (dateStart >= lastWeek) {
    return "This Week";
  } else if (dateStart >= lastMonth) {
    return "This Month";
  } else {
    return "Older";
  }
}

/**
 * Format time for display.
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type SessionGroup = {
  label: string;
  sessions: Session[];
};

/**
 * Group sessions by date.
 */
function groupSessionsByDate(sessions: Session[]): SessionGroup[] {
  const groups = new Map<string, Session[]>();
  const order = ["Today", "Yesterday", "This Week", "This Month", "Older"];

  for (const session of sessions) {
    const label = getDateGroup(session.updatedAt);
    const group = groups.get(label) ?? [];
    group.push(session);
    groups.set(label, group);
  }

  // Return groups in order
  const result: SessionGroup[] = [];
  for (const label of order) {
    const sessions = groups.get(label);
    if (sessions && sessions.length > 0) {
      result.push({ label, sessions });
    }
  }

  return result;
}

/**
 * Flatten grouped sessions for index-based navigation.
 */
function flattenSessions(groups: SessionGroup[]): Session[] {
  return groups.flatMap((g) => g.sessions);
}

type PickerMode = "browse" | "confirm-delete" | "rename";

export function SessionPicker({
  sessions,
  projectPath,
  onSelect,
  onCancel,
  onSessionsChanged,
}: SessionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<PickerMode>("browse");
  const [renameValue, setRenameValue] = useState("");
  const { height: termHeight } = useTerminalDimensions();
  const inputRef = useRef<InputRenderable>(null);

  // Filter to current project sessions
  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);
  const groups = groupSessionsByDate(projectSessions);
  const flatSessions = flattenSessions(groups);

  // Get currently selected session
  const selectedSession = flatSessions[selectedIndex];

  // Calculate scrollbox height: based on content, capped at ~half terminal height
  const sessionLines = flatSessions.length;
  const groupHeaderLines = groups.length * 2; // header + margin
  const contentHeight = sessionLines + groupHeaderLines;

  const scrollHeight = Math.min(contentHeight, Math.floor(termHeight / 2) - 6);

  // Ensure selectedIndex is within bounds
  useEffect(() => {
    if (selectedIndex >= flatSessions.length && flatSessions.length > 0) {
      setSelectedIndex(flatSessions.length - 1);
    }
  }, [flatSessions.length, selectedIndex]);

  // Focus input when entering rename mode
  useEffect(() => {
    if (mode === "rename" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  const handleDelete = () => {
    if (!selectedSession) return;

    if (mode === "confirm-delete") {
      // Confirmed - delete the session
      deleteSession(selectedSession.id);
      setMode("browse");
      onSessionsChanged();
    } else {
      // First press - ask for confirmation
      setMode("confirm-delete");
    }
  };

  const handleRename = () => {
    if (!selectedSession) return;

    if (mode === "rename") {
      // Already in rename mode - ignore
      return;
    }

    // Enter rename mode with current title
    setRenameValue(selectedSession.title ?? "");
    setMode("rename");
  };

  const handleRenameSubmit = () => {
    if (!selectedSession || !renameValue.trim()) {
      setMode("browse");
      return;
    }

    updateSession(selectedSession.id, { title: renameValue.trim() });
    setMode("browse");
    onSessionsChanged();
  };

  const handleKeyPress = (key: { name?: string; ctrl?: boolean }) => {
    // Handle rename mode separately
    if (mode === "rename") {
      if (key.name === "escape") {
        setMode("browse");
      } else if (key.name === "return") {
        handleRenameSubmit();
      }
      return;
    }

    // Handle ctrl+d for delete
    if (key.ctrl && key.name === "d") {
      handleDelete();
      return;
    }

    // Handle ctrl+r for rename
    if (key.ctrl && key.name === "r") {
      handleRename();
      return;
    }

    // Cancel delete confirmation on any other key
    if (mode === "confirm-delete") {
      setMode("browse");
      // Don't process navigation on cancel
      return;
    }

    // Normal navigation
    switch (key.name) {
      case "up":
      case "k":
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        break;
      case "down":
      case "j":
        setSelectedIndex((prev) => Math.min(flatSessions.length - 1, prev + 1));
        break;
      case "return": {
        if (selectedSession) {
          onSelect(selectedSession);
        }
        break;
      }
      // Note: escape/q handled by Modal
    }
  };

  useKeyboard(handleKeyPress);

  // Track global index for selection highlighting
  let globalIndex = 0;

  // Modal title changes based on mode
  const modalTitle = mode === "rename" ? "Rename Session" : "Sessions";

  return (
    <Modal title={modalTitle} onClose={mode === "rename" ? () => setMode("browse") : onCancel}>
      {mode === "rename" ? (
        <box flexDirection="column">
          <input
            ref={inputRef}
            value={renameValue}
            onInput={(value) => setRenameValue(value)}
            placeholder="Enter new title"
            backgroundColor="#2d2d3a"
            focusedBackgroundColor="#2d2d3a"
            cursorColor="#61afef"
          />
          <box paddingTop={1}>
            <text fg="#666">Enter to save, Esc to cancel</text>
          </box>
        </box>
      ) : flatSessions.length === 0 ? (
        <text fg="#888">No sessions found for this project.</text>
      ) : (
        <box flexDirection="column">
          <scrollbox maxHeight={scrollHeight} stickyScroll={false}>
            <box flexDirection="column">
              {groups.map((group) => (
                <box key={group.label} flexDirection="column" marginBottom={1}>
                  {/* Date group label */}
                  <text fg="#61afef">{group.label}</text>

                  {/* Sessions in this group */}
                  {group.sessions.map((session) => {
                    const idx = globalIndex++;
                    const isSelected = idx === selectedIndex;
                    const isConfirmingDelete = isSelected && mode === "confirm-delete";
                    const prefix = isSelected ? "> " : "  ";
                    const title = isConfirmingDelete
                      ? "Press ctrl+d again to confirm delete"
                      : (session.title ?? session.id.slice(0, 8));
                    const time = formatTime(session.updatedAt);

                    // Colors: error red for delete confirm, green for selected, gray otherwise
                    const fg = isConfirmingDelete
                      ? "#e06c75"
                      : isSelected
                        ? "#98c379"
                        : "#888";

                    return (
                      <box key={session.id} flexDirection="row">
                        <text fg={fg}>
                          {prefix}{time} - {title}
                        </text>
                      </box>
                    );
                  })}
                </box>
              ))}
            </box>
          </scrollbox>

          {/* Keybind hints */}
          <box flexDirection="row" gap={2} marginTop={1}>
            <text fg="#666">
              <b>delete</b> ctrl+d
            </text>
            <text fg="#666">
              <b>rename</b> ctrl+r
            </text>
          </box>
        </box>
      )}
    </Modal>
  );
}

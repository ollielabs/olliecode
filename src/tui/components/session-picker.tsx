/**
 * Session picker modal component.
 * Displays sessions grouped by date with keyboard navigation.
 * Supports delete (ctrl+d) and rename (ctrl+r) operations.
 */

import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useState, useEffect, useRef } from 'react';
import type { InputRenderable } from '@opentui/core';
import { deleteSession, updateSession, type Session } from '../../session';
import { Modal } from './modal';
import { useTheme } from '../../design';

export type SessionPickerProps = {
  sessions: Session[];
  projectPath: string;
  onSelect: (session: Session) => void;
  onCancel: () => void;
  onSessionsChanged: () => void;
};

function getDateGroup(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastMonth = new Date(today);
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const dateStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );

  if (dateStart >= today) return 'Today';
  if (dateStart >= yesterday) return 'Yesterday';
  if (dateStart >= lastWeek) return 'This Week';
  if (dateStart >= lastMonth) return 'This Month';
  return 'Older';
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

type SessionGroup = { label: string; sessions: Session[] };

function groupSessionsByDate(sessions: Session[]): SessionGroup[] {
  const groups = new Map<string, Session[]>();
  const order = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];

  for (const session of sessions) {
    const label = getDateGroup(session.updatedAt);
    const group = groups.get(label) ?? [];
    group.push(session);
    groups.set(label, group);
  }

  return order
    .map((label) => ({ label, sessions: groups.get(label) ?? [] }))
    .filter((g) => g.sessions.length > 0);
}

function flattenSessions(groups: SessionGroup[]): Session[] {
  return groups.flatMap((g) => g.sessions);
}

type PickerMode = 'browse' | 'confirm-delete' | 'rename';

export function SessionPicker({
  sessions,
  projectPath,
  onSelect,
  onCancel,
  onSessionsChanged,
}: SessionPickerProps) {
  const { tokens } = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<PickerMode>('browse');
  const [renameValue, setRenameValue] = useState('');
  const { height: termHeight } = useTerminalDimensions();
  const inputRef = useRef<InputRenderable>(null);

  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);
  const groups = groupSessionsByDate(projectSessions);
  const flatSessions = flattenSessions(groups);
  const selectedSession = flatSessions[selectedIndex];

  const scrollHeight = Math.min(
    flatSessions.length + groups.length * 2,
    Math.floor(termHeight / 2) - 6,
  );

  useEffect(() => {
    if (selectedIndex >= flatSessions.length && flatSessions.length > 0) {
      setSelectedIndex(flatSessions.length - 1);
    }
  }, [flatSessions.length, selectedIndex]);

  useEffect(() => {
    if (mode === 'rename' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  const handleDelete = () => {
    if (!selectedSession) return;
    if (mode === 'confirm-delete') {
      deleteSession(selectedSession.id);
      setMode('browse');
      onSessionsChanged();
    } else {
      setMode('confirm-delete');
    }
  };

  const handleRename = () => {
    if (!selectedSession || mode === 'rename') return;
    setRenameValue(selectedSession.title ?? '');
    setMode('rename');
  };

  const handleRenameSubmit = () => {
    if (!selectedSession || !renameValue.trim()) {
      setMode('browse');
      return;
    }
    updateSession(selectedSession.id, { title: renameValue.trim() });
    setMode('browse');
    onSessionsChanged();
  };

  useKeyboard((key: { name?: string; ctrl?: boolean }) => {
    if (mode === 'rename') {
      if (key.name === 'escape') setMode('browse');
      else if (key.name === 'return') handleRenameSubmit();
      return;
    }

    if (key.ctrl && key.name === 'd') {
      handleDelete();
      return;
    }
    if (key.ctrl && key.name === 'r') {
      handleRename();
      return;
    }

    if (mode === 'confirm-delete') {
      setMode('browse');
      return;
    }

    switch (key.name) {
      case 'up':
      case 'k':
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        break;
      case 'down':
      case 'j':
        setSelectedIndex((prev) => Math.min(flatSessions.length - 1, prev + 1));
        break;
      case 'return':
        if (selectedSession) onSelect(selectedSession);
        break;
    }
  });

  let globalIndex = 0;

  return (
    <Modal
      title={mode === 'rename' ? 'Rename Session' : 'Sessions'}
      onClose={mode === 'rename' ? () => setMode('browse') : onCancel}
    >
      {mode === 'rename' ? (
        <box flexDirection="column">
          <input
            ref={inputRef}
            value={renameValue}
            onInput={(value) => setRenameValue(value)}
            placeholder="Enter new title"
            backgroundColor={tokens.bgSurfaceHover}
            focusedBackgroundColor={tokens.bgSurfaceHover}
            cursorColor={tokens.primaryBase}
          />
          <box paddingTop={1}>
            <text style={{ fg: tokens.textSubtle }}>
              Enter to save, Esc to cancel
            </text>
          </box>
        </box>
      ) : flatSessions.length === 0 ? (
        <text style={{ fg: tokens.textMuted }}>
          No sessions found for this project.
        </text>
      ) : (
        <box flexDirection="column">
          <scrollbox maxHeight={scrollHeight} stickyScroll={false}>
            <box flexDirection="column">
              {groups.map((group) => (
                <box key={group.label} flexDirection="column" marginBottom={1}>
                  <text style={{ fg: tokens.primaryBase }}>{group.label}</text>

                  {group.sessions.map((session) => {
                    const idx = globalIndex++;
                    const isSelected = idx === selectedIndex;
                    const isConfirmingDelete =
                      isSelected && mode === 'confirm-delete';
                    const prefix = isSelected ? '> ' : '  ';
                    const title = isConfirmingDelete
                      ? 'Press ctrl+d again to confirm delete'
                      : (session.title ?? session.id.slice(0, 8));
                    const time = formatTime(session.updatedAt);

                    const fg = isConfirmingDelete
                      ? tokens.error
                      : isSelected
                        ? tokens.success
                        : tokens.textMuted;

                    return (
                      <box key={session.id} flexDirection="row">
                        <text style={{ fg }}>
                          {prefix}
                          {time} - {title}
                        </text>
                      </box>
                    );
                  })}
                </box>
              ))}
            </box>
          </scrollbox>

          <box flexDirection="row" gap={2} marginTop={1}>
            <text style={{ fg: tokens.textSubtle }}>
              <b>delete</b> ctrl+d
            </text>
            <text style={{ fg: tokens.textSubtle }}>
              <b>rename</b> ctrl+r
            </text>
          </box>
        </box>
      )}
    </Modal>
  );
}

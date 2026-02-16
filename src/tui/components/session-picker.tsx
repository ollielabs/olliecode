/**
 * Session picker modal component.
 * Displays sessions grouped by date with keyboard navigation.
 * Supports delete (ctrl+d) and rename (ctrl+r) operations.
 */

import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
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

/**
 * Precompute a map from session.id to its flat index across all groups.
 * This replaces the mutable `globalIndex` counter in the render phase.
 */
function buildSessionIndexMap(groups: SessionGroup[]): Map<string, number> {
  const map = new Map<string, number>();
  let idx = 0;
  for (const group of groups) {
    for (const session of group.sessions) {
      map.set(session.id, idx++);
    }
  }
  return map;
}

type PickerMode = 'browse' | 'confirm-delete' | 'rename';

export function SessionPicker(props: SessionPickerProps) {
  const { tokens } = useTheme();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [mode, setMode] = createSignal<PickerMode>('browse');
  const [renameValue, setRenameValue] = createSignal('');
  const dimensions = useTerminalDimensions();
  let inputRef: InputRenderable | undefined;

  const projectSessions = createMemo(() =>
    props.sessions.filter((s) => s.projectPath === props.projectPath),
  );
  const groups = createMemo(() => groupSessionsByDate(projectSessions()));
  const flatSessions = createMemo(() => flattenSessions(groups()));
  const sessionIndexMap = createMemo(() => buildSessionIndexMap(groups()));

  const scrollHeight = createMemo(() =>
    Math.min(
      flatSessions().length + groups().length * 2,
      Math.floor(dimensions().height / 2) - 6,
    ),
  );

  createEffect(() => {
    if (selectedIndex() >= flatSessions().length && flatSessions().length > 0) {
      setSelectedIndex(flatSessions().length - 1);
    }
  });

  createEffect(() => {
    if (mode() === 'rename' && inputRef) {
      inputRef.focus();
    }
  });

  const handleDelete = () => {
    const session = flatSessions()[selectedIndex()];
    if (!session) return;
    if (mode() === 'confirm-delete') {
      deleteSession(session.id);
      setMode('browse');
      props.onSessionsChanged();
    } else {
      setMode('confirm-delete');
    }
  };

  const handleRename = () => {
    const session = flatSessions()[selectedIndex()];
    if (!session || mode() === 'rename') return;
    setRenameValue(session.title ?? '');
    setMode('rename');
  };

  const handleRenameSubmit = () => {
    const session = flatSessions()[selectedIndex()];
    if (!session || !renameValue().trim()) {
      setMode('browse');
      return;
    }
    updateSession(session.id, { title: renameValue().trim() });
    setMode('browse');
    props.onSessionsChanged();
  };

  useKeyboard((key: { name?: string; ctrl?: boolean }) => {
    if (mode() === 'rename') {
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

    if (mode() === 'confirm-delete') {
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
        setSelectedIndex((prev) => Math.min(flatSessions().length - 1, prev + 1));
        break;
      case 'return': {
        const session = flatSessions()[selectedIndex()];
        if (session) props.onSelect(session);
        break;
      }
    }
  });

  return (
    <Modal
      title={mode() === 'rename' ? 'Rename Session' : 'Sessions'}
      onClose={mode() === 'rename' ? () => setMode('browse') : props.onCancel}
    >
      <Show when={mode() === 'rename'}>
        <box flexDirection="column">
          <input
            ref={inputRef!}
            value={renameValue()}
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
      </Show>

      <Show when={mode() !== 'rename' && flatSessions().length === 0}>
        <text style={{ fg: tokens.textMuted }}>
          No sessions found for this project.
        </text>
      </Show>

      <Show when={mode() !== 'rename' && flatSessions().length > 0}>
        <box flexDirection="column">
          <scrollbox maxHeight={scrollHeight()} stickyScroll={false}>
            <box flexDirection="column">
              <For each={groups()}>
                {(group) => (
                  <box flexDirection="column" marginBottom={1}>
                    <text style={{ fg: tokens.primaryBase }}>
                      {group.label}
                    </text>

                    <For each={group.sessions}>
                      {(session) => {
                        const idx = sessionIndexMap().get(session.id) ?? 0;
                        const isSelected = idx === selectedIndex();
                        const isConfirmingDelete =
                          isSelected && mode() === 'confirm-delete';
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
                          <box flexDirection="row">
                            <text style={{ fg }}>
                              {prefix}
                              {time} - {title}
                            </text>
                          </box>
                        );
                      }}
                    </For>
                  </box>
                )}
              </For>
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
      </Show>
    </Modal>
  );
}

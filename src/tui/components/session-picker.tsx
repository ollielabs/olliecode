/**
 * Session picker modal component.
 * Displays sessions grouped by date with keyboard navigation.
 * Supports delete (ctrl+d) and rename (ctrl+r) operations.
 */

import type { InputRenderable, ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useTheme } from '../../design';
import { FocusLayer, useScopedKeyboard } from '../keyboard';
import { deleteSession, type Session, updateSession } from '../../session';
import { scrollIntoView } from '../utils';
import { Modal } from './modal';

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

/**
 * Get the actual layout position of a session item from the scroll content tree.
 *
 * Structure: scrollbox > content > innerBox > groupBox[] > [header, ...sessionItems]
 * Each groupBox child[0] is the header <text>, children[1..] are session <box> rows.
 *
 * Uses yoga layout nodes to read positions relative to the content container,
 * which are stable regardless of scroll position.
 *
 * Returns { top, bottom } in content-relative coordinates where:
 *   top = y to show when scrolling UP (includes group header for first-in-group)
 *   bottom = y + height of the item (for scrolling DOWN)
 */
function getItemLayoutBounds(
  scrollRef: ScrollBoxRenderable,
  groups: SessionGroup[],
  flatIndex: number,
): { top: number; bottom: number } | null {
  // content > innerBox > groupBoxes
  const innerBox = scrollRef.content.getChildren()[0];
  if (!innerBox) return null;
  const groupBoxes = innerBox.getChildren();

  let remaining = flatIndex;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    const groupBox = groupBoxes[gi];
    if (!groupBox) continue;

    if (remaining < group.sessions.length) {
      // child[0] = header text, child[1..] = session items
      const itemChild = groupBox.getChildren()[remaining + 1];
      if (!itemChild) return null;

      // Use yoga layout nodes for scroll-stable positions
      const groupLayout = groupBox.getLayoutNode();
      const itemLayout = itemChild.getLayoutNode();
      const groupY = groupLayout.getComputedTop();
      const itemY = groupY + itemLayout.getComputedTop();
      const itemBottom = itemY + itemLayout.getComputedHeight();

      // For first item in group, include the group header
      let top = itemY;
      if (remaining === 0) {
        top = groupY;
      }

      return { top, bottom: itemBottom };
    }
    remaining -= group.sessions.length;
  }
  return null;
}

type PickerMode = 'browse' | 'confirm-delete' | 'rename';

export function SessionPicker(props: SessionPickerProps) {
  const { tokens } = useTheme();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [mode, setMode] = createSignal<PickerMode>('browse');
  const [renameValue, setRenameValue] = createSignal('');
  const dimensions = useTerminalDimensions();
  let inputRef: InputRenderable | undefined;
  let scrollRef: ScrollBoxRenderable | undefined;

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

  // Scroll-into-view: only scroll when selected item is outside the viewport.
  // Reads actual layout positions from the renderable tree.
  createEffect(() => {
    const idx = selectedIndex();
    const sessions = flatSessions();
    const g = groups();
    if (!scrollRef || sessions.length === 0) return;

    const bounds = getItemLayoutBounds(scrollRef, g, idx);
    if (bounds) scrollIntoView(scrollRef, bounds.top, bounds.bottom);
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

  useScopedKeyboard(FocusLayer.MODAL, (key) => {
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
        setSelectedIndex((prev) =>
          Math.min(flatSessions().length - 1, prev + 1),
        );
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
          <scrollbox
            ref={scrollRef!}
            maxHeight={scrollHeight()}
            stickyScroll={false}
            focusable={false}
          >
            <box flexDirection="column">
              <For each={groups()}>
                {(group) => (
                  <box flexDirection="column" marginBottom={1}>
                    <text style={{ fg: tokens.primaryBase }}>
                      {group.label}
                    </text>

                    <For each={group.sessions}>
                      {(session) => {
                        const idx = createMemo(
                          () => sessionIndexMap().get(session.id) ?? 0,
                        );
                        const isSelected = createMemo(
                          () => idx() === selectedIndex(),
                        );
                        const isConfirmingDelete = createMemo(
                          () => isSelected() && mode() === 'confirm-delete',
                        );
                        const prefix = () => (isSelected() ? '> ' : '  ');
                        const title = () =>
                          isConfirmingDelete()
                            ? 'Press ctrl+d again to confirm delete'
                            : (session.title ?? session.id.slice(0, 8));
                        const time = formatTime(session.updatedAt);

                        const fg = () =>
                          isConfirmingDelete()
                            ? tokens.error
                            : isSelected()
                              ? tokens.success
                              : tokens.textMuted;

                        return (
                          <box flexDirection="row">
                            <text style={{ fg: fg() }}>
                              {prefix()}
                              {time} - {title()}
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

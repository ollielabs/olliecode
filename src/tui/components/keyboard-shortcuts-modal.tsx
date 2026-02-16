/**
 * Keyboard shortcuts help modal.
 * Displays all available keyboard shortcuts and slash commands.
 */

import { For } from 'solid-js';
import { useTheme } from '../../design';
import { Modal } from './modal';

export type KeyboardShortcutsModalProps = {
  onClose: () => void;
};

type ShortcutCategory = {
  title: string;
  shortcuts: { keys: string; description: string }[];
};

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Editing',
    shortcuts: [
      { keys: 'Ctrl+J', description: 'Insert newline' },
      { keys: 'Ctrl+Y', description: 'Copy selected text' },
      { keys: 'Enter', description: 'Submit message' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: 'Ctrl+P', description: 'Show this help' },
      { keys: 'Tab', description: 'Switch mode (plan/build)' },
      { keys: '/', description: 'Open command menu' },
      { keys: '@', description: 'Open file picker' },
      { keys: 'Esc', description: 'Close modal/menu' },
    ],
  },
  {
    title: 'Agent Control',
    shortcuts: [
      { keys: 'Esc Esc', description: 'Abort (when thinking)' },
      { keys: 'Ctrl+E', description: 'Expand/collapse tool outputs' },
    ],
  },
  {
    title: 'Slash Commands',
    shortcuts: [
      { keys: '/new', description: 'Start new session' },
      { keys: '/session', description: 'Switch session' },
      { keys: '/clear', description: 'Clear context' },
      { keys: '/compact', description: 'Compact context' },
      { keys: '/context', description: 'Show context stats' },
      { keys: '/forget N', description: 'Forget last N messages' },
      { keys: '/theme', description: 'Change theme' },
      { keys: '/config', description: 'Show active configuration' },
    ],
  },
];

export function KeyboardShortcutsModal(props: KeyboardShortcutsModalProps) {
  const { tokens } = useTheme();

  return (
    <Modal title="Keyboard Shortcuts" onClose={props.onClose} size="medium">
      <box flexDirection="column">
        <For each={SHORTCUT_CATEGORIES}>
          {(category, catIdx) => (
            <box
              flexDirection="column"
              marginBottom={catIdx() < SHORTCUT_CATEGORIES.length - 1 ? 1 : 0}
            >
              <text style={{ fg: tokens.primaryBase }}>
                <b>{category.title}</b>
              </text>
              <For each={category.shortcuts}>
                {(shortcut) => (
                  <box flexDirection="row" marginLeft={1}>
                    <text style={{ fg: tokens.textBase, width: 14 }}>
                      {shortcut.keys}
                    </text>
                    <text style={{ fg: tokens.textMuted }}>
                      {shortcut.description}
                    </text>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
        <box marginTop={1}>
          <text style={{ fg: tokens.textSubtle }}>
            Press Ctrl+P or Esc to close
          </text>
        </box>
      </box>
    </Modal>
  );
}

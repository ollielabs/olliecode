/**
 * Hook for slash command menu state and logic.
 * Manages command filtering, selection, and actions.
 */

import { useKeyboard } from '@opentui/solid';
import { createSignal, type Setter } from 'solid-js';
import type { SlashCommand } from '../components/command-menu';
import type { TextareaRef } from '../types';

export type UseCommandMenuProps = {
  /** Getter for textarea ref */
  getTextareaRef: () => TextareaRef;
  /** Handlers from other hooks */
  handlers: {
    handleNewSession: () => void;
    handleClearContext: () => void;
    handleCompact: () => Promise<void>;
    handleShowContext: () => Promise<void>;
    handleForget: (n: number) => void;
    handleInit: (args?: string) => void;
    handleConfig: () => void;
    handleMcp: () => void;
    setShowSessionPicker: Setter<boolean>;
    setShowThemePicker: Setter<boolean>;
  };
};

export type UseCommandMenuReturn = {
  /** Whether command menu is visible */
  showCommandMenu: () => boolean;
  /** Set command menu visibility */
  setShowCommandMenu: Setter<boolean>;
  /** Current filter text */
  commandFilter: () => string;
  /** Set filter text */
  setCommandFilter: Setter<string>;
  /** Currently selected index */
  commandSelectedIndex: () => number;
  /** Set selected index */
  setCommandSelectedIndex: Setter<number>;
  /** Available slash commands */
  slashCommands: SlashCommand[];
  /** Handle command selection */
  handleCommandSelect: (command: SlashCommand) => void;
  /** Handle command menu cancel */
  handleCommandMenuCancel: () => void;
  /** Handle index change */
  handleCommandIndexChange: (index: number) => void;
};

export function useCommandMenu(
  props: UseCommandMenuProps,
): UseCommandMenuReturn {
  const [showCommandMenu, setShowCommandMenu] = createSignal(false);
  const [commandFilter, setCommandFilter] = createSignal('');
  const [commandSelectedIndex, setCommandSelectedIndex] = createSignal(0);

  // Define slash commands with their actions
  const slashCommands: SlashCommand[] = [
    {
      name: 'new',
      description: 'Start a new session',
      action: () => {
        props.handlers.handleNewSession();
        props.getTextareaRef()?.setText('');
      },
    },
    {
      name: 'session',
      description: 'Switch to a different session',
      action: () => {
        props.handlers.setShowSessionPicker(true);
        props.getTextareaRef()?.setText('');
      },
    },
    {
      name: 'clear',
      description: 'Clear context (keep session)',
      action: () => {
        props.handlers.handleClearContext();
        props.getTextareaRef()?.setText('');
      },
    },
    {
      name: 'compact',
      description: 'Manually compact context',
      action: () => {
        void props.handlers.handleCompact();
        props.getTextareaRef()?.setText('');
      },
    },
    {
      name: 'context',
      description: 'Show context usage stats',
      action: () => {
        void props.handlers.handleShowContext();
        props.getTextareaRef()?.setText('');
      },
    },
    {
      name: 'forget',
      description: 'Forget last N messages (e.g., /forget 3)',
      action: () => {
        const filterNum = parseInt(
          commandFilter().replace('forget', '').trim(),
          10,
        );
        props.handlers.handleForget(
          Number.isNaN(filterNum) || filterNum < 1 ? 1 : filterNum,
        );
        props.getTextareaRef()?.setText('');
      },
    },
    {
      name: 'theme',
      description: 'Change color theme',
      action: () => {
        props.handlers.setShowThemePicker(true);
        props.getTextareaRef()?.setText('');
      },
    },
    {
      name: 'init',
      description: 'Create/update AGENTS.md for this project',
      action: () => {
        // Extract any arguments after "init " from the command filter
        const args = commandFilter()
          .replace(/^init\s*/, '')
          .trim();
        props.handlers.handleInit(args || undefined);
        props.getTextareaRef()?.setText('');
      },
    },
    {
      name: 'config',
      description: 'Show active configuration and sources',
      action: () => {
        props.handlers.handleConfig();
        props.getTextareaRef()?.setText('');
      },
    },
    {
      name: 'mcp',
      description: 'Show MCP server status and tools',
      action: () => {
        props.handlers.handleMcp();
        props.getTextareaRef()?.setText('');
      },
    },
  ];

  // Detect / in textarea and show command menu.
  // Runs on every keypress (no overlay check) so the menu reacts even
  // while the command-menu overlay is open.
  useKeyboard(() => {
    setTimeout(() => {
      const ref = props.getTextareaRef();
      if (!ref || ref.isDestroyed) return;
      const currentText = ref.plainText ?? '';
      if (!currentText.startsWith('/')) {
        // No slash — close menu if open
        if (!showCommandMenu()) return;
        setShowCommandMenu(false);
        setCommandFilter('');
        setCommandSelectedIndex(0);
        return;
      }

      if (!showCommandMenu()) setShowCommandMenu(true);
      setCommandFilter(currentText.slice(1));
    }, 0);
  });

  const handleCommandSelect = (command: SlashCommand) => {
    setShowCommandMenu(false);
    setCommandFilter('');
    command.action();
  };

  const handleCommandMenuCancel = () => {
    setShowCommandMenu(false);
    setCommandFilter('');
    setCommandSelectedIndex(0);
  };

  const handleCommandIndexChange = (index: number) => {
    setCommandSelectedIndex(index);
  };

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

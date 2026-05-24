/**
 * Hook for @ mention picker state and logic.
 * Manages agent and file filtering, selection, and insertion.
 * Agents resolve first in the picker list, files second.
 */

import { useKeyboard } from '@opentui/solid';
import { createSignal, onMount } from 'solid-js';
import type { AgentRegistry } from '../../agent/agents/registry';
import { getFilesAndDirectories } from '../../utils/file-list';
import type { TextareaRef } from '../types';

/** Agent item for the mention picker. */
export type AgentMentionItem = {
  name: string;
  description: string;
};

export type UseMentionPickerProps = {
  /** Getter for textarea ref */
  getTextareaRef: () => TextareaRef;
  /** Agent registry for listing available agents */
  agentRegistry: AgentRegistry;
};

export type UseMentionPickerReturn = {
  /** Whether mention picker is visible */
  showMentionPicker: () => boolean;
  /** Current filter text (characters after @) */
  mentionFilter: () => string;
  /** Currently selected index (across agents + files) */
  mentionSelectedIndex: () => number;
  /** Available agents for the picker */
  agents: () => AgentMentionItem[];
  /** Available files for the picker */
  files: () => string[];
  /** Handle mention selection (agent name or file path) */
  handleMentionSelect: (value: string) => void;
  /** Handle mention picker cancel */
  handleMentionPickerCancel: () => void;
  /** Handle index change */
  handleMentionIndexChange: (index: number) => void;
};

export function useMentionPicker(
  props: UseMentionPickerProps,
): UseMentionPickerReturn {
  const [showMentionPicker, setShowMentionPicker] = createSignal(false);
  const [mentionFilter, setMentionFilter] = createSignal('');
  const [mentionSelectedIndex, setMentionSelectedIndex] = createSignal(0);
  const [files, setFiles] = createSignal<string[]>([]);
  const [agents, setAgents] = createSignal<AgentMentionItem[]>([]);
  const [atPosition, setAtPosition] = createSignal<number | null>(null);

  // Load files and agents on mount
  onMount(() => {
    void getFilesAndDirectories().then(setFiles);
    // List subagent-eligible agents (mode: subagent or all)
    const subagents = props.agentRegistry.list({ mode: 'subagent' });
    setAgents(
      subagents.map((a) => ({ name: a.name, description: a.description })),
    );
  });

  // Detect @ in textarea and show mention picker.
  // Runs on every keypress (no overlay check) so the picker reacts even
  // while the mention-picker overlay is open.
  useKeyboard(() => {
    setTimeout(() => {
      const ref = props.getTextareaRef();
      if (!ref || ref.isDestroyed) return;

      const currentText = ref.plainText ?? '';

      // Find the last @ that could be triggering the picker
      const lastAtIndex = findLastTriggerAt(currentText);

      if (lastAtIndex === null) {
        if (!showMentionPicker()) return;
        setShowMentionPicker(false);
        setMentionFilter('');
        setMentionSelectedIndex(0);
        setAtPosition(null);
        return;
      }

      // Extract filter: text after @ until whitespace or end
      const afterAt = currentText.slice(lastAtIndex + 1);
      const filterEnd = afterAt.search(/\s/);
      const filter = filterEnd === -1 ? afterAt : afterAt.slice(0, filterEnd);

      if (!showMentionPicker()) {
        setShowMentionPicker(true);
        setAtPosition(lastAtIndex);
      }
      // Only reset selected index when filter text actually changes
      // (arrow keys fire useKeyboard but don't change the text)
      if (filter !== mentionFilter()) {
        setMentionFilter(filter);
        setMentionSelectedIndex(0);
      }
    }, 0);
  });

  const handleMentionSelect = (value: string) => {
    const ref = props.getTextareaRef();
    const pos = atPosition();
    if (!ref || pos === null) return;

    const currentText = ref.plainText ?? '';

    // Replace @filter with @value
    const beforeAt = currentText.slice(0, pos);
    const afterAt = currentText.slice(pos + 1);

    // Find end of current filter (until whitespace or end)
    const filterEnd = afterAt.search(/\s/);
    const afterFilter = filterEnd === -1 ? '' : afterAt.slice(filterEnd);

    // Add trailing space so findLastTriggerAt sees the @ context as complete
    const separator = afterFilter ? '' : ' ';
    const newText = `${beforeAt}@${value}${separator}${afterFilter}`;
    ref.setText(newText);

    // Move cursor to end of inserted value + separator
    const cursorPosition =
      beforeAt.length + 1 + value.length + separator.length; // +1 for @
    ref.cursorOffset = cursorPosition;

    // Defer closing so suppressSubmit stays true during this event tick.
    queueMicrotask(() => {
      setShowMentionPicker(false);
      setMentionFilter('');
      setMentionSelectedIndex(0);
      setAtPosition(null);
    });
  };

  const handleMentionPickerCancel = () => {
    setShowMentionPicker(false);
    setMentionFilter('');
    setMentionSelectedIndex(0);
    setAtPosition(null);
  };

  const handleMentionIndexChange = (index: number) => {
    setMentionSelectedIndex(index);
  };

  return {
    showMentionPicker,
    mentionFilter,
    mentionSelectedIndex,
    agents,
    files,
    handleMentionSelect,
    handleMentionPickerCancel,
    handleMentionIndexChange,
  };
}

/**
 * Find the last @ that could trigger the mention picker.
 * Valid triggers: @ at start of text, or @ preceded by whitespace.
 * Returns null if no valid trigger found or if cursor is past the @ context.
 */
function findLastTriggerAt(text: string): number | null {
  // Search backwards for @
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === '@') {
      // Valid if at start or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1] ?? '')) {
        // Check if we're still in the @ context (no whitespace after @)
        const afterAt = text.slice(i + 1);
        if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
          return i;
        }
      }
    }
  }
  return null;
}

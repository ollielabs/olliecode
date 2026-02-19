/**
 * Hook for @ file mention picker state and logic.
 * Manages file filtering, selection, and path insertion.
 */

import { createSignal, onMount } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { getFilesAndDirectories } from '../../utils/file-list';
import type { Status, TextareaRef } from '../types';

export type UseFilePickerProps = {
  /** Getter for textarea ref */
  getTextareaRef: () => TextareaRef;
  /** Current status (signal accessor) */
  status: () => Status;
  /** Whether other modals are open (signal accessor) */
  isModalOpen: () => boolean;
};

export type UseFilePickerReturn = {
  /** Whether file picker is visible */
  showFilePicker: () => boolean;
  /** Current filter text (characters after @) */
  fileFilter: () => string;
  /** Currently selected index */
  fileSelectedIndex: () => number;
  /** Available files list */
  files: () => string[];
  /** Handle file selection */
  handleFileSelect: (path: string) => void;
  /** Handle file picker cancel */
  handleFilePickerCancel: () => void;
  /** Handle index change */
  handleFileIndexChange: (index: number) => void;
};

export function useFilePicker(props: UseFilePickerProps): UseFilePickerReturn {
  const [showFilePicker, setShowFilePicker] = createSignal(false);
  const [fileFilter, setFileFilter] = createSignal('');
  const [fileSelectedIndex, setFileSelectedIndex] = createSignal(0);
  const [files, setFiles] = createSignal<string[]>([]);
  const [atPosition, setAtPosition] = createSignal<number | null>(null);

  // Load files on mount
  onMount(() => {
    void getFilesAndDirectories().then(setFiles);
  });

  // Detect @ in textarea and show file picker
  useKeyboard(() => {
    setTimeout(() => {
      const ref = props.getTextareaRef();
      if (!ref || ref.isDestroyed) return;
      if (props.status() !== 'idle' || props.isModalOpen()) return;

      const currentText = ref.plainText ?? '';

      // Find the last @ that could be triggering the picker
      // Look for @ that's either at start or preceded by whitespace
      const lastAtIndex = findLastTriggerAt(currentText);

      if (lastAtIndex !== null) {
        // Extract filter: text after @ until cursor/end, stopping at whitespace
        const afterAt = currentText.slice(lastAtIndex + 1);
        const filterEnd = afterAt.search(/\s/);
        const filter = filterEnd === -1 ? afterAt : afterAt.slice(0, filterEnd);

        if (!showFilePicker()) {
          setShowFilePicker(true);
          setAtPosition(lastAtIndex);
        }
        setFileFilter(filter);
      } else if (showFilePicker()) {
        // No valid @ trigger, close picker
        setShowFilePicker(false);
        setFileFilter('');
        setFileSelectedIndex(0);
        setAtPosition(null);
      }
    }, 0);
  });

  const handleFileSelect = (path: string) => {
    const ref = props.getTextareaRef();
    const pos = atPosition();
    if (!ref || pos === null) return;

    const currentText = ref.plainText ?? '';

    // Replace @filter with @path
    const beforeAt = currentText.slice(0, pos);
    const afterAt = currentText.slice(pos + 1);

    // Find end of current filter (until whitespace or end)
    const filterEnd = afterAt.search(/\s/);
    const afterFilter = filterEnd === -1 ? '' : afterAt.slice(filterEnd);

    // Add trailing space so findLastTriggerAt sees the @ context as complete
    // (whitespace after @ path means it's no longer an active trigger)
    const separator = afterFilter ? '' : ' ';
    const newText = `${beforeAt}@${path}${separator}${afterFilter}`;
    ref.setText(newText);

    // Move cursor to end of inserted path + separator
    const cursorPosition = beforeAt.length + 1 + path.length + separator.length; // +1 for @
    ref.cursorOffset = cursorPosition;

    // Defer closing so suppressSubmit stays true during this event tick.
    // Without this, the textarea's Enter→submit handler fires after the
    // picker closes synchronously, bypassing the suppressSubmit guard.
    queueMicrotask(() => {
      setShowFilePicker(false);
      setFileFilter('');
      setFileSelectedIndex(0);
      setAtPosition(null);
    });
  };

  const handleFilePickerCancel = () => {
    setShowFilePicker(false);
    setFileFilter('');
    setFileSelectedIndex(0);
    setAtPosition(null);
  };

  const handleFileIndexChange = (index: number) => {
    setFileSelectedIndex(index);
  };

  return {
    showFilePicker,
    fileFilter,
    fileSelectedIndex,
    files,
    handleFileSelect,
    handleFilePickerCancel,
    handleFileIndexChange,
  };
}

/**
 * Find the last @ that could trigger the file picker.
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

/**
 * Hook for @ file mention picker state and logic.
 * Manages file filtering, selection, and path insertion.
 */

import { createSignal, onMount } from 'solid-js';
import { getFilesAndDirectories } from '../../utils/file-list';
import { FocusLayer, useScopedKeyboard } from '../keyboard';
import type { TextareaRef } from '../types';

export type UseFilePickerProps = {
  /** Getter for textarea ref */
  getTextareaRef: () => TextareaRef;
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

  // Detect @ in textarea and show file picker.
  // Global because this monitor must keep running while the file-picker
  // overlay is open (to detect when the user removes the "@" trigger).
  useScopedKeyboard(
    FocusLayer.APP,
    () => {
      setTimeout(() => {
        const ref = props.getTextareaRef();
        if (!ref || ref.isDestroyed) return;

        const currentText = ref.plainText ?? '';

        // Find the last @ that could be triggering the picker
        // Look for @ that's either at start or preceded by whitespace
        const lastAtIndex = findLastTriggerAt(currentText);

        if (lastAtIndex === null) {
          // No valid @ trigger — close picker if open
          if (!showFilePicker()) return;
          setShowFilePicker(false);
          setFileFilter('');
          setFileSelectedIndex(0);
          setAtPosition(null);
          return;
        }

        // Extract filter: text after @ until cursor/end, stopping at whitespace
        const afterAt = currentText.slice(lastAtIndex + 1);
        const filterEnd = afterAt.search(/\s/);
        const filter = filterEnd === -1 ? afterAt : afterAt.slice(0, filterEnd);

        if (!showFilePicker()) {
          setShowFilePicker(true);
          setAtPosition(lastAtIndex);
        }
        setFileFilter(filter);
      }, 0);
    },
    { global: true },
  );

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

/**
 * Hook for @ file mention picker state and logic.
 * Manages file filtering, selection, and path insertion.
 */

import { useState, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { getFilesAndDirectories } from "../../utils/file-list";
import type { Status, TextareaRef } from "../types";

export type UseFilePickerProps = {
  /** Textarea ref for detecting @ and inserting paths */
  textareaRef: TextareaRef;
  /** Current status */
  status: Status;
  /** Whether other modals are open (session picker, command menu, etc.) */
  isModalOpen: boolean;
};

export type UseFilePickerReturn = {
  /** Whether file picker is visible */
  showFilePicker: boolean;
  /** Current filter text (characters after @) */
  fileFilter: string;
  /** Currently selected index */
  fileSelectedIndex: number;
  /** Available files list */
  files: string[];
  /** Handle file selection */
  handleFileSelect: (path: string) => void;
  /** Handle file picker cancel */
  handleFilePickerCancel: () => void;
  /** Handle index change */
  handleFileIndexChange: (index: number) => void;
};

export function useFilePicker({
  textareaRef,
  status,
  isModalOpen,
}: UseFilePickerProps): UseFilePickerReturn {
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [fileSelectedIndex, setFileSelectedIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [atPosition, setAtPosition] = useState<number | null>(null);

  // Load files on mount
  useEffect(() => {
    void getFilesAndDirectories().then(setFiles);
  }, []);

  // Detect @ in textarea and show file picker
  useKeyboard(() => {
    setTimeout(() => {
      if (!textareaRef.current || textareaRef.current.isDestroyed) return;
      if (status !== "idle" || isModalOpen) return;

      const currentText = textareaRef.current.plainText ?? "";

      // Find the last @ that could be triggering the picker
      // Look for @ that's either at start or preceded by whitespace
      const lastAtIndex = findLastTriggerAt(currentText);

      if (lastAtIndex !== null) {
        // Extract filter: text after @ until cursor/end, stopping at whitespace
        const afterAt = currentText.slice(lastAtIndex + 1);
        const filterEnd = afterAt.search(/\s/);
        const filter = filterEnd === -1 ? afterAt : afterAt.slice(0, filterEnd);

        if (!showFilePicker) {
          setShowFilePicker(true);
          setAtPosition(lastAtIndex);
        }
        setFileFilter(filter);
      } else if (showFilePicker) {
        // No valid @ trigger, close picker
        setShowFilePicker(false);
        setFileFilter("");
        setFileSelectedIndex(0);
        setAtPosition(null);
      }
    }, 0);
  });

  const handleFileSelect = (path: string) => {
    if (!textareaRef.current || atPosition === null) return;

    const currentText = textareaRef.current.plainText ?? "";

    // Replace @filter with @path
    const beforeAt = currentText.slice(0, atPosition);
    const afterAt = currentText.slice(atPosition + 1);

    // Find end of current filter (until whitespace or end)
    const filterEnd = afterAt.search(/\s/);
    const afterFilter = filterEnd === -1 ? "" : afterAt.slice(filterEnd);

    const newText = `${beforeAt}@${path}${afterFilter}`;
    textareaRef.current.setText(newText);

    // Move cursor to end of inserted path (after @path)
    const cursorPosition = beforeAt.length + 1 + path.length; // +1 for @
    textareaRef.current.cursorOffset = cursorPosition;

    setShowFilePicker(false);
    setFileFilter("");
    setFileSelectedIndex(0);
    setAtPosition(null);
  };

  const handleFilePickerCancel = () => {
    setShowFilePicker(false);
    setFileFilter("");
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
    if (text[i] === "@") {
      // Valid if at start or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1]!)) {
        // Check if we're still in the @ context (no whitespace after @)
        const afterAt = text.slice(i + 1);
        if (!afterAt.includes(" ") && !afterAt.includes("\n")) {
          return i;
        }
      }
    }
  }
  return null;
}

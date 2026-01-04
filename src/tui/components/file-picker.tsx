/**
 * File picker menu component for @ mentions.
 * Overlays above the textarea when user types '@'.
 * Matches the UI pattern of CommandMenu.
 */

import { useKeyboard } from "@opentui/react";
import { useEffect } from "react";
import { useTheme } from "../../design";
import { fuzzySearch, type FuzzyMatch } from "../../lib/fuzzy";

export type FilePickerProps = {
  /** List of available files (from getFilesAndDirectories) */
  files: string[];
  /** Current filter text (characters typed after @) */
  filter: string;
  /** Currently selected index */
  selectedIndex: number;
  /** Called when user selects a file (Enter) */
  onSelect: (path: string) => void;
  /** Called when user cancels (Escape) */
  onCancel: () => void;
  /** Called when selection index changes */
  onIndexChange: (index: number) => void;
  /** Position from bottom of input area */
  bottom?: number;
  /** Optional width constraint */
  width?: number;
};

const MAX_RESULTS = 50;

/**
 * Get filtered files using fuzzy search.
 * Exported for use in parent component state management.
 */
export function getFilteredFiles(
  files: string[],
  filter: string
): FuzzyMatch[] {
  return fuzzySearch(filter, files, MAX_RESULTS);
}

const VISIBLE_ITEMS = 10;

export function FilePicker({
  files,
  filter,
  selectedIndex,
  onSelect,
  onCancel,
  onIndexChange,
  bottom = 0,
  width,
}: FilePickerProps) {
  const { tokens } = useTheme();

  // Get filtered results
  const results = fuzzySearch(filter, files, MAX_RESULTS);

  // Clamp selection when results change
  useEffect(() => {
    if (selectedIndex >= results.length && results.length > 0) {
      onIndexChange(results.length - 1);
    }
  }, [results.length, selectedIndex, onIndexChange]);

  useKeyboard((key: { name?: string }) => {
    switch (key.name) {
      case "up":
        onIndexChange(Math.max(0, selectedIndex - 1));
        break;
      case "down":
        onIndexChange(Math.min(results.length - 1, selectedIndex + 1));
        break;
      case "return": {
        const selected = results[selectedIndex];
        if (selected) onSelect(selected.item);
        break;
      }
      case "escape":
        onCancel();
        break;
    }
  });

  if (results.length === 0) {
    return (
      <box
        style={{
          position: "absolute",
          left: 0,
          bottom,
          width,
          zIndex: 100,
          backgroundColor: tokens.bgSurface,
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text style={{ fg: tokens.textSubtle }}>No matching files</text>
      </box>
    );
  }

  return (
    <box
      style={{
        position: "absolute",
        left: 0,
        bottom,
        width,
        zIndex: 100,
        backgroundColor: tokens.bgSurface,
        flexDirection: "column",
        maxHeight: VISIBLE_ITEMS + 2,
      }}
    >
      <scrollbox maxHeight={VISIBLE_ITEMS} stickyScroll={false}>
        <box flexDirection="column">
          {results.map((match, idx) => {
            const isSelected = idx === selectedIndex;
            const isDirectory = match.item.endsWith("/");

            return (
              <box
                key={match.item}
                style={{
                  flexDirection: "row",
                  paddingLeft: 1,
                  paddingRight: 1,
                  ...(isSelected && { backgroundColor: tokens.selected }),
                }}
              >
                <HighlightedPath
                  path={match.item}
                  indices={match.indices}
                  isSelected={isSelected}
                  isDirectory={isDirectory}
                  tokens={tokens}
                />
              </box>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
}

type HighlightedPathProps = {
  path: string;
  indices: readonly [number, number][];
  isSelected: boolean;
  isDirectory: boolean;
  tokens: Record<string, string>;
};

/**
 * Render file path with fuzzy match highlighting.
 */
function HighlightedPath({
  path,
  indices,
  isSelected,
  isDirectory,
  tokens,
}: HighlightedPathProps) {
  // No highlighting needed if no matches
  if (indices.length === 0) {
    const fg = isSelected
      ? tokens.primaryBase
      : isDirectory
        ? tokens.primaryBase
        : tokens.textBase;
    return (
      <text style={{ fg }}>
        <b>{isDirectory ? path : `@${path}`}</b>
      </text>
    );
  }

  // Convert ranges to set of highlighted indices
  const highlightedSet = new Set<number>();
  for (const [start, end] of indices) {
    for (let i = start; i <= end; i++) {
      highlightedSet.add(i);
    }
  }

  // Build segments with alternating highlight
  const segments: React.ReactNode[] = [];
  let currentText = "";
  let currentHighlighted = highlightedSet.has(0);

  // Add @ prefix for files
  if (!isDirectory) {
    segments.push(
      <text key="prefix" style={{ fg: isSelected ? tokens.primaryBase : tokens.textBase }}>
        @
      </text>
    );
  }

  for (let i = 0; i < path.length; i++) {
    const isHighlighted = highlightedSet.has(i);
    if (isHighlighted !== currentHighlighted) {
      if (currentText) {
        const fg = currentHighlighted
          ? tokens.warning
          : isSelected
            ? tokens.primaryBase
            : tokens.textBase;
        segments.push(
          currentHighlighted ? (
            <text key={segments.length} style={{ fg }}>
              <b>{currentText}</b>
            </text>
          ) : (
            <text key={segments.length} style={{ fg }}>
              {currentText}
            </text>
          )
        );
      }
      currentText = path[i]!;
      currentHighlighted = isHighlighted;
    } else {
      currentText += path[i];
    }
  }

  // Final segment
  if (currentText) {
    const fg = currentHighlighted
      ? tokens.warning
      : isSelected
        ? tokens.primaryBase
        : tokens.textBase;
    segments.push(
      currentHighlighted ? (
        <text key={segments.length} style={{ fg }}>
          <b>{currentText}</b>
        </text>
      ) : (
        <text key={segments.length} style={{ fg }}>
          {currentText}
        </text>
      )
    );
  }

  return <>{segments}</>;
}

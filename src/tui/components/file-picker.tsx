/**
 * File picker menu component for @ mentions.
 * Overlays above the textarea when user types '@'.
 * Matches the UI pattern of CommandMenu.
 */

import type { ScrollBoxRenderable } from '@opentui/core';
import type { JSX } from 'solid-js';
import { createMemo, Index, mergeProps, Show } from 'solid-js';
import { useTheme } from '../../design';
import { useListNavigation } from '../hooks/use-list-navigation';
import { type FuzzyMatch, fuzzySearch } from '../../lib/fuzzy';

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
  filter: string,
): FuzzyMatch[] {
  return fuzzySearch(filter, files, MAX_RESULTS);
}

const VISIBLE_ITEMS = 10;

export function FilePicker(rawProps: FilePickerProps) {
  const props = mergeProps({ bottom: 0 }, rawProps);
  const { tokens } = useTheme();
  let scrollRef: ScrollBoxRenderable | undefined;

  const results = createMemo(() =>
    fuzzySearch(props.filter, props.files, MAX_RESULTS),
  );

  useListNavigation({
    vimKeys: false,
    itemCount: () => results().length,
    selectedIndex: () => props.selectedIndex,
    setSelectedIndex: (i) => props.onIndexChange(i),
    onSelect: (i) => {
      const match = results()[i];
      if (match) props.onSelect(match.item);
    },
    onCancel: () => props.onCancel(),
    getScrollRef: () => scrollRef,
  });

  return (
    <Show
      when={results().length > 0}
      fallback={
        <box
          style={{
            position: 'absolute',
            left: 0,
            bottom: props.bottom,
            width: props.width,
            zIndex: 100,
            backgroundColor: tokens.bgSurface,
            flexDirection: 'column',
            paddingX: 1,
          }}
        >
          <text style={{ fg: tokens.textSubtle }}>No matching files</text>
        </box>
      }
    >
      <box
        style={{
          position: 'absolute',
          left: 0,
          bottom: props.bottom,
          width: props.width,
          zIndex: 100,
          backgroundColor: tokens.bgSurface,
          flexDirection: 'column',
          maxHeight: VISIBLE_ITEMS + 2,
        }}
      >
        <scrollbox
          ref={scrollRef!}
          maxHeight={VISIBLE_ITEMS}
          stickyScroll={false}
        >
          <box flexDirection="column">
            <Index each={results()}>
              {(match, idx) => {
                const isSelected = () => idx === props.selectedIndex;
                return (
                  <box
                    style={{
                      flexDirection: 'row',
                      paddingX: 1,
                      backgroundColor: isSelected()
                        ? tokens.selected
                        : 'transparent',
                    }}
                  >
                    <HighlightedPath
                      path={match().item}
                      indices={match().indices}
                      isSelected={isSelected()}
                      isDirectory={match().item.endsWith('/')}
                      tokens={tokens}
                    />
                  </box>
                );
              }}
            </Index>
          </box>
        </scrollbox>
      </box>
    </Show>
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
function HighlightedPath(props: HighlightedPathProps) {
  // No highlighting needed if no matches
  if (props.indices.length === 0) {
    const fg = props.isSelected
      ? props.tokens.primaryBase
      : props.isDirectory
        ? props.tokens.primaryBase
        : props.tokens.textBase;
    return (
      <text style={{ fg }}>
        <b>{props.isDirectory ? props.path : `@${props.path}`}</b>
      </text>
    );
  }

  // Convert ranges to set of highlighted indices
  const highlightedSet = new Set<number>();
  for (const [start, end] of props.indices) {
    for (let i = start; i <= end; i++) {
      highlightedSet.add(i);
    }
  }

  // Build segments with alternating highlight
  const segments: JSX.Element[] = [];
  let currentText = '';
  let currentHighlighted = highlightedSet.has(0);

  // Add @ prefix for files
  if (!props.isDirectory) {
    segments.push(
      <text
        style={{
          fg: props.isSelected
            ? props.tokens.primaryBase
            : props.tokens.textBase,
        }}
      >
        @
      </text>,
    );
  }

  for (let i = 0; i < props.path.length; i++) {
    const isHighlighted = highlightedSet.has(i);
    if (isHighlighted !== currentHighlighted) {
      if (currentText) {
        const fg = currentHighlighted
          ? props.tokens.warning
          : props.isSelected
            ? props.tokens.primaryBase
            : props.tokens.textBase;
        segments.push(
          currentHighlighted ? (
            <text style={{ fg }}>
              <b>{currentText}</b>
            </text>
          ) : (
            <text style={{ fg }}>{currentText}</text>
          ),
        );
      }
      currentText = props.path[i] ?? '';
      currentHighlighted = isHighlighted;
    } else {
      currentText += props.path[i];
    }
  }

  // Final segment
  if (currentText) {
    const fg = currentHighlighted
      ? props.tokens.warning
      : props.isSelected
        ? props.tokens.primaryBase
        : props.tokens.textBase;
    segments.push(
      currentHighlighted ? (
        <text style={{ fg }}>
          <b>{currentText}</b>
        </text>
      ) : (
        <text style={{ fg }}>{currentText}</text>
      ),
    );
  }

  return <>{segments}</>;
}

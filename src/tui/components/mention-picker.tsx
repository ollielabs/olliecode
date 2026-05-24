/**
 * Mention picker component for @ mentions.
 * Shows agents (with @prefix) above a divider and files below.
 * Overlays above the textarea when user types '@'.
 */

import type { ScrollBoxRenderable } from '@opentui/core';
import type { JSX } from 'solid-js';
import { createMemo, Index, mergeProps, Show } from 'solid-js';
import { useTheme } from '../../design';
import { useListNavigation } from '../hooks/use-list-navigation';
import { type FuzzyMatch, fuzzySearch } from '../../lib/fuzzy';
import type { AgentMentionItem } from '../hooks/use-mention-picker';

export type MentionPickerProps = {
  /** Available agents (name + description) */
  agents: AgentMentionItem[];
  /** Available files (from getFilesAndDirectories) */
  files: string[];
  /** Current filter text (characters typed after @) */
  filter: string;
  /** Currently selected index (across agents + files) */
  selectedIndex: number;
  /** Called when user selects an item (agent name or file path) */
  onSelect: (value: string) => void;
  /** Called when user cancels (Escape) */
  onCancel: () => void;
  /** Called when selection index changes */
  onIndexChange: (index: number) => void;
  /** Position from bottom of input area */
  bottom?: number;
  /** Optional width constraint */
  width?: number;
};

const MAX_AGENT_RESULTS = 10;
const MAX_FILE_RESULTS = 40;
const VISIBLE_ITEMS = 10;

export function MentionPicker(rawProps: MentionPickerProps) {
  const props = mergeProps({ bottom: 0 }, rawProps);
  const { tokens } = useTheme();
  let scrollRef: ScrollBoxRenderable | undefined;

  // Fuzzy search agents by name
  const agentResults = createMemo(() => {
    const names = props.agents.map((a) => a.name);
    return fuzzySearch(props.filter, names, MAX_AGENT_RESULTS);
  });

  // Fuzzy search files by path
  const fileResults = createMemo(() =>
    fuzzySearch(props.filter, props.files, MAX_FILE_RESULTS),
  );

  // Total selectable items (agents + files)
  const totalCount = createMemo(
    () => agentResults().length + fileResults().length,
  );

  // Resolve which agent item a match corresponds to (for description)
  const getAgentForMatch = (match: FuzzyMatch): AgentMentionItem | undefined =>
    props.agents.find((a) => a.name === match.item);

  useListNavigation({
    vimKeys: false,
    itemCount: totalCount,
    selectedIndex: () => props.selectedIndex,
    setSelectedIndex: (i) => props.onIndexChange(i),
    onSelect: (i) => {
      const agentCount = agentResults().length;
      if (i < agentCount) {
        const match = agentResults()[i];
        if (match) props.onSelect(match.item);
      } else {
        const match = fileResults()[i - agentCount];
        if (match) props.onSelect(match.item);
      }
    },
    onCancel: () => props.onCancel(),
    getScrollRef: () => scrollRef,
  });

  return (
    <Show
      when={totalCount() > 0}
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
          <text style={{ fg: tokens.textSubtle }}>No matches</text>
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
            <Index each={agentResults()}>
              {(match, idx) => {
                const isSelected = () => idx === props.selectedIndex;
                const agent = () => getAgentForMatch(match());
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
                    <HighlightedAgent
                      name={match().item}
                      indices={match().indices}
                      description={agent()?.description ?? ''}
                      isSelected={isSelected()}
                      tokens={tokens}
                    />
                  </box>
                );
              }}
            </Index>

            <Show when={agentResults().length > 0 && fileResults().length > 0}>
              <box
                style={{
                  border: ['top'],
                  borderStyle: 'single',
                  borderColor: tokens.textSubtle,
                }}
              />
            </Show>

            <Index each={fileResults()}>
              {(match, idx) => {
                const globalIdx = () => agentResults().length + idx;
                const isSelected = () => globalIdx() === props.selectedIndex;
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

// ============================================================================
// Agent highlight rendering
// ============================================================================

type HighlightedAgentProps = {
  name: string;
  indices: readonly [number, number][];
  description: string;
  isSelected: boolean;
  tokens: Record<string, string>;
};

/**
 * Render agent name with @prefix, fuzzy match highlighting, and description.
 */
function HighlightedAgent(props: HighlightedAgentProps) {
  const baseFg = props.isSelected
    ? props.tokens.primaryBase
    : (props.tokens.successBase ?? props.tokens.primaryBase);
  const descFg = props.tokens.textSubtle;

  // No highlighting — show plain
  if (props.indices.length === 0) {
    if (props.description) {
      return (
        <>
          <text style={{ fg: baseFg }}>
            <b>@{props.name}</b>
          </text>
          <text style={{ fg: descFg }}> {props.description}</text>
        </>
      );
    }
    return (
      <text style={{ fg: baseFg }}>
        <b>@{props.name}</b>
      </text>
    );
  }

  // Build highlighted segments for the name
  const highlightedSet = new Set<number>();
  for (const [start, end] of props.indices) {
    for (let i = start; i <= end; i++) {
      highlightedSet.add(i);
    }
  }

  const segments: JSX.Element[] = [];

  // @ prefix (always non-highlighted)
  segments.push(
    <text style={{ fg: baseFg }}>
      <b>@</b>
    </text>,
  );

  let currentText = '';
  let currentHighlighted = highlightedSet.has(0);

  for (let i = 0; i < props.name.length; i++) {
    const isHighlighted = highlightedSet.has(i);
    if (isHighlighted !== currentHighlighted) {
      if (currentText) {
        const fg = currentHighlighted ? props.tokens.warning : baseFg;
        segments.push(
          <text style={{ fg }}>
            <b>{currentText}</b>
          </text>,
        );
      }
      currentText = props.name[i] ?? '';
      currentHighlighted = isHighlighted;
    } else {
      currentText += props.name[i];
    }
  }

  // Final segment
  if (currentText) {
    const fg = currentHighlighted ? props.tokens.warning : baseFg;
    segments.push(
      <text style={{ fg }}>
        <b>{currentText}</b>
      </text>,
    );
  }

  // Description suffix
  if (props.description) {
    segments.push(<text style={{ fg: descFg }}> {props.description}</text>);
  }

  return <>{segments}</>;
}

// ============================================================================
// File path highlight rendering (preserved from original file-picker)
// ============================================================================

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
    return <text style={{ fg }}>{props.path}</text>;
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

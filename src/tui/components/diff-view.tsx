/**
 * DiffView component - displays file diffs using OpenTUI's <diff> component.
 * Used in confirmation dialogs and tool result messages for file operations.
 *
 * Styling is intentionally minimal: +/- signs with light background shading.
 * Syntax highlighting matches the theme but the diff itself stays legible
 * through color contrast on added/removed lines only.
 */

import { createMemo, mergeProps } from 'solid-js';
import { useTheme } from '../../design';
import { generateDiff, getFiletype } from '../../utils/diff';

export type DiffViewProps = {
  /** File path for display and syntax detection */
  filePath: string;
  /** Content before changes (used if diff is not provided) */
  before: string;
  /** Content after changes (used if diff is not provided) */
  after: string;
  /** Pre-computed unified diff string (if available, before/after are ignored) */
  diff?: string;
  /** View mode: "unified" for single column, "split" for side-by-side */
  view?: 'unified' | 'split';
};

export function DiffView(rawProps: DiffViewProps) {
  const props = mergeProps({ view: 'unified' as const }, rawProps);
  const { tokens, syntaxStyle } = useTheme();

  // Use pre-computed diff if provided, otherwise generate from before/after
  const diffString = createMemo(() =>
    props.diff || generateDiff(props.filePath, props.before, props.after),
  );
  const filetype = createMemo(() => getFiletype(props.filePath));

  return (
    <box style={{ flexDirection: 'column' }}>
      <diff
        diff={diffString()}
        view={props.view}
        filetype={filetype()}
        syntaxStyle={syntaxStyle}
        showLineNumbers={false}
        wrapMode="word"
        addedBg={tokens.diffAddBg}
        removedBg={tokens.diffDeleteBg}
        contextBg="transparent"
        addedSignColor={tokens.diffAdd}
        removedSignColor={tokens.diffDelete}
      />
    </box>
  );
}

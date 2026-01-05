/**
 * DiffView component - displays file diffs using OpenTUI's <diff> component.
 * Used in confirmation dialogs and tool result messages for file operations.
 */

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
  /** Max height in lines */
  maxHeight?: number;
  /** View mode: "unified" for single column, "split" for side-by-side */
  view?: 'unified' | 'split';
};

export function DiffView({
  filePath,
  before,
  after,
  diff,
  maxHeight = 15,
  view = 'split',
}: DiffViewProps) {
  const { tokens, syntaxStyle } = useTheme();

  // Use pre-computed diff if provided, otherwise generate from before/after
  const diffString = diff || generateDiff(filePath, before, after);
  const filetype = getFiletype(filePath);

  return (
    <box style={{ flexDirection: 'column' }}>
      <text style={{ fg: tokens.textMuted, marginBottom: 1 }}>{filePath}</text>
      <diff
        diff={diffString}
        view={view}
        filetype={filetype}
        syntaxStyle={syntaxStyle}
        showLineNumbers={true}
        wrapMode="none"
        addedBg={tokens.diffAddBg}
        removedBg={tokens.diffDeleteBg}
        contextBg="transparent"
        addedSignColor={tokens.diffAdd}
        removedSignColor={tokens.diffDelete}
        lineNumberFg={tokens.textMuted}
        lineNumberBg={tokens.bgBase}
        addedLineNumberBg={tokens.diffAddBg}
        removedLineNumberBg={tokens.diffDeleteBg}
        style={{ maxHeight, flexGrow: 1 }}
      />
    </box>
  );
}

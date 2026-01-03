/**
 * DiffView component - displays file diffs using OpenTUI's <diff> component.
 * Used in confirmation dialogs for edit_file operations.
 */

import { useTheme } from "../../design";
import { generateDiff, getFiletype } from "../../utils/diff";

export type DiffViewProps = {
  filePath: string;
  before: string;
  after: string;
  maxHeight?: number;
  view?: "unified" | "split";
};

export function DiffView({
  filePath,
  before,
  after,
  maxHeight = 15,
  view = "split",
}: DiffViewProps) {
  const { tokens, syntaxStyle } = useTheme();

  const diffString = generateDiff(filePath, before, after);
  const filetype = getFiletype(filePath);

  return (
    <box style={{ flexDirection: "column" }}>
      <text style={{ fg: tokens.textMuted, marginBottom: 1 }}>
        {filePath}
      </text>
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

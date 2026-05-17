/**
 * Compaction summary component.
 * Renders a visually distinct separator in the chat showing the
 * LLM-generated summary of compacted messages.
 */

import { createMemo } from 'solid-js';
import { useTheme } from '../../design';
import { createMarkdownSyntaxStyle } from '../utils';

export type CompactionSummaryProps = {
  content: string;
  compactedCount: number;
};

export function CompactionSummary(props: CompactionSummaryProps) {
  const { tokens } = useTheme();
  const markdownStyle = createMemo(() => createMarkdownSyntaxStyle(tokens));

  return (
    <box flexDirection="column">
      <box
        style={{
          border: ['top'],
          borderStyle: 'single',
          borderColor: tokens.borderMuted,
        }}
      />
      <box marginX={2} marginY={1}>
        <text style={{ fg: tokens.textSubtle }}>
          <strong>Compaction</strong> ({props.compactedCount} messages
          summarized)
        </text>
      </box>
      <box marginLeft={2}>
        <code
          selectable={true}
          content={props.content}
          filetype="markdown"
          syntaxStyle={markdownStyle()}
          drawUnstyledText={true}
        />
      </box>
      <box
        marginTop={1}
        style={{
          border: ['bottom'],
          borderStyle: 'single',
          borderColor: tokens.borderMuted,
        }}
      />
    </box>
  );
}

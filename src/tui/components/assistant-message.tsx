/**
 * Assistant message component.
 * Renders markdown content with syntax highlighting.
 */

import { createMemo } from 'solid-js';
import { useTheme } from '../../design';
import { createMarkdownSyntaxStyle } from '../utils';

export type AssistantMessageProps = {
  content: string;
};

export function AssistantMessage(props: AssistantMessageProps) {
  const { tokens } = useTheme();
  const markdownStyle = createMemo(() => createMarkdownSyntaxStyle(tokens));

  return (
    <box flexDirection="column" marginLeft={2}>
      <code
        selectable={true}
        content={props.content}
        filetype="markdown"
        syntaxStyle={markdownStyle()}
        drawUnstyledText={true}
      />
    </box>
  );
}

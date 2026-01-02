/**
 * Assistant message component.
 * Renders markdown content with syntax highlighting.
 */

import { useTheme } from "../../design";
import { createMarkdownSyntaxStyle } from "../utils";

export type AssistantMessageProps = {
  content: string;
};

export function AssistantMessage({ content }: AssistantMessageProps) {
  const { tokens } = useTheme();
  const markdownStyle = createMarkdownSyntaxStyle(tokens);

  return (
    <box flexDirection="column" marginLeft={2}>
      <code
        selectable={true}
        content={content}
        filetype="markdown"
        syntaxStyle={markdownStyle}
        drawUnstyledText={true}
      />
    </box>
  );
}

/**
 * User message component.
 * Displays user input with a blue left border.
 */

import { useTheme } from "../../design";

export type UserMessageProps = {
  content: string;
  attachedFiles?: string[];
};

export function UserMessage({ content, attachedFiles }: UserMessageProps) {
  const { tokens } = useTheme();

  return (
    <box
      style={{
        backgroundColor: tokens.bgSurface,
        padding: 1,
        border: ["left"],
        borderStyle: "heavy",
        borderColor: tokens.borderAccent,
      }}
      flexDirection="column"
    >
      <text>{content}</text>
      {attachedFiles && attachedFiles.length > 0 && (
        <box marginTop={1}>
          <text style={{ fg: tokens.textSubtle }}>
            [{attachedFiles.length} file{attachedFiles.length !== 1 ? "s" : ""} attached]
          </text>
        </box>
      )}
    </box>
  );
}

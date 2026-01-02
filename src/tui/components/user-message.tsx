/**
 * User message component.
 * Displays user input with a blue left border.
 */

import { useTheme } from "../../design";

export type UserMessageProps = {
  content: string;
};

export function UserMessage({ content }: UserMessageProps) {
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
    >
      <text>{content}</text>
    </box>
  );
}

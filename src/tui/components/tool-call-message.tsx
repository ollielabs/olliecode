/**
 * Tool call message component.
 * Displays when the agent invokes a tool.
 */

import { useTheme } from "../../design";

export type ToolCallMessageProps = {
  name: string;
  args: Record<string, unknown>;
};

export function ToolCallMessage({ name, args }: ToolCallMessageProps) {
  const { tokens } = useTheme();

  return (
    <box
      style={{
        backgroundColor: tokens.bgSurface,
        padding: 1,
        border: ["left"],
        borderStyle: "heavy",
        borderColor: tokens.warning,
      }}
    >
      <text style={{ fg: tokens.warning }}>Tool: {name}</text>
      <text style={{ fg: tokens.textMuted }}> {JSON.stringify(args)}</text>
    </box>
  );
}

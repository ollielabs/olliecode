/**
 * Tool result message component.
 * Displays the result of a tool execution with success/error styling.
 */

import { useTheme } from "../../design";

export type ToolResultMessageProps = {
  name: string;
  output: string;
  error?: string;
};

export function ToolResultMessage({ name, output, error }: ToolResultMessageProps) {
  const { tokens } = useTheme();

  return (
    <box
      style={{
        backgroundColor: tokens.bgSurface,
        padding: 1,
        border: ["left"],
        borderStyle: "heavy",
        borderColor: error ? tokens.error : tokens.success,
      }}
    >
      {error ? (
        <text style={{ fg: tokens.error }}>
          x {name}: {error}
        </text>
      ) : (
        <text style={{ fg: tokens.success }}>
          + {name}: {output.length > 100 ? output.slice(0, 100) + "..." : output}
        </text>
      )}
    </box>
  );
}

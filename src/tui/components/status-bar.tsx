import type { AgentMode } from "../../agent/modes";
import { useTheme } from "../../design";

export type Status = "idle" | "thinking" | "error";

export type StatusBarProps = {
  model: string;
  status: Status;
  error: string;
  mode?: AgentMode;
};

export function StatusBar({
  model,
  status,
  error,
  mode = "build",
}: StatusBarProps) {
  const { tokens } = useTheme();

  const modeColors: Record<AgentMode, string> = {
    plan: tokens.info,
    build: tokens.success,
  };

  return (
    <box style={{ flexDirection: "row", marginTop: 1, justifyContent: "space-between" }}>
      <box style={{ flexDirection: "row" }}>
        <text style={{ fg: modeColors[mode] }}>[{mode.toUpperCase()}]</text>
        <text style={{ fg: tokens.textMuted }}> • {model}</text>
        {status === "thinking" && (
          <text style={{ fg: tokens.primaryBase }}> • Thinking...</text>
        )}
        {status === "error" && (
          <text style={{ fg: tokens.error }}> • Error: {error}</text>
        )}
      </box>
      <box style={{ flexDirection: "row" }}>
        <text style={{ fg: tokens.textBase }}><b>tab</b></text>
        <text style={{ fg: tokens.textMuted }}> switch mode  </text>
        <text style={{ fg: tokens.textBase }}><b>ctrl+p</b></text>
        <text style={{ fg: tokens.textMuted }}> commands</text>
      </box>
    </box>
  );
}

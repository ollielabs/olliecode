import type { AgentMode } from "../../agent/modes";

export type Status = "idle" | "thinking" | "error";

export type StatusBarProps = {
  model: string;
  status: Status;
  error: string;
  mode?: AgentMode;
};

// Mode colors
const MODE_COLORS: Record<AgentMode, string> = {
  plan: "#3498db",  // Blue for plan mode
  build: "#27ae60", // Green for build mode
};

export function StatusBar({ model, status, error, mode = "build" }: StatusBarProps) {
  const modeColor = MODE_COLORS[mode];
  const modeLabel = mode.toUpperCase();
  
  return (
    <box flexDirection="row" marginTop={1}>
      <text fg={modeColor}>[{modeLabel}]</text>
      <text> • {model} • </text>
      {status === "thinking" ? (
        <text fg="#7aa2f7">Thinking…</text>
      ) : status === "error" ? (
        <text fg="#ff5555">Error: {error}</text>
      ) : (
        <text fg="#888">Tab to switch mode</text>
      )}
    </box>
  );
}

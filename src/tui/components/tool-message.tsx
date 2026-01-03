/**
 * Tool message component.
 * Displays tool calls and results with status icons and tool-specific formatting.
 */

import { useTheme } from "../../design";
import { DiffView } from "./diff-view";

export type ToolMessageProps = {
  type: "call" | "result";
  name: string;
  args?: Record<string, unknown>;
  output?: string;
  error?: string;
  expanded?: boolean;
};

/** Tools that always show their output (not collapsible) */
const ALWAYS_VISIBLE_TOOLS = ["edit_file", "write_file"];

const MAX_COLLAPSED_LINES = 10;

/**
 * Format the tool header based on tool type and arguments.
 */
function formatToolHeader(name: string, args?: Record<string, unknown>): string {
  if (!args) return "";

  switch (name) {
    case "read_file":
      return String(args.path ?? "");
    case "write_file":
      return String(args.path ?? "");
    case "edit_file":
      return String(args.path ?? "");
    case "run_command": {
      const cmd = String(args.command ?? "");
      return `$ ${cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd}`;
    }
    case "glob":
      return String(args.pattern ?? "");
    case "grep":
      return `"${args.pattern}" in ${args.include || "*"}`;
    case "list_dir":
      return String(args.path ?? ".");
    case "task":
      return String(args.description ?? "");
    case "todo_write": {
      const todos = args.todos as Array<{ status: string }> | undefined;
      const pending = todos?.filter((t) => t.status !== "completed").length ?? 0;
      return `${pending} active`;
    }
    case "todo_read":
      return "";
    default:
      return "";
  }
}

/**
 * Format the tool output based on tool type.
 * Returns the text to display based on expanded state.
 */
function formatToolOutput(
  name: string,
  output?: string,
  error?: string,
  expanded?: boolean,
  args?: Record<string, unknown>
): string {
  if (error) {
    return error;
  }

  if (!output) {
    return "";
  }

  const lines = output.split("\n");

  // Tool-specific formatting
  switch (name) {
    case "read_file":
      if (!expanded) {
        return `${lines.length} lines`;
      }
      return output;

    case "glob":
      try {
        const files = JSON.parse(output) as string[];
        if (!expanded) {
          return `${files.length} files found`;
        }
        return files.join("\n");
      } catch {
        break;
      }

    case "grep":
      try {
        const result = JSON.parse(output) as { matches?: unknown[] };
        const matchCount = result.matches?.length ?? 0;
        if (!expanded) {
          return `${matchCount} matches`;
        }
        return output;
      } catch {
        break;
      }

    case "run_command":
      try {
        const result = JSON.parse(output) as { exitCode: number; stdout: string; stderr: string };
        const stdoutLines = result.stdout.split("\n").length;
        if (!expanded) {
          return `Exit ${result.exitCode}${stdoutLines > 1 ? ` (${stdoutLines} lines)` : ""}`;
        }
        return result.stdout || result.stderr;
      } catch {
        break;
      }

    case "list_dir":
      try {
        const result = JSON.parse(output) as { entries?: unknown[] };
        const entryCount = result.entries?.length ?? 0;
        if (!expanded) {
          return `${entryCount} entries`;
        }
        return output;
      } catch {
        break;
      }

    case "task":
      try {
        const result = JSON.parse(output) as { success?: boolean; iterations?: number };
        const status = result.success ? "Completed" : "Failed";
        const iterations = result.iterations ? ` in ${result.iterations} iterations` : "";
        if (!expanded) {
          return `${status}${iterations}`;
        }
        return output;
      } catch {
        break;
      }

    case "write_file":
      // Handled separately in render with syntax highlighting
      return "";

    case "edit_file":
      // Handled separately in render with DiffView component
      return "";

    case "todo_write":
    case "todo_read":
      // Don't show output for todo operations
      return "";
  }

  // Default: truncate to MAX_COLLAPSED_LINES when collapsed
  if (!expanded && lines.length > MAX_COLLAPSED_LINES) {
    const truncated = lines.slice(0, MAX_COLLAPSED_LINES).join("\n");
    return `${truncated}\n... (${lines.length - MAX_COLLAPSED_LINES} more lines)`;
  }

  return output;
}

export function ToolMessage({ type, name, args, output, error, expanded }: ToolMessageProps) {
  const { tokens } = useTheme();

  // Status icon and color based on type and error state
  const icon = type === "call" ? "\u25D0" : error ? "\u2717" : "\u2713"; // ◐ ✗ ✓
  const iconColor = type === "call" ? tokens.warning : error ? tokens.error : tokens.success;

  // Format header and output
  const header = formatToolHeader(name, args);
  const formattedOutput = type === "result" ? formatToolOutput(name, output, error, expanded, args) : "";

  // Determine if this tool's output is collapsible
  const isAlwaysVisible = ALWAYS_VISIBLE_TOOLS.includes(name);
  const isCollapsible = type === "result" && output && !error && !isAlwaysVisible;
  const showExpandHint = isCollapsible && !expanded;

  // Check if we should render special content for file operations
  const isEditResult = type === "result" && name === "edit_file" && !error && 
    typeof args?.oldString === "string" && typeof args?.newString === "string";
  const isWriteResult = type === "result" && name === "write_file" && !error && 
    typeof args?.content === "string";

  return (
    <box
      style={{
        backgroundColor: tokens.bgSurface,
        padding: 1,
        border: ["left"],
        borderStyle: "heavy",
        borderColor: iconColor,
      }}
    >
      {/* Header line: icon + tool name + formatted args + expand hint */}
      <box style={{ flexDirection: "row" }}>
        <text style={{ fg: iconColor }}>{icon} </text>
        <text style={{ fg: tokens.primaryBase }}>{name}</text>
        {header && <text style={{ fg: tokens.textMuted }}> {header}</text>}
        {showExpandHint && <text style={{ fg: tokens.textMuted }}> [ctrl+e to expand]</text>}
      </box>

      {/* Edit file result: show diff */}
      {isEditResult && (
        <box style={{ marginTop: 1 }}>
          <DiffView
            filePath={String(args.path ?? "")}
            before={String(args.oldString)}
            after={String(args.newString)}
            maxHeight={20}
          />
        </box>
      )}

      {/* Write file result: show content */}
      {isWriteResult && args && (
        <box style={{ marginTop: 1 }}>
          <text style={{ fg: tokens.textMuted }}>{output}</text>
          <box style={{ marginTop: 1, backgroundColor: tokens.bgBase, padding: 1 }}>
            <text style={{ fg: tokens.textBase }}>{String(args.content)}</text>
          </box>
        </box>
      )}

      {/* Standard output (for other tools) */}
      {type === "result" && formattedOutput && !isEditResult && !isWriteResult && (
        <box style={{ marginTop: 1 }}>
          <text style={{ fg: error ? tokens.error : tokens.textMuted }}>{formattedOutput}</text>
        </box>
      )}
    </box>
  );
}

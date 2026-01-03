/**
 * Tool message component.
 * Displays a unified tool operation that evolves through states:
 * pending → confirming → executing → completed/error/denied/blocked
 *
 * This replaces the old separate tool_call + tool_result + ConfirmationDialog pattern.
 */

import { useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../../design";
import type { SemanticTokens } from "../../design/tokens";
import { DiffView } from "./diff-view";
import type { ToolDisplayMessage, ToolState, ToolMetadata } from "../types";
import type { ConfirmationResponse } from "../../agent/safety/types";

export type ToolMessageProps = {
  message: ToolDisplayMessage;
  /** Called when user responds to confirmation (only when state is "confirming") */
  onConfirmationResponse?: (response: ConfirmationResponse) => void;
  /** Whether this tool is currently awaiting confirmation input */
  isActiveConfirmation?: boolean;
  /** Whether to show expanded output for read-only tools (toggle with Ctrl+E) */
  expanded?: boolean;
};

/** Read-only tools that support expand/collapse */
const EXPANDABLE_TOOLS = ["read_file", "glob", "grep", "list_dir"];

/**
 * Format the tool header based on tool type and arguments.
 */
function formatToolHeader(name: string, args: Record<string, unknown>): string {
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
      return `"${args.pattern}"`;
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
 * Get the status icon for a tool state.
 */
function getStatusIcon(state: ToolState): string {
  switch (state.status) {
    case "pending":
    case "executing":
      return "◐"; // Half circle - in progress
    case "confirming":
      return "△"; // Triangle - needs attention
    case "completed":
      return "✓"; // Checkmark - success
    case "error":
    case "blocked":
      return "✗"; // X - failure
    case "denied":
      return "⊘"; // Circled slash - denied
  }
}

/**
 * Get the icon color for a tool state.
 */
function getStatusColor(state: ToolState, tokens: Record<string, string>): string {
  switch (state.status) {
    case "pending":
    case "executing":
      return tokens.warning ?? "#f59e0b";
    case "confirming":
      return tokens.warning ?? "#f59e0b";
    case "completed":
      return tokens.success ?? "#22c55e";
    case "error":
    case "blocked":
      return tokens.error ?? "#ef4444";
    case "denied":
      return tokens.textMuted ?? "#6b7280";
    default:
      return tokens.textMuted ?? "#6b7280";
  }
}

/**
 * Format completed output for display.
 */
function formatCompletedOutput(
  name: string,
  output: string,
  metadata?: ToolMetadata
): string {
  switch (name) {
    case "read_file": {
      const lineCount = metadata?.lineCount ?? output.split("\n").length;
      return `${lineCount} lines`;
    }
    case "glob": {
      const matchCount = metadata?.matchCount;
      if (matchCount !== undefined) return `${matchCount} files found`;
      try {
        const files = JSON.parse(output) as string[];
        return `${files.length} files found`;
      } catch {
        return output;
      }
    }
    case "grep": {
      const matchCount = metadata?.matchCount;
      if (matchCount !== undefined) return `${matchCount} matches`;
      try {
        const result = JSON.parse(output) as { matches?: unknown[] };
        return `${result.matches?.length ?? 0} matches`;
      } catch {
        return output;
      }
    }
    case "run_command": {
      try {
        const result = JSON.parse(output) as { exitCode: number; stdout: string };
        const exitCode = metadata?.exitCode ?? result.exitCode;
        const stdoutLines = result.stdout.split("\n").length;
        return `Exit ${exitCode}${stdoutLines > 1 ? ` (${stdoutLines} lines)` : ""}`;
      } catch {
        return output;
      }
    }
    case "list_dir": {
      try {
        const result = JSON.parse(output) as { entries?: unknown[] };
        return `${result.entries?.length ?? 0} entries`;
      } catch {
        return output;
      }
    }
    case "task": {
      try {
        const result = JSON.parse(output) as { success?: boolean; iterations?: number };
        const status = result.success ? "Completed" : "Failed";
        const iterations = result.iterations ? ` in ${result.iterations} iterations` : "";
        return `${status}${iterations}`;
      } catch {
        return output;
      }
    }
    case "write_file":
    case "edit_file":
    case "todo_write":
    case "todo_read":
      // These have special rendering, don't show raw output summary
      return "";
    default:
      // Truncate long output
      const lines = output.split("\n");
      if (lines.length > 3) {
        return `${lines.length} lines of output`;
      }
      return output.slice(0, 100);
  }
}

/**
 * Inline tool display - single line for simple operations.
 */
function InlineTool({
  icon,
  iconColor,
  name,
  header,
  suffix,
  dimmed,
  tokens,
}: {
  icon: string;
  iconColor: string;
  name: string;
  header: string;
  suffix?: string;
  /** When true, dims the text to indicate denied/blocked state */
  dimmed?: boolean;
  tokens: SemanticTokens;
}) {
  // Use muted color for dimmed (denied/blocked) items
  const textColor = dimmed ? tokens.textMuted : tokens.primaryBase;
  const headerColor = tokens.textMuted;

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
      <box style={{ flexDirection: "row" }}>
        <text style={{ fg: iconColor }}>{icon} </text>
        <text style={{ fg: textColor }}>{name}</text>
        {header && <text style={{ fg: headerColor }}> {header}</text>}
        {suffix && <text style={{ fg: tokens.textMuted }}> {suffix}</text>}
      </box>
    </box>
  );
}

/**
 * Block tool display - multi-line with content area.
 */
function BlockTool({
  icon,
  iconColor,
  name,
  header,
  children,
  tokens,
}: {
  icon: string;
  iconColor: string;
  name: string;
  header: string;
  children: React.ReactNode;
  tokens: SemanticTokens;
}) {
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
      <box style={{ flexDirection: "row" }}>
        <text style={{ fg: iconColor }}>{icon} </text>
        <text style={{ fg: tokens.primaryBase }}>{name}</text>
        {header && <text style={{ fg: tokens.textMuted }}> {header}</text>}
      </box>
      <box style={{ marginTop: 1 }}>{children}</box>
    </box>
  );
}

/**
 * Confirmation view - shows preview and action buttons.
 */
function ConfirmingView({
  message,
  onResponse,
  isActive,
  tokens,
}: {
  message: ToolDisplayMessage;
  onResponse?: (response: ConfirmationResponse) => void;
  isActive?: boolean;
  tokens: SemanticTokens;
}) {
  const { state, name, args } = message;
  if (state.status !== "confirming") return null;

  const preview = state.preview;
  const respondedRef = useRef(false);
  const onResponseRef = useRef(onResponse);

  useEffect(() => {
    onResponseRef.current = onResponse;
    respondedRef.current = false;
  }, [onResponse]);

  useKeyboard((key: { name?: string }) => {
    if (!isActive || respondedRef.current || !onResponseRef.current) return;

    switch (key.name?.toLowerCase()) {
      case "y":
        respondedRef.current = true;
        onResponseRef.current({ action: "allow" });
        break;
      case "n":
      case "escape":
      case "q":
        respondedRef.current = true;
        onResponseRef.current({ action: "deny" });
        break;
      case "a":
        respondedRef.current = true;
        onResponseRef.current({ action: "allow_always", forTool: name });
        break;
    }
  });

  const header = formatToolHeader(name, args);

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
      {/* Header */}
      <box style={{ flexDirection: "row" }}>
        <text style={{ fg: tokens.warning }}>△ </text>
        <text style={{ fg: tokens.primaryBase }}>{name}</text>
        {header && <text style={{ fg: tokens.textMuted }}> {header}</text>}
      </box>

      {/* Preview content */}
      {preview && (
        <box style={{ marginTop: 1 }}>
          {preview.type === "command" && (
            <box
              style={{
                backgroundColor: tokens.bgBase,
                padding: 1,
                border: ["left"],
                borderStyle: "single",
                borderColor: tokens.borderMuted,
              }}
            >
              <text style={{ fg: tokens.success }}>$ {preview.command}</text>
              <text style={{ fg: tokens.textMuted, marginTop: 1 }}>
                cwd: {preview.cwd}
              </text>
            </box>
          )}

          {preview.type === "content" && (
            <box
              style={{
                backgroundColor: tokens.bgBase,
                padding: 1,
                border: ["left"],
                borderStyle: "single",
                borderColor: tokens.borderMuted,
              }}
            >
              <text style={{ fg: tokens.textBase }}>
                {preview.content}
                {preview.truncated && "\n[truncated...]"}
              </text>
            </box>
          )}

          {preview.type === "diff" && (
            <DiffView
              filePath={preview.filePath}
              before={preview.before}
              after={preview.after}
              maxHeight={15}
              view="split"
            />
          )}
        </box>
      )}

      {/* Action buttons */}
      <box style={{ flexDirection: "row", marginTop: 1 }}>
        <text>
          <span style={{ fg: tokens.textMuted }}>[</span>
          <u style={{ fg: tokens.success }}>Y</u>
          <span style={{ fg: tokens.textMuted }}>]es  [</span>
          <u style={{ fg: tokens.error }}>N</u>
          <span style={{ fg: tokens.textMuted }}>/Esc]o  [</span>
          <u style={{ fg: tokens.primaryBase }}>A</u>
          <span style={{ fg: tokens.textMuted }}>]lways</span>
        </text>
      </box>
    </box>
  );
}

/**
 * Completed view for edit_file - shows persistent diff.
 */
function EditCompleted({
  message,
  tokens,
}: {
  message: ToolDisplayMessage;
  tokens: SemanticTokens;
}) {
  const { state, name, args } = message;
  if (state.status !== "completed") return null;

  const filePath = state.metadata?.filePath ?? String(args.path ?? "");
  const diff = state.metadata?.diff;

  // If we have a stored diff from confirmation, use it
  // Otherwise, try to construct from args (for backward compatibility)
  const hasDiff = diff || (args.oldString && args.newString);

  return (
    <BlockTool
      icon="✓"
      iconColor={tokens.success}
      name={name}
      header={filePath}
      tokens={tokens}
    >
      {hasDiff ? (
        <DiffView
          filePath={filePath}
          before={diff ? "" : String(args.oldString ?? "")}
          after={diff ? "" : String(args.newString ?? "")}
          diff={diff}
          maxHeight={25}
          view="split"
        />
      ) : (
        <text style={{ fg: tokens.textMuted }}>{state.output}</text>
      )}
    </BlockTool>
  );
}

/**
 * Completed view for write_file - shows content or diff for new files.
 */
function WriteCompleted({
  message,
  tokens,
}: {
  message: ToolDisplayMessage;
  tokens: SemanticTokens;
}) {
  const { state, name, args } = message;
  if (state.status !== "completed") return null;

  const filePath = state.metadata?.filePath ?? String(args.path ?? "");
  const isNewFile = state.metadata?.isNewFile ?? true;
  const content = String(args.content ?? "");

  return (
    <BlockTool
      icon="✓"
      iconColor={tokens.success}
      name={name}
      header={filePath}
      tokens={tokens}
    >
      {isNewFile ? (
        // New file: show unified diff (all additions)
        <DiffView
          filePath={filePath}
          before=""
          after={content}
          maxHeight={25}
          view="unified"
        />
      ) : (
        // Overwrite: would need before content for proper diff
        // For now just show the output message
        <text style={{ fg: tokens.textMuted }}>{state.output}</text>
      )}
    </BlockTool>
  );
}

/**
 * Completed view for run_command - shows output.
 */
function CommandCompleted({
  message,
  tokens,
}: {
  message: ToolDisplayMessage;
  tokens: SemanticTokens;
}) {
  const { state, name, args } = message;
  if (state.status !== "completed") return null;

  const description = String(args.description ?? "Shell");
  const command = String(args.command ?? "");

  let stdout = "";
  let stderr = "";
  let exitCode = state.metadata?.exitCode ?? 0;

  try {
    const result = JSON.parse(state.output) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    stdout = result.stdout;
    stderr = result.stderr;
    exitCode = result.exitCode;
  } catch {
    stdout = state.output;
  }

  const output = stdout || stderr;
  const icon = exitCode === 0 ? "✓" : "✗";
  const iconColor = exitCode === 0 ? tokens.success : tokens.error;

  return (
    <BlockTool
      icon={icon}
      iconColor={iconColor}
      name={`# ${description}`}
      header=""
      tokens={tokens}
    >
      <text style={{ fg: tokens.textBase }}>$ {command}</text>
      {output && (
        <box style={{ marginTop: 1 }}>
          <text style={{ fg: tokens.textBase }}>{output}</text>
        </box>
      )}
    </BlockTool>
  );
}

/**
 * Main ToolMessage component.
 */
export function ToolMessage({
  message,
  onConfirmationResponse,
  isActiveConfirmation,
  expanded,
}: ToolMessageProps) {
  const { tokens } = useTheme();
  const { state, name, args } = message;

  const icon = getStatusIcon(state);
  const iconColor = getStatusColor(state, tokens);
  const header = formatToolHeader(name, args);

  // State-based rendering
  switch (state.status) {
    case "pending":
    case "executing":
      return (
        <InlineTool
          icon={icon}
          iconColor={iconColor}
          name={name}
          header={header}
          suffix={state.status === "executing" ? "(running...)" : ""}
          tokens={tokens}
        />
      );

    case "confirming":
      return (
        <ConfirmingView
          message={message}
          onResponse={onConfirmationResponse}
          isActive={isActiveConfirmation}
          tokens={tokens}
        />
      );

    case "completed":
      // Tool-specific completed views (write tools - always show full output)
      if (name === "edit_file") {
        return <EditCompleted message={message} tokens={tokens} />;
      }
      if (name === "write_file") {
        return <WriteCompleted message={message} tokens={tokens} />;
      }
      if (name === "run_command") {
        return <CommandCompleted message={message} tokens={tokens} />;
      }

      // Read-only tools: support expand/collapse
      const outputSummary = formatCompletedOutput(
        name,
        state.output,
        state.metadata
      );
      
      // Show expanded view for expandable tools when expanded is true
      if (expanded && EXPANDABLE_TOOLS.includes(name) && state.output) {
        return (
          <BlockTool
            icon={icon}
            iconColor={iconColor}
            name={name}
            header={header}
            tokens={tokens}
          >
            <text style={{ fg: tokens.textBase }}>{state.output}</text>
          </BlockTool>
        );
      }

      // Default: inline with summary
      // Show expand hint for expandable tools when collapsed
      const isExpandable = EXPANDABLE_TOOLS.includes(name);
      const expandHint = isExpandable ? " [ctrl+e to expand]" : "";
      const suffix = outputSummary 
        ? `(${outputSummary})${expandHint}`
        : isExpandable ? "[ctrl+e to expand]" : undefined;

      return (
        <InlineTool
          icon={icon}
          iconColor={iconColor}
          name={name}
          header={header}
          suffix={suffix}
          tokens={tokens}
        />
      );

    case "error":
      return (
        <BlockTool
          icon={icon}
          iconColor={iconColor}
          name={name}
          header={header}
          tokens={tokens}
        >
          <text style={{ fg: tokens.error }}>{state.error}</text>
        </BlockTool>
      );

    case "denied":
      return (
        <InlineTool
          icon={icon}
          iconColor={iconColor}
          name={name}
          header={header}
          suffix={state.reason ? `(denied: ${state.reason})` : "(denied)"}
          dimmed
          tokens={tokens}
        />
      );

    case "blocked":
      return (
        <InlineTool
          icon={icon}
          iconColor={iconColor}
          name={name}
          header={header}
          suffix={`(blocked: ${state.reason})`}
          dimmed
          tokens={tokens}
        />
      );
  }
}

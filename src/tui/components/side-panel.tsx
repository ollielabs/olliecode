/**
 * Side panel component for displaying context usage and todo list.
 * Always visible on the right side of the chat interface.
 */

import type { ContextStats } from "../../lib/tokenizer";
import type { Todo, TodoStatus } from "../../session/todo";

export type SidePanelProps = {
  /** Context usage statistics (null if not available) */
  contextStats: ContextStats | null;
  /** Current todo items for the session */
  todos: Todo[];
  /** Width of the panel */
  width?: number;
};

/**
 * Status icons for todo items
 */
const STATUS_ICONS: Record<TodoStatus, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  cancelled: "⊘",
};

/**
 * Colors for todo status
 */
const STATUS_COLORS: Record<TodoStatus, string> = {
  pending: "#888",
  in_progress: "#f39c12",
  completed: "#27ae60",
  cancelled: "#666",
};

/**
 * Compact progress bar for context usage
 */
function ContextBar({ percent }: { percent: number }) {
  const width = 12;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  // Color based on usage level
  const color = percent >= 90 ? "#e74c3c" : percent >= 80 ? "#f39c12" : "#27ae60";

  return (
    <box flexDirection="row">
      <text fg={color}>{"█".repeat(filled)}</text>
      <text fg="#555">{"░".repeat(empty)}</text>
    </box>
  );
}

/**
 * Context usage section
 */
function ContextSection({ stats }: { stats: ContextStats }) {
  const statusColor = stats.isCritical
    ? "#e74c3c"
    : stats.isNearLimit
      ? "#f39c12"
      : "#27ae60";

  return (
    <box flexDirection="column">
      <text fg="#fff"><b>Context</b></text>
      <box flexDirection="row">
        <ContextBar percent={stats.usagePercent} />
        <text fg={statusColor}> {stats.usagePercent}%</text>
      </box>
      <text fg="#999">
        {formatTokenCount(stats.totalTokens)}/{formatTokenCount(stats.maxTokens)}
      </text>
      {stats.isNearLimit && (
        <text fg={statusColor}>
          {stats.isCritical ? "! Critical" : "~ Near limit"}
        </text>
      )}
    </box>
  );
}

/**
 * Format token count for compact display
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + "M";
  }
  if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + "K";
  }
  return tokens.toString();
}

/**
 * Todo list section
 */
function TodoSection({ todos }: { todos: Todo[] }) {
  // Count by status
  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;

  // Show only active todos (pending + in_progress), limit to 5
  const activeTodos = todos
    .filter((t) => t.status === "pending" || t.status === "in_progress")
    .slice(0, 5);

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg="#fff"><b>Todos</b> </text>
        <text fg="#888">
          {completed}/{total}
        </text>
      </box>

      {activeTodos.length === 0 ? (
        <text fg="#555">No active tasks</text>
      ) : (
        <box flexDirection="column">
          {activeTodos.map((todo) => (
            <box key={todo.id} flexDirection="row">
              <text fg={STATUS_COLORS[todo.status]}>
                {STATUS_ICONS[todo.status]}{" "}
              </text>
              <text fg="#aaa">
                {todo.content.length > 20
                  ? todo.content.slice(0, 18) + ".."
                  : todo.content}
              </text>
            </box>
          ))}
          {todos.filter((t) => t.status === "pending" || t.status === "in_progress")
            .length > 5 && <text fg="#555">+{todos.length - 5} more</text>}
        </box>
      )}
    </box>
  );
}

/**
 * Main side panel component
 */
export function SidePanel({ contextStats, todos, width = 20 }: SidePanelProps) {
  return (
    <box
      backgroundColor="#333"
      flexDirection="column"
      width={width}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      {/* Context usage */}
      {contextStats && (
        <box marginBottom={1}>
          <ContextSection stats={contextStats} />
        </box>
      )}

      {/* Todos */}
      {todos.length > 0 && (
        <box>
          <TodoSection todos={todos} />
        </box>
      )}

      {/* Empty state */}
      {!contextStats && todos.length === 0 && (
        <text fg="#555">-</text>
      )}
    </box>
  );
}

/**
 * Side panel component for displaying context usage and todo list.
 * Always visible on the right side of the chat interface.
 */

import type { ContextStats } from '../../lib/tokenizer';
import type { Todo, TodoStatus } from '../../session/todo';
import type { SemanticTokens } from '../../design';
import { useTheme } from '../../design';

export type SidePanelProps = {
  contextStats: ContextStats | null;
  todos: Todo[];
  width?: number;
};

const STATUS_ICONS: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  cancelled: '⊘',
};

function getStatusColor(
  tokens: SemanticTokens,
  isCritical: boolean,
  isNearLimit: boolean,
): string {
  if (isCritical) return tokens.error;
  if (isNearLimit) return tokens.warning;
  return tokens.success;
}

function formatTokenCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function ContextBar({
  percent,
  statusColor,
  emptyColor,
}: {
  percent: number;
  statusColor: string;
  emptyColor: string;
}) {
  const width = 12;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  return (
    <box flexDirection="row">
      <text style={{ fg: statusColor }}>{'█'.repeat(filled)}</text>
      <text style={{ fg: emptyColor }}>{'░'.repeat(empty)}</text>
    </box>
  );
}

function ContextSection({
  stats,
  tokens,
}: {
  stats: ContextStats;
  tokens: SemanticTokens;
}) {
  const statusColor = getStatusColor(
    tokens,
    stats.isCritical,
    stats.isNearLimit,
  );

  return (
    <box flexDirection="column">
      <text style={{ fg: tokens.textBase }}>
        <b>Context</b>
      </text>
      <box flexDirection="row">
        <ContextBar
          percent={stats.usagePercent}
          statusColor={statusColor}
          emptyColor={tokens.textSubtle}
        />
        <text style={{ fg: statusColor }}>{stats.usagePercent}%</text>
      </box>
      <text style={{ fg: tokens.textMuted }}>
        {formatTokenCount(stats.totalTokens)}/
        {formatTokenCount(stats.maxTokens)}
      </text>
      {stats.isNearLimit && (
        <text style={{ fg: statusColor }}>
          {stats.isCritical ? '! Critical' : '~ Near limit'}
        </text>
      )}
    </box>
  );
}

function TodoSection({
  todos,
  tokens,
}: {
  todos: Todo[];
  tokens: SemanticTokens;
}) {
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const activeTodos = todos
    .filter((t) => t.status === 'pending' || t.status === 'in_progress')
    .slice(0, 5);

  const statusColors: Record<TodoStatus, string> = {
    pending: tokens.textMuted,
    in_progress: tokens.warning,
    completed: tokens.success,
    cancelled: tokens.textSubtle,
  };

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text style={{ fg: tokens.textBase }}>
          <b>Todos</b>{' '}
        </text>
        <text style={{ fg: tokens.textMuted }}>
          {completed}/{total}
        </text>
      </box>

      {activeTodos.length === 0 ? (
        <text style={{ fg: tokens.textSubtle }}>No active tasks</text>
      ) : (
        <box flexDirection="column">
          {activeTodos.map((todo) => (
            <box key={todo.id} flexDirection="row">
              <text style={{ fg: statusColors[todo.status] }}>
                {STATUS_ICONS[todo.status]}{' '}
              </text>
              <text style={{ fg: tokens.textMuted }}>
                {todo.content.length > 20
                  ? `${todo.content.slice(0, 18)}..`
                  : todo.content}
              </text>
            </box>
          ))}
          {activeTodos.length <
            todos.filter(
              (t) => t.status === 'pending' || t.status === 'in_progress',
            ).length && (
            <text style={{ fg: tokens.textSubtle }}>
              +{todos.length - 5} more
            </text>
          )}
        </box>
      )}
    </box>
  );
}

export function SidePanel({ contextStats, todos, width = 20 }: SidePanelProps) {
  const { tokens } = useTheme();

  return (
    <box
      style={{
        backgroundColor: tokens.bgSurface,
        flexDirection: 'column',
        paddingTop: 1,
        paddingBottom: 1,
        paddingLeft: 2,
        paddingRight: 2,
      }}
      width={width}
    >
      {contextStats && (
        <box style={{ marginBottom: 1 }}>
          <ContextSection stats={contextStats} tokens={tokens} />
        </box>
      )}

      {todos.length > 0 && <TodoSection todos={todos} tokens={tokens} />}

      {!contextStats && todos.length === 0 && (
        <text style={{ fg: tokens.textSubtle }}>-</text>
      )}
    </box>
  );
}

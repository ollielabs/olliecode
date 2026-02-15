/**
 * Side panel component for displaying context usage and todo list.
 * Always visible on the right side of the chat interface.
 */

import { For, Show, createMemo, mergeProps } from 'solid-js';
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
  pending: '\u25CB',
  in_progress: '\u25D0',
  completed: '\u25CF',
  cancelled: '\u2298',
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

function ContextBar(props: {
  percent: number;
  statusColor: string;
  emptyColor: string;
}) {
  const width = 12;
  const filled = createMemo(() => Math.round((props.percent / 100) * width));
  const empty = createMemo(() => width - filled());

  return (
    <box flexDirection="row">
      <text style={{ fg: props.statusColor }}>{'\u2588'.repeat(filled())}</text>
      <text style={{ fg: props.emptyColor }}>{'\u2591'.repeat(empty())}</text>
    </box>
  );
}

function ContextSection(props: {
  stats: ContextStats;
  tokens: SemanticTokens;
}) {
  const statusColor = createMemo(() =>
    getStatusColor(props.tokens, props.stats.isCritical, props.stats.isNearLimit),
  );

  return (
    <box flexDirection="column">
      <text style={{ fg: props.tokens.textBase }}>
        <b>Context</b>
      </text>
      <box flexDirection="row">
        <ContextBar
          percent={props.stats.usagePercent}
          statusColor={statusColor()}
          emptyColor={props.tokens.textSubtle}
        />
        <text style={{ fg: statusColor() }}>{props.stats.usagePercent}%</text>
      </box>
      <text style={{ fg: props.tokens.textMuted }}>
        {formatTokenCount(props.stats.totalTokens)}/
        {formatTokenCount(props.stats.maxTokens)}
      </text>
      <Show when={props.stats.isNearLimit}>
          <text style={{ fg: statusColor() }}>
          {props.stats.isCritical ? '! Critical' : '~ Near limit'}
        </text>
      </Show>
    </box>
  );
}

function TodoSection(props: { todos: Todo[]; tokens: SemanticTokens }) {
  const completed = createMemo(() =>
    props.todos.filter((t) => t.status === 'completed').length,
  );
  const total = createMemo(() => props.todos.length);
  const activeTodos = createMemo(() =>
    props.todos
      .filter((t) => t.status === 'pending' || t.status === 'in_progress')
      .slice(0, 5),
  );

  const statusColors = createMemo<Record<TodoStatus, string>>(() => ({
    pending: props.tokens.textMuted,
    in_progress: props.tokens.warning,
    completed: props.tokens.success,
    cancelled: props.tokens.textSubtle,
  }));

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text style={{ fg: props.tokens.textBase }}>
          <b>Todos</b>{' '}
        </text>
        <text style={{ fg: props.tokens.textMuted }}>
          {completed()}/{total()}
        </text>
      </box>

      <Show
        when={activeTodos().length > 0}
        fallback={
          <text style={{ fg: props.tokens.textSubtle }}>No active tasks</text>
        }
      >
        <box flexDirection="column">
          <For each={activeTodos()}>
            {(todo) => (
              <box flexDirection="row">
                <text style={{ fg: statusColors()[todo.status] }}>
                  {STATUS_ICONS[todo.status]}{' '}
                </text>
                <text style={{ fg: props.tokens.textMuted }}>
                  {todo.content.length > 20
                    ? `${todo.content.slice(0, 18)}..`
                    : todo.content}
                </text>
              </box>
            )}
          </For>
          <Show
            when={
              activeTodos().length <
              props.todos.filter(
                (t) => t.status === 'pending' || t.status === 'in_progress',
              ).length
            }
          >
            <text style={{ fg: props.tokens.textSubtle }}>
              +{props.todos.length - 5} more
            </text>
          </Show>
        </box>
      </Show>
    </box>
  );
}

export function SidePanel(rawProps: SidePanelProps) {
  const props = mergeProps({ width: 20 }, rawProps);
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
      width={props.width}
    >
      <Show when={props.contextStats}>
        {(stats: () => ContextStats) => (
          <box style={{ marginBottom: 1 }}>
            <ContextSection stats={stats()} tokens={tokens} />
          </box>
        )}
      </Show>

      <Show when={props.todos.length > 0}>
        <TodoSection todos={props.todos} tokens={tokens} />
      </Show>

      <Show when={!props.contextStats && props.todos.length === 0}>
        <text style={{ fg: tokens.textSubtle }}>-</text>
      </Show>
    </box>
  );
}

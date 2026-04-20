/**
 * Side panel component for displaying context usage and todo list.
 * Always visible on the right side of the chat interface.
 */

import { createMemo, createSignal, For, mergeProps, Show } from 'solid-js';
import type { McpStatusMap } from '../../agent/mcp/types';
import type { SemanticTokens } from '../../design';
import { useTheme } from '../../design';
import type { ContextStats } from '../../lib/tokenizer';
import type { Todo, TodoStatus } from '../../session/todo';
import { MCP_STATUS_ICONS, getMcpStatusDetail } from '../utils/mcp-display';

export type SidePanelProps = {
  contextStats: ContextStats | null;
  todos: Todo[];
  width?: number;
  /** MCP server status map (optional — omitted when no MCP servers configured) */
  mcpStatus?: McpStatusMap;
  /** Whether MCP is still connecting on startup */
  mcpConnecting?: boolean;
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
  const width = 8;
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
    getStatusColor(
      props.tokens,
      props.stats.isCritical,
      props.stats.isNearLimit,
    ),
  );

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text style={{ fg: props.tokens.textBase }}>
          <b>Context</b>{' '}
        </text>
        <ContextBar
          percent={props.stats.usagePercent}
          statusColor={statusColor()}
          emptyColor={props.tokens.textSubtle}
        />
        <text style={{ fg: statusColor() }}> {props.stats.usagePercent}%</text>
      </box>
      <text style={{ fg: props.tokens.textMuted }}>
        {formatTokenCount(props.stats.totalTokens)} /{' '}
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

const COLLAPSED_LIMIT = 5;

function TodoSection(props: { todos: Todo[]; tokens: SemanticTokens }) {
  const [expanded, setExpanded] = createSignal(false);

  const completed = createMemo(
    () => props.todos.filter((t) => t.status === 'completed').length,
  );
  const total = createMemo(() => props.todos.length);
  const visibleTodos = createMemo(() =>
    expanded() ? props.todos : props.todos.slice(0, COLLAPSED_LIMIT),
  );
  const hiddenCount = createMemo(
    () => props.todos.length - visibleTodos().length,
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
        when={props.todos.length > 0}
        fallback={
          <text style={{ fg: props.tokens.textSubtle }}>No active tasks</text>
        }
      >
        <box flexDirection="column">
          <For each={visibleTodos()}>
            {(todo) => {
              const isDone =
                todo.status === 'completed' || todo.status === 'cancelled';
              const textColor = isDone
                ? props.tokens.textSubtle
                : props.tokens.textMuted;
              return (
                <box flexDirection="row">
                  <text width={2} style={{ fg: statusColors()[todo.status] }}>
                    {STATUS_ICONS[todo.status]}
                  </text>
                  <Show
                    when={isDone}
                    fallback={
                      <text flexShrink={1} style={{ fg: textColor }}>
                        {todo.content}
                      </text>
                    }
                  >
                    <text flexShrink={1} style={{ fg: textColor }}>
                      <span style={{ strikethrough: true }}>
                        {todo.content}
                      </span>
                    </text>
                  </Show>
                </box>
              );
            }}
          </For>
          <Show when={hiddenCount() > 0}>
            <box onMouseDown={() => setExpanded(true)}>
              <text style={{ fg: props.tokens.primaryBase }}>
                +{hiddenCount()} more
              </text>
            </box>
          </Show>
          <Show when={expanded() && props.todos.length > COLLAPSED_LIMIT}>
            <box onMouseDown={() => setExpanded(false)}>
              <text style={{ fg: props.tokens.primaryBase }}>show less</text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  );
}

function mcpStatusColor(status: string, tokens: SemanticTokens): string {
  switch (status) {
    case 'connected':
      return tokens.success;
    case 'connecting':
      return tokens.warning;
    case 'error':
      return tokens.error;
    default:
      return tokens.textSubtle;
  }
}

function McpSection(props: {
  mcpStatus: McpStatusMap;
  connecting: boolean;
  tokens: SemanticTokens;
}) {
  const entries = createMemo(() => Array.from(props.mcpStatus.entries()));

  return (
    <box flexDirection="column">
      <text style={{ fg: props.tokens.textBase }}>
        <b>MCP</b>
      </text>

      <Show when={props.connecting && entries().length === 0}>
        <text style={{ fg: props.tokens.textMuted }}>connecting...</text>
      </Show>

      <For each={entries()}>
        {([name, info]) => {
          const icon = () =>
            MCP_STATUS_ICONS[info.status] ?? MCP_STATUS_ICONS.disconnected;
          const color = () => mcpStatusColor(info.status, props.tokens);
          const detail = () => getMcpStatusDetail(info.status, info.toolCount);

          return (
            <box flexDirection="row">
              <text style={{ fg: color() }}>{icon()} </text>
              <text style={{ fg: props.tokens.textMuted }}>{name} </text>
              <text style={{ fg: color() }}>{detail()}</text>
            </box>
          );
        }}
      </For>
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

      <Show
        when={
          props.mcpConnecting || (props.mcpStatus && props.mcpStatus.size > 0)
        }
      >
        <box style={{ marginBottom: 1 }}>
          <McpSection
            mcpStatus={props.mcpStatus ?? new Map()}
            connecting={props.mcpConnecting ?? false}
            tokens={tokens}
          />
        </box>
      </Show>

      <Show when={props.todos.length > 0}>
        <TodoSection todos={props.todos} tokens={tokens} />
      </Show>

      <Show
        when={
          !props.contextStats &&
          props.todos.length === 0 &&
          !props.mcpConnecting &&
          (!props.mcpStatus || props.mcpStatus.size === 0)
        }
      >
        <text style={{ fg: tokens.textSubtle }}>No activity</text>
      </Show>
    </box>
  );
}

/**
 * Full-screen overlay for viewing subagent execution in real-time.
 *
 * Shows streaming reasoning tokens, tool calls, and tool results grouped
 * by iteration. Supports multi-task tabs for parallel subagents.
 *
 * Reads from the module-level signal store (Path B) — never touches
 * ToolState or the <For> message list.
 */

import { createMemo, For, Show } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { RGBA, type KeyEvent } from '@opentui/core';
import { useTheme } from '../../design';
import { createMarkdownSyntaxStyle } from '../utils';
import { useOverlay } from '../hooks/use-overlay';
import {
  getAllSubagentIds,
  getSubagentStream,
  type SubagentStream,
  type SubagentStreamEvent,
} from '../hooks/use-subagent-streams';

export type SubagentOverlayProps = {
  toolId: string;
  onClose: () => void;
  onSwitchTask: (toolId: string) => void;
};

/**
 * Format a stream event into a display line.
 */
function formatEvent(event: SubagentStreamEvent): {
  icon: string;
  text: string;
  color: 'muted' | 'base' | 'success' | 'error' | 'warning';
} {
  switch (event.type) {
    case 'tool_call': {
      const argHint = formatArgHint(event.args);
      return {
        icon: '\u25D0',
        text: `${event.tool}${argHint ? ` ${argHint}` : ''}`,
        color: 'warning',
      };
    }
    case 'tool_result':
      return {
        icon: event.error ? '\u2717' : '\u2713',
        text: event.error
          ? `${event.tool}: ${event.error}`
          : `${event.tool} (${event.output.length} chars)`,
        color: event.error ? 'error' : 'success',
      };
    case 'awaiting_confirmation':
      return {
        icon: '\u23F3',
        text: `Awaiting approval for ${event.tool} in main chat...`,
        color: 'warning',
      };
    case 'confirmation_resolved':
      return {
        icon: event.action === 'deny' ? '\u2298' : '\u2713',
        text: `${event.tool} ${event.action === 'deny' ? 'denied' : 'approved'}`,
        color: event.action === 'deny' ? 'muted' : 'success',
      };
    case 'step_complete':
    case 'reasoning':
      // These are handled specially (iteration headers / streaming content)
      return { icon: '', text: '', color: 'muted' };
  }
}

/**
 * Extract a short hint from tool args for display.
 */
function formatArgHint(args: Record<string, unknown>): string {
  const path =
    args.path ?? args.filePath ?? args.file_path ?? args.pattern ?? args.url;
  if (typeof path === 'string') {
    return path.length > 50 ? `...${path.slice(-47)}` : path;
  }
  const cmd = args.command;
  if (typeof cmd === 'string') {
    return `$ ${cmd.length > 45 ? `${cmd.slice(0, 45)}...` : cmd}`;
  }
  return '';
}

/**
 * Group events by iteration for display.
 */
type IterationGroup = {
  iteration: number;
  events: SubagentStreamEvent[];
};

function groupByIteration(events: SubagentStreamEvent[]): IterationGroup[] {
  const groups: IterationGroup[] = [];
  let current: IterationGroup = { iteration: 0, events: [] };

  for (const event of events) {
    if (event.type === 'step_complete') {
      // Push current group and start new one
      if (current.events.length > 0) {
        groups.push(current);
      }
      current = { iteration: event.iteration, events: [] };
    } else if (event.type !== 'reasoning') {
      // Skip reasoning events — streaming content is shown separately
      current.events.push(event);
    }
  }

  // Push final group
  if (current.events.length > 0) {
    groups.push(current);
  }

  return groups;
}

export function SubagentOverlay(props: SubagentOverlayProps) {
  const { tokens } = useTheme();
  const dimensions = useTerminalDimensions();
  const markdownStyle = createMemo(() => createMarkdownSyntaxStyle(tokens));

  // Register overlay — blocks app-level keyboard handlers
  useOverlay();

  // Keyboard handling — Esc closes, arrows switch tabs
  useKeyboard((key: KeyEvent) => {
    key.stopPropagation();
    if (key.name === 'escape') {
      props.onClose();
      return;
    }
    if (key.name === 'left' || key.name === 'right' || key.name === 'tab') {
      const ids = getAllSubagentIds();
      const currentIdx = ids.indexOf(props.toolId);
      if (currentIdx === -1 || ids.length <= 1) return;
      const next =
        key.name === 'left'
          ? (currentIdx - 1 + ids.length) % ids.length
          : (currentIdx + 1) % ids.length;
      const nextId = ids[next];
      if (nextId) props.onSwitchTask(nextId);
    }
  });

  // Read stream from Path B store
  const stream = createMemo<SubagentStream | undefined>(() =>
    getSubagentStream(props.toolId),
  );

  const iterationGroups = createMemo(() => {
    const s = stream();
    if (!s) return [];
    return groupByIteration(s.events);
  });

  const activeIds = createMemo(() => getAllSubagentIds());

  const colorFor = (
    c: 'muted' | 'base' | 'success' | 'error' | 'warning',
  ): string => {
    switch (c) {
      case 'muted':
        return tokens.textMuted;
      case 'base':
        return tokens.textBase;
      case 'success':
        return tokens.success;
      case 'error':
        return tokens.error;
      case 'warning':
        return tokens.warning;
    }
  };

  return (
    <>
      {/* Backdrop */}
      <box
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: dimensions().width,
          height: dimensions().height,
          zIndex: 200,
          backgroundColor: RGBA.fromInts(0, 0, 0, 220),
        }}
      />

      {/* Overlay panel */}
      <box
        style={{
          position: 'absolute',
          left: 1,
          top: 1,
          width: dimensions().width - 2,
          height: dimensions().height - 2,
          zIndex: 201,
          backgroundColor: tokens.bgBase,
          flexDirection: 'column',
          border: true,
          borderStyle: 'rounded',
          borderColor: tokens.borderMuted,
        }}
      >
        {/* Header with tabs */}
        <box
          style={{
            flexDirection: 'row',
            paddingX: 1,
            border: ['bottom'],
            borderColor: tokens.borderMuted,
            flexShrink: 0,
          }}
        >
          <box onMouseDown={() => props.onClose()} style={{ marginRight: 2 }}>
            <text style={{ fg: tokens.textMuted }}>{'\u2190 Back (Esc)'}</text>
          </box>

          {/* Tab bar */}
          <For each={activeIds()}>
            {(id) => {
              const tabStream = createMemo(() => getSubagentStream(id));
              const isActive = () => id === props.toolId;
              const statusIcon = () => {
                const s = tabStream();
                if (!s) return '\u25CF';
                switch (s.status) {
                  case 'completed':
                    return '\u2713';
                  case 'failed':
                    return '\u2717';
                  case 'awaiting_confirmation':
                    return '\u23F3';
                  default:
                    return '\u25CF';
                }
              };

              return (
                <box
                  onMouseDown={() => props.onSwitchTask(id)}
                  style={{
                    marginLeft: 1,
                    paddingX: 1,
                    backgroundColor: isActive()
                      ? tokens.bgSurface
                      : tokens.bgBase,
                  }}
                >
                  <text
                    style={{
                      fg: isActive() ? tokens.primaryBase : tokens.textMuted,
                    }}
                  >
                    {`${statusIcon()} @${tabStream()?.agentName ?? 'unknown'} ${tabStream()?.iteration ?? 0}/${tabStream()?.maxIterations ?? '?'}`}
                  </text>
                </box>
              );
            }}
          </For>
        </box>

        {/* Current task description */}
        <Show when={stream()}>
          {(s: () => SubagentStream) => (
            <box
              style={{
                paddingX: 2,
                paddingY: 1,
                border: ['bottom'],
                borderColor: tokens.borderMuted,
                flexShrink: 0,
              }}
            >
              <text style={{ fg: tokens.primaryBase }}>
                {`@${s().agentName}`}
              </text>
              <text style={{ fg: tokens.textMuted }}>
                {` "${s().description}" - Iteration ${s().iteration}/${s().maxIterations}`}
              </text>
            </box>
          )}
        </Show>

        {/* Event stream */}
        <scrollbox
          flexGrow={1}
          flexShrink={1}
          stickyScroll={true}
          stickyStart="bottom"
        >
          <box style={{ flexDirection: 'column', paddingX: 2, paddingY: 1 }}>
            <For each={iterationGroups()}>
              {(group) => (
                <box style={{ flexDirection: 'column', marginBottom: 1 }}>
                  {/* Iteration separator */}
                  <box style={{ marginBottom: 1 }}>
                    <text style={{ fg: tokens.textMuted }}>
                      {`── Iteration ${group.iteration + 1} ──`}
                    </text>
                  </box>

                  {/* Events in this iteration */}
                  <For each={group.events}>
                    {(event) => {
                      const formatted = formatEvent(event);
                      return (
                        <Show when={formatted.text}>
                          <box style={{ flexDirection: 'row', marginLeft: 1 }}>
                            <text style={{ fg: colorFor(formatted.color) }}>
                              {`${formatted.icon} `}
                            </text>
                            <text style={{ fg: colorFor(formatted.color) }}>
                              {formatted.text}
                            </text>
                          </box>
                        </Show>
                      );
                    }}
                  </For>
                </box>
              )}
            </For>

            {/* Current streaming content */}
            <Show when={stream()?.streamingContent}>
              {(content: () => string) => (
                <box style={{ marginLeft: 1, marginTop: 1 }}>
                  <markdown
                    content={content()}
                    syntaxStyle={markdownStyle()}
                    streaming={true}
                    conceal={true}
                  />
                </box>
              )}
            </Show>

            {/* Status indicator when awaiting confirmation */}
            <Show when={stream()?.status === 'awaiting_confirmation'}>
              <box style={{ marginTop: 1 }}>
                <text style={{ fg: tokens.warning }}>
                  {'\u23F3 Awaiting tool approval in main chat...'}
                </text>
              </box>
            </Show>
          </box>
        </scrollbox>

        {/* Footer */}
        <box
          style={{
            paddingX: 2,
            paddingY: 1,
            border: ['top'],
            borderColor: tokens.borderMuted,
            flexShrink: 0,
          }}
        >
          <text style={{ fg: tokens.textMuted }}>
            {activeIds().length > 1
              ? 'Esc close \u00B7 \u2190/\u2192 switch tasks \u00B7 Tab next task'
              : 'Press Esc to close'}
          </text>
        </box>
      </box>
    </>
  );
}

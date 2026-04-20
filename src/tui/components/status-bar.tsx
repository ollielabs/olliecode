import { createMemo, mergeProps, Show } from 'solid-js';
import type { AgentMode } from '../../agent/modes';
import { useTheme } from '../../design';
import type { Status } from '../types';

export type StatusBarProps = {
  model: string;
  status: Status;
  mode?: AgentMode;
};

export function StatusBar(rawProps: StatusBarProps) {
  const props = mergeProps({ mode: 'build' as AgentMode }, rawProps);
  const { tokens } = useTheme();

  const modeColors = createMemo<Record<AgentMode, string>>(() => ({
    plan: tokens.info,
    build: tokens.success,
  }));

  return (
    <box
      style={{
        flexDirection: 'row',
        marginTop: 1,
        justifyContent: 'space-between',
      }}
    >
      <box style={{ flexDirection: 'row' }}>
        <text style={{ fg: modeColors()[props.mode] }}>
          [{props.mode.toUpperCase()}]
        </text>
        <text style={{ fg: tokens.textMuted }}> • {props.model}</text>
        <Show when={props.status === 'thinking'}>
          <text style={{ fg: tokens.primaryBase }}> • Thinking...</text>
        </Show>
      </box>
      <box style={{ flexDirection: 'row' }}>
        <text style={{ fg: tokens.textBase }}>
          <b>tab</b>
        </text>
        <text style={{ fg: tokens.textMuted }}> switch mode </text>
        <text style={{ fg: tokens.textBase }}>
          <b>ctrl+p</b>
        </text>
        <text style={{ fg: tokens.textMuted }}> commands</text>
      </box>
    </box>
  );
}

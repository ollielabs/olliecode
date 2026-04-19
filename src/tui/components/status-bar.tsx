import { createMemo, mergeProps, Show } from 'solid-js';
import type { AgentMode } from '../../agent/modes';
import type { McpStatusMap } from '../../agent/mcp/types';
import { useTheme } from '../../design';
import type { Status } from '../types';
import { formatMcpStatus } from '../utils/mcp-display';

export type StatusBarProps = {
  model: string;
  status: Status;
  mode?: AgentMode;
  /** MCP server status map (optional — omitted when no MCP servers configured) */
  mcpStatus?: McpStatusMap;
  /** Whether MCP is still connecting on startup */
  mcpConnecting?: boolean;
};

export function StatusBar(rawProps: StatusBarProps) {
  const props = mergeProps({ mode: 'build' as AgentMode }, rawProps);
  const { tokens } = useTheme();

  const modeColors = createMemo<Record<AgentMode, string>>(() => ({
    plan: tokens.info,
    build: tokens.success,
  }));

  const mcpText = createMemo(() =>
    formatMcpStatus(props.mcpStatus, props.mcpConnecting),
  );

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
        <Show when={mcpText()}>
          {(text: () => string) => (
            <text style={{ fg: tokens.textMuted }}> • {text()}</text>
          )}
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

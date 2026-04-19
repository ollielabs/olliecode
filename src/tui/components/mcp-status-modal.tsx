/**
 * Modal displaying MCP server status, tools, and debug info.
 * Shown via the /mcp slash command.
 */

import { For, Show } from 'solid-js';
import type { McpManager } from '../../agent/mcp';
import type { McpStatusMap } from '../../agent/mcp/types';
import { useTheme } from '../../design';
import { Modal } from './modal';

export type McpStatusModalProps = {
  /** Current status map for all servers */
  mcpStatus: McpStatusMap;
  /** McpManager instance for accessing server tools and stderr */
  manager: McpManager;
  /** Close handler */
  onClose: () => void;
};

/** Status label with color */
function statusLabel(
  status: string,
  tokens: {
    success: string;
    warning: string;
    error: string;
    textMuted: string;
  },
): { text: string; color: string } {
  switch (status) {
    case 'connected':
      return { text: 'connected', color: tokens.success };
    case 'connecting':
      return { text: 'connecting...', color: tokens.warning };
    case 'error':
      return { text: 'error', color: tokens.error };
    case 'disconnected':
      return { text: 'disconnected', color: tokens.textMuted };
    default:
      return { text: status, color: tokens.textMuted };
  }
}

export function McpStatusModal(props: McpStatusModalProps) {
  const { tokens } = useTheme();

  const serverEntries = () => Array.from(props.mcpStatus.entries());

  return (
    <Modal title="MCP Servers" onClose={props.onClose} size="large">
      <Show
        when={serverEntries().length > 0}
        fallback={
          <text style={{ fg: tokens.textMuted }}>
            No MCP servers configured. Add servers to your config under the
            "mcp" key.
          </text>
        }
      >
        <For each={serverEntries()}>
          {([name, info]) => {
            const label = statusLabel(info.status, tokens);
            const tools = props.manager.getServerTools(name);
            const stderr = props.manager.getServerStderr(name);

            return (
              <box flexDirection="column" marginBottom={1}>
                {/* Server header: name + status */}
                <box flexDirection="row">
                  <text style={{ fg: tokens.primaryBase }}>
                    <b>{name}</b>
                  </text>
                  <text style={{ fg: label.color }}> [{label.text}]</text>
                  <Show when={info.status === 'connected'}>
                    <text style={{ fg: tokens.textMuted }}>
                      {' '}
                      ({info.toolCount} tool
                      {info.toolCount !== 1 ? 's' : ''})
                    </text>
                  </Show>
                </box>

                {/* Error message */}
                <Show when={info.error}>
                  {(error: () => string) => (
                    <text style={{ fg: tokens.error, marginLeft: 2 }}>
                      Error: {error()}
                    </text>
                  )}
                </Show>

                {/* Tool list */}
                <Show when={tools.length > 0}>
                  <box marginLeft={2} marginTop={0}>
                    <text style={{ fg: tokens.textMuted }}>Tools:</text>
                  </box>
                  <For each={tools}>
                    {(tool) => (
                      <text style={{ fg: tokens.textBase, marginLeft: 4 }}>
                        - {tool.name}
                        <span style={{ fg: tokens.textMuted }}>
                          {tool.description
                            ? ` — ${tool.description.slice(0, 60)}${tool.description.length > 60 ? '...' : ''}`
                            : ''}
                        </span>
                      </text>
                    )}
                  </For>
                </Show>

                {/* Stderr tail */}
                <Show when={stderr.length > 0}>
                  <box marginLeft={2} marginTop={1}>
                    <text style={{ fg: tokens.textMuted }}>
                      Recent stderr ({stderr.length} line
                      {stderr.length !== 1 ? 's' : ''}):
                    </text>
                  </box>
                  <For each={stderr.slice(-5)}>
                    {(line) => (
                      <text style={{ fg: tokens.warning, marginLeft: 4 }}>
                        {line.slice(0, 120)}
                      </text>
                    )}
                  </For>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>
    </Modal>
  );
}

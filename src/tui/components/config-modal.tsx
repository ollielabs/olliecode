/**
 * Modal displaying active configuration and sources.
 * Shows resolved config values, source attribution, and effective permissions.
 */

import { For, Show } from 'solid-js';
import type { ConfigLayer } from '../../config/merge';
import { resolvePermissions } from '../../config/resolve';
import type { ResolvedConfig } from '../../config/schema';
import { useTheme } from '../../design';
import { Modal } from './modal';

export type ConfigModalProps = {
  config: ResolvedConfig;
  layers: ConfigLayer[];
  warnings: string[];
  onClose: () => void;
};

/** Home directory for path shortening (resolved once at module load). */
const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? '';

/**
 * Determine which source layer a top-level config key came from.
 * Walks layers in reverse precedence (highest first) to find the
 * first layer that sets the key.
 *
 * NOTE: Only resolves top-level keys in layer.raw. Nested keys like
 * tui.theme or agent.maxIterations are not individually attributed --
 * extend with dot-path traversal if needed in the future.
 */
export function getSource(key: string, layers: ConfigLayer[]): string {
  // Walk layers in reverse (highest precedence first)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer && key in layer.raw) {
      if (layer.source === 'cli') return 'cli';
      if (layer.path) {
        // Shorten the path for display
        const display =
          HOME_DIR && layer.path.startsWith(HOME_DIR)
            ? `~${layer.path.slice(HOME_DIR.length)}`
            : layer.path;
        return `${layer.source} (${display})`;
      }
      return layer.source;
    }
  }
  return 'default';
}

/** A labeled row: label (muted) + value (base) + optional source (subtle) */
function ConfigRow(props: { label: string; value: string; source?: string }) {
  const { tokens } = useTheme();
  return (
    <box flexDirection="row" paddingLeft={2}>
      <text style={{ fg: tokens.textMuted, width: 22 }}>{props.label}</text>
      <text style={{ fg: tokens.textBase }}>{props.value}</text>
      <Show when={props.source && props.source !== 'default'}>
        <text style={{ fg: tokens.textSubtle }}> ({props.source})</text>
      </Show>
    </box>
  );
}

/** A section header */
function SectionHeader(props: { title: string }) {
  const { tokens } = useTheme();
  return (
    <text style={{ fg: tokens.textBase }} marginTop={1}>
      <b>{props.title}</b>
    </text>
  );
}

export function ConfigModal(props: ConfigModalProps) {
  const { tokens } = useTheme();
  const permissions = resolvePermissions(props.config);

  // Determine source for top-level config values.
  const modelSource = getSource('model', props.layers);
  const hostSource = getSource('host', props.layers);
  const autonomySource = getSource('autonomy', props.layers);
  const tempSource = getSource('temperature', props.layers);
  const debugSource = getSource('debug', props.layers);

  return (
    <Modal title="Configuration" onClose={props.onClose} size="large">
      <scrollbox maxHeight={20} stickyScroll={false}>
        <box flexDirection="column">
          {/* Config Sources */}
          <SectionHeader title="Sources" />
          <For each={props.layers}>
            {(layer) => {
              const keyCount = Object.keys(layer.raw).length;
              return (
                <box flexDirection="row" paddingLeft={2}>
                  <text style={{ fg: tokens.textMuted, width: 10 }}>
                    {layer.source}:
                  </text>
                  <text style={{ fg: tokens.textBase }}>
                    {layer.path ?? '(flags)'}
                  </text>
                  <text style={{ fg: tokens.textSubtle }}>
                    {' '}
                    ({keyCount} key{keyCount === 1 ? '' : 's'})
                  </text>
                </box>
              );
            }}
          </For>

          {/* Resolved Values */}
          <SectionHeader title="Resolved Config" />
          <ConfigRow
            label="model"
            value={props.config.model}
            source={modelSource}
          />
          <ConfigRow
            label="host"
            value={props.config.host}
            source={hostSource}
          />
          <ConfigRow
            label="autonomy"
            value={props.config.autonomy}
            source={autonomySource}
          />
          <ConfigRow
            label="temperature"
            value={String(props.config.temperature)}
            source={tempSource}
          />
          <ConfigRow label="theme" value={props.config.tui.theme} />
          <ConfigRow
            label="agent.maxIterations"
            value={String(props.config.agent.maxIterations)}
          />
          <ConfigRow
            label="agent.defaultMode"
            value={props.config.agent.defaultMode}
          />
          <ConfigRow
            label="compaction.auto"
            value={String(props.config.compaction.auto)}
          />
          <ConfigRow
            label="debug"
            value={String(props.config.debug)}
            source={debugSource}
          />

          {/* Effective Permissions */}
          <SectionHeader title="Effective Permissions" />
          <For each={Object.entries(permissions)}>
            {([tool, perm]) => (
              <box flexDirection="row" paddingLeft={2}>
                <text style={{ fg: tokens.textMuted, width: 22 }}>{tool}</text>
                <text
                  style={{
                    fg:
                      perm === 'allow'
                        ? tokens.success
                        : perm === 'deny'
                          ? tokens.error
                          : tokens.warning,
                  }}
                >
                  {perm}
                </text>
              </box>
            )}
          </For>

          {/* Warnings */}
          <Show when={props.warnings.length > 0}>
            <SectionHeader title="Warnings" />
            <For each={props.warnings}>
              {(warning) => (
                <box paddingLeft={2}>
                  <text style={{ fg: tokens.warning }}>{warning}</text>
                </box>
              )}
            </For>
          </Show>

          <box marginTop={1}>
            <text style={{ fg: tokens.textSubtle }}>
              Edit ~/.config/ollie/config.json or ./ollie.json to change
            </text>
          </box>
        </box>
      </scrollbox>
    </Modal>
  );
}

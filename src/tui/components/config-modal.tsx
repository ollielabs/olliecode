/**
 * Modal displaying active configuration and sources.
 * Shows resolved config values, source attribution, and effective permissions.
 */

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

/**
 * Determine which source layer a top-level config key came from.
 * Walks layers in reverse precedence (highest first) to find the
 * first layer that sets the key.
 */
export function getSource(key: string, layers: ConfigLayer[]): string {
  // Walk layers in reverse (highest precedence first)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer && key in layer.raw) {
      if (layer.source === 'cli') return 'cli';
      if (layer.path) {
        // Shorten the path for display
        const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
        const display =
          home && layer.path.startsWith(home)
            ? `~${layer.path.slice(home.length)}`
            : layer.path;
        return `${layer.source} (${display})`;
      }
      return layer.source;
    }
  }
  return 'default';
}

/** A labeled row: label (muted) + value (base) + optional source (subtle) */
function ConfigRow({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source?: string;
}) {
  const { tokens } = useTheme();
  return (
    <box flexDirection="row" paddingLeft={2}>
      <text style={{ fg: tokens.textMuted, width: 22 }}>{label}</text>
      <text style={{ fg: tokens.textBase }}>{value}</text>
      {source && source !== 'default' && (
        <text style={{ fg: tokens.textSubtle }}> ({source})</text>
      )}
    </box>
  );
}

/** A section header */
function SectionHeader({ title }: { title: string }) {
  const { tokens } = useTheme();
  return (
    <text style={{ fg: tokens.textBase }} marginTop={1}>
      <b>{title}</b>
    </text>
  );
}

export function ConfigModal({
  config,
  layers,
  warnings,
  onClose,
}: ConfigModalProps) {
  const { tokens } = useTheme();
  const permissions = resolvePermissions(config);

  // Determine source for key config values
  const modelSource = getSource('model', layers);
  const hostSource = getSource('host', layers);
  const autonomySource = getSource('autonomy', layers);
  const tempSource = getSource('temperature', layers);

  return (
    <Modal title="Configuration" onClose={onClose} size="large">
      <scrollbox maxHeight={20} stickyScroll={false}>
        <box flexDirection="column">
          {/* Config Sources */}
          <SectionHeader title="Sources" />
          {layers.map((layer) => {
            const keyCount = Object.keys(layer.raw).length;
            return (
              <box
                key={`layer-${layer.source}-${layer.path ?? 'flags'}`}
                flexDirection="row"
                paddingLeft={2}
              >
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
          })}

          {/* Resolved Values */}
          <SectionHeader title="Resolved Config" />
          <ConfigRow label="model" value={config.model} source={modelSource} />
          <ConfigRow label="host" value={config.host} source={hostSource} />
          <ConfigRow
            label="autonomy"
            value={config.autonomy}
            source={autonomySource}
          />
          <ConfigRow
            label="temperature"
            value={String(config.temperature)}
            source={tempSource}
          />
          <ConfigRow label="theme" value={config.tui.theme} />
          <ConfigRow
            label="agent.maxIterations"
            value={String(config.agent.maxIterations)}
          />
          <ConfigRow
            label="agent.defaultMode"
            value={config.agent.defaultMode}
          />
          <ConfigRow
            label="compaction.auto"
            value={String(config.compaction.auto)}
          />
          <ConfigRow label="debug" value={String(config.debug)} />

          {/* Effective Permissions */}
          <SectionHeader title="Effective Permissions" />
          {Object.entries(permissions).map(([tool, perm]) => (
            <box key={tool} flexDirection="row" paddingLeft={2}>
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
          ))}

          {/* Warnings */}
          {warnings.length > 0 && (
            <>
              <SectionHeader title="Warnings" />
              {warnings.map((warning) => (
                <box key={warning} paddingLeft={2}>
                  <text style={{ fg: tokens.warning }}>{warning}</text>
                </box>
              ))}
            </>
          )}

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

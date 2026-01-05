/**
 * Modal displaying context usage statistics.
 */

import { Modal } from './modal';
import type { ContextStats } from '../../lib/tokenizer';
import { useTheme } from '../../design';

export type ContextStatsModalProps = {
  stats: ContextStats;
  modelName: string;
  onClose: () => void;
};

function ProgressBar({
  percent,
  width = 30,
  filledColor,
  emptyColor,
}: {
  percent: number;
  width?: number;
  filledColor: string;
  emptyColor: string;
}) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  return (
    <box flexDirection="row">
      <text style={{ fg: filledColor }}>{'█'.repeat(filled)}</text>
      <text style={{ fg: emptyColor }}>{'░'.repeat(empty)}</text>
    </box>
  );
}

export function ContextStatsModal({
  stats,
  modelName,
  onClose,
}: ContextStatsModalProps) {
  const { tokens } = useTheme();

  const statusColor = stats.isCritical
    ? tokens.error
    : stats.isNearLimit
      ? tokens.warning
      : tokens.success;
  const statusText = stats.isCritical
    ? 'CRITICAL'
    : stats.isNearLimit
      ? 'Near Limit'
      : 'OK';
  const progressColor =
    stats.usagePercent >= 90
      ? tokens.error
      : stats.usagePercent >= 80
        ? tokens.warning
        : tokens.success;

  return (
    <Modal title="Context Usage" onClose={onClose} size="medium">
      <box flexDirection="column">
        <box flexDirection="row" marginBottom={1}>
          <text style={{ fg: tokens.textMuted }}>Model: </text>
          <text style={{ fg: tokens.textBase }}>{modelName}</text>
        </box>

        <box flexDirection="column" marginBottom={1}>
          <box flexDirection="row" marginBottom={0}>
            <text style={{ fg: tokens.textMuted }}>Usage: </text>
            <text style={{ fg: tokens.textBase }}>{stats.usagePercent}%</text>
            <text style={{ fg: tokens.textMuted }}> </text>
            <text style={{ fg: statusColor }}>[{statusText}]</text>
          </box>
          <ProgressBar
            percent={stats.usagePercent}
            width={40}
            filledColor={progressColor}
            emptyColor={tokens.borderMuted}
          />
        </box>

        <box flexDirection="row" marginBottom={1}>
          <text style={{ fg: tokens.textMuted }}>Tokens: </text>
          <text style={{ fg: tokens.textBase }}>
            {stats.totalTokens.toLocaleString()}
          </text>
          <text style={{ fg: tokens.textMuted }}> / </text>
          <text style={{ fg: tokens.textBase }}>
            {stats.maxTokens.toLocaleString()}
          </text>
        </box>

        <box flexDirection="column" marginTop={1}>
          <text style={{ fg: tokens.textMuted }} marginBottom={0}>
            Breakdown:
          </text>
          <box flexDirection="row" paddingLeft={2}>
            <text style={{ fg: tokens.textMuted }}>System: </text>
            <text style={{ fg: tokens.textBase }}>
              {stats.byRole.system.toLocaleString()}
            </text>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text style={{ fg: tokens.textMuted }}>User: </text>
            <text style={{ fg: tokens.textBase }}>
              {stats.byRole.user.toLocaleString()}
            </text>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text style={{ fg: tokens.textMuted }}>Assistant: </text>
            <text style={{ fg: tokens.textBase }}>
              {stats.byRole.assistant.toLocaleString()}
            </text>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text style={{ fg: tokens.textMuted }}>Tools: </text>
            <text style={{ fg: tokens.textBase }}>
              {stats.byRole.tool.toLocaleString()}
            </text>
          </box>
        </box>

        <box marginTop={2}>
          <text style={{ fg: tokens.textSubtle }}>
            Use /compact to reduce context size
          </text>
        </box>
      </box>
    </Modal>
  );
}

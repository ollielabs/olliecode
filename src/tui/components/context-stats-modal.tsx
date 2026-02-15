/**
 * Modal displaying context usage statistics.
 */

import { createMemo } from 'solid-js';
import { Modal } from './modal';
import type { ContextStats } from '../../lib/tokenizer';
import { useTheme } from '../../design';

export type ContextStatsModalProps = {
  stats: ContextStats;
  modelName: string;
  onClose: () => void;
};

function ProgressBar(props: {
  percent: number;
  width?: number;
  filledColor: string;
  emptyColor: string;
}) {
  const barWidth = createMemo(() => props.width ?? 30);
  const filled = createMemo(() => Math.round((props.percent / 100) * barWidth()));
  const empty = createMemo(() => barWidth() - filled());

  return (
    <box flexDirection="row">
      <text style={{ fg: props.filledColor }}>{'\u2588'.repeat(filled())}</text>
      <text style={{ fg: props.emptyColor }}>{'\u2591'.repeat(empty())}</text>
    </box>
  );
}

export function ContextStatsModal(props: ContextStatsModalProps) {
  const { tokens } = useTheme();

  const statusColor = createMemo(() =>
    props.stats.isCritical
      ? tokens.error
      : props.stats.isNearLimit
        ? tokens.warning
        : tokens.success,
  );
  const statusText = createMemo(() =>
    props.stats.isCritical
      ? 'CRITICAL'
      : props.stats.isNearLimit
        ? 'Near Limit'
        : 'OK',
  );
  const progressColor = createMemo(() =>
    props.stats.usagePercent >= 90
      ? tokens.error
      : props.stats.usagePercent >= 80
        ? tokens.warning
        : tokens.success,
  );

  return (
    <Modal title="Context Usage" onClose={props.onClose} size="medium">
      <box flexDirection="column">
        <box flexDirection="row" marginBottom={1}>
          <text style={{ fg: tokens.textMuted }}>Model: </text>
          <text style={{ fg: tokens.textBase }}>{props.modelName}</text>
        </box>

        <box flexDirection="column" marginBottom={1}>
          <box flexDirection="row" marginBottom={0}>
            <text style={{ fg: tokens.textMuted }}>Usage: </text>
            <text style={{ fg: tokens.textBase }}>
              {props.stats.usagePercent}%
            </text>
            <text style={{ fg: tokens.textMuted }}> </text>
            <text style={{ fg: statusColor() }}>[{statusText()}]</text>
          </box>
          <ProgressBar
            percent={props.stats.usagePercent}
            width={40}
            filledColor={progressColor()}
            emptyColor={tokens.borderMuted}
          />
        </box>

        <box flexDirection="row" marginBottom={1}>
          <text style={{ fg: tokens.textMuted }}>Tokens: </text>
          <text style={{ fg: tokens.textBase }}>
            {props.stats.totalTokens.toLocaleString()}
          </text>
          <text style={{ fg: tokens.textMuted }}> / </text>
          <text style={{ fg: tokens.textBase }}>
            {props.stats.maxTokens.toLocaleString()}
          </text>
        </box>

        <box flexDirection="column" marginTop={1}>
          <text style={{ fg: tokens.textMuted }} marginBottom={0}>
            Breakdown:
          </text>
          <box flexDirection="row" paddingLeft={2}>
            <text style={{ fg: tokens.textMuted }}>System: </text>
            <text style={{ fg: tokens.textBase }}>
              {props.stats.byRole.system.toLocaleString()}
            </text>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text style={{ fg: tokens.textMuted }}>User: </text>
            <text style={{ fg: tokens.textBase }}>
              {props.stats.byRole.user.toLocaleString()}
            </text>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text style={{ fg: tokens.textMuted }}>Assistant: </text>
            <text style={{ fg: tokens.textBase }}>
              {props.stats.byRole.assistant.toLocaleString()}
            </text>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text style={{ fg: tokens.textMuted }}>Tools: </text>
            <text style={{ fg: tokens.textBase }}>
              {props.stats.byRole.tool.toLocaleString()}
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

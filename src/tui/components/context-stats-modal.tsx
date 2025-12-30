/**
 * Modal displaying context usage statistics.
 */

import { Modal } from "./modal";
import type { ContextStats } from "../../lib/tokenizer";

export type ContextStatsModalProps = {
  stats: ContextStats;
  modelName: string;
  onClose: () => void;
};

/**
 * Create a visual progress bar.
 */
function ProgressBar({ percent, width = 30 }: { percent: number; width?: number }) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  
  // Color based on usage level
  const color = percent >= 90 ? "#e74c3c" : percent >= 80 ? "#f39c12" : "#27ae60";
  
  return (
    <box flexDirection="row">
      <text fg={color}>{"█".repeat(filled)}</text>
      <text fg="#444">{"░".repeat(empty)}</text>
    </box>
  );
}

export function ContextStatsModal({ stats, modelName, onClose }: ContextStatsModalProps) {
  const statusColor = stats.isCritical 
    ? "#e74c3c" 
    : stats.isNearLimit 
      ? "#f39c12" 
      : "#27ae60";
  
  const statusText = stats.isCritical 
    ? "CRITICAL" 
    : stats.isNearLimit 
      ? "Near Limit" 
      : "OK";

  return (
    <Modal title="Context Usage" onClose={onClose} size="medium">
      <box flexDirection="column">
        {/* Model info */}
        <box flexDirection="row" marginBottom={1}>
          <text fg="#888">Model: </text>
          <text fg="#ffffff">{modelName}</text>
        </box>

        {/* Usage bar */}
        <box flexDirection="column" marginBottom={1}>
          <box flexDirection="row" marginBottom={0}>
            <text fg="#888">Usage: </text>
            <text fg="#ffffff">{stats.usagePercent}%</text>
            <text fg="#888"> </text>
            <text fg={statusColor}>[{statusText}]</text>
          </box>
          <ProgressBar percent={stats.usagePercent} width={40} />
        </box>

        {/* Token counts */}
        <box flexDirection="row" marginBottom={1}>
          <text fg="#888">Tokens: </text>
          <text fg="#ffffff">{stats.totalTokens.toLocaleString()}</text>
          <text fg="#888"> / </text>
          <text fg="#ffffff">{stats.maxTokens.toLocaleString()}</text>
        </box>

        {/* Breakdown by role */}
        <box flexDirection="column" marginTop={1}>
          <text fg="#888" marginBottom={0}>Breakdown:</text>
          <box flexDirection="row" paddingLeft={2}>
            <text fg="#888">System:    </text>
            <text fg="#ffffff">{stats.byRole.system.toLocaleString()}</text>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text fg="#888">User:      </text>
            <text fg="#ffffff">{stats.byRole.user.toLocaleString()}</text>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text fg="#888">Assistant: </text>
            <text fg="#ffffff">{stats.byRole.assistant.toLocaleString()}</text>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text fg="#888">Tools:     </text>
            <text fg="#ffffff">{stats.byRole.tool.toLocaleString()}</text>
          </box>
        </box>

        {/* Hint */}
        <box marginTop={2}>
          <text fg="#666">Use /compact to reduce context size</text>
        </box>
      </box>
    </Modal>
  );
}

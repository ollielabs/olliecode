/**
 * Hook for managing context stats, compaction, and related operations.
 * Handles sidebar stats, context info notifications, and context manipulation.
 *
 * Context operations (clear, forget, compact) are persisted through the
 * message store, ensuring in-memory and SQLite stay consistent.
 */

import { createSignal } from 'solid-js';
import { summarizeConversation } from '../../agent/compaction';
import type { ResolvedConfig } from '../../config/schema';
import { fetchModelInfo, getContextStats } from '../../lib/tokenizer';
import { resetBufferingState } from '../../memory/buffering';
import { deleteOMRecord } from '../../memory/store';
import {
  NOTIFICATION_DURATION_LONG,
  NOTIFICATION_DURATION_SHORT,
} from '../constants';
import type { ContextStats } from '../types';
import type { UseMessageStoreReturn } from './use-message-store';

export type UseAgentContextProps = {
  /** Resolved config (config.host is authoritative, includes OLLAMA_HOST) */
  config: ResolvedConfig;
  /** Message store (owns history and provides clear/forget/summarize) */
  store: UseMessageStoreReturn;
  /** Current session ID getter (for operations that need it) */
  sessionId: () => string | undefined;
};

export type UseAgentContextReturn = {
  /** Context info notification message */
  contextInfo: () => string | null;
  /** Context stats for modal */
  contextStats: () => ContextStats | null;
  /** Whether context stats modal is visible */
  showContextStats: () => boolean;
  /** Context stats for sidebar */
  sidebarStats: () => ContextStats | null;
  /** Clear all context */
  handleClearContext: () => void;
  /** Compact messages to reduce token usage */
  handleCompact: () => Promise<void>;
  /** Show context stats modal */
  handleShowContext: () => Promise<void>;
  /** Forget last N messages */
  handleForget: (n: number) => void;
  /** Close context stats modal */
  handleContextStatsClose: () => void;
  /** Set context info message */
  setContextInfo: (info: string | null) => void;
  /**
   * Update sidebar stats with real token counts from the model.
   * Called by use-agent-submit after a successful agent run.
   */
  updateRealTokenCounts: (
    totalTokens: number,
    maxTokens: number,
    promptTokens?: number,
    completionTokens?: number,
  ) => void;
};

export function useAgentContext(
  props: UseAgentContextProps,
): UseAgentContextReturn {
  const model = props.config.model;
  const host = props.config.host;
  const store = props.store;
  const [contextInfo, setContextInfo] = createSignal<string | null>(null);
  const [contextStats, setContextStats] = createSignal<ContextStats | null>(
    null,
  );
  const [showContextStats, setShowContextStats] = createSignal(false);
  const [sidebarStats, setSidebarStats] = createSignal<ContextStats | null>(
    null,
  );

  // Sidebar stats are updated ONLY when real token counts arrive from
  // the model (via updateRealTokenCounts). No heuristic estimation.
  //
  // This matches opencode's approach: display the last known real counts
  // from prompt_eval_count/eval_count. Before the first model response,
  // the sidebar shows null (no data). This is more robust than estimating
  // with a character heuristic that overestimates by 33-60%.

  const handleClearContext = () => {
    const sid = props.sessionId();
    if (sid) {
      store.clear(sid);
      // Clear OM record and in-memory buffering state so a fresh
      // conversation doesn't inherit stale observations/chunks.
      deleteOMRecord(sid);
      resetBufferingState();
    } else {
      // No session yet — just reset in-memory state
      store.reset();
    }
    setSidebarStats(null);
    setContextInfo('Context cleared. Starting fresh conversation.');
    setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
  };

  const handleCompact = async () => {
    const currentHistory = store.history();
    if (currentHistory.length === 0) {
      setContextInfo('Nothing to compact - context is empty.');
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
      return;
    }

    const sid = props.sessionId();
    if (!sid) {
      setContextInfo('No active session to compact.');
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
      return;
    }

    try {
      setContextInfo('Summarizing context...');

      const summaryText = await summarizeConversation(
        currentHistory,
        model,
        host,
        props.config.compaction.temperature,
      );

      if (!summaryText) {
        setContextInfo('Summarization failed — context unchanged.');
        setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_LONG);
        return;
      }

      const summarizedCount = store.summarize(sid, summaryText);

      // Clear stale real counts — they no longer reflect the compacted history.
      // The next model call will provide fresh real counts.
      setSidebarStats(null);

      // Get new stats after summarization (estimate for notification only)
      const newHistory = store.history();
      let statsMsg = '';
      try {
        const modelInfo = await fetchModelInfo(model, host);
        const newStats = getContextStats(newHistory, modelInfo.contextLength);
        statsMsg = ` Model context: ${newStats.totalTokens.toLocaleString()} tokens (${newStats.usagePercent}%)`;
      } catch {
        // Stats unavailable — that's fine
      }

      setContextInfo(
        `Summarized ${summarizedCount} messages into context summary.${statsMsg}`,
      );
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_LONG);
    } catch (e) {
      setContextInfo(
        `Summarization failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_LONG);
    }
  };

  const handleShowContext = async () => {
    const currentHistory = store.history();
    if (currentHistory.length === 0) {
      setContextInfo('Context is empty.');
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
      return;
    }

    try {
      const modelInfo = await fetchModelInfo(model, host);
      const stats = getContextStats(currentHistory, modelInfo.contextLength);
      setContextStats(stats);
      setShowContextStats(true);
    } catch (e) {
      setContextInfo(
        `Could not get context stats: ${e instanceof Error ? e.message : String(e)}`,
      );
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_LONG);
    }
  };

  const handleForget = (n: number) => {
    const currentHistory = store.history();
    if (currentHistory.length === 0) {
      setContextInfo('Nothing to forget - context is empty.');
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
      return;
    }

    const sid = props.sessionId();
    if (!sid) {
      setContextInfo('No active session.');
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
      return;
    }

    const deleted = store.forget(sid, n);
    setSidebarStats(null);
    setContextInfo(
      `Forgot last ${deleted} message${deleted === 1 ? '' : 's'}.`,
    );
    setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
  };

  const handleContextStatsClose = () => {
    setShowContextStats(false);
    setContextStats(null);
  };

  const updateRealTokenCounts = (
    totalTokens: number,
    maxTokens: number,
    promptTokens?: number,
    completionTokens?: number,
  ) => {
    const usagePercent =
      maxTokens > 0 ? Math.round((totalTokens / maxTokens) * 100) : 0;
    setSidebarStats({
      totalTokens,
      maxTokens,
      usagePercent,
      isNearLimit: usagePercent >= 80,
      isCritical: usagePercent >= 90,
      // Per-role breakdown is not available from Ollama's prompt_eval_count/eval_count.
      // These are aggregate counts, not per-role. Set all to zero.
      byRole: { system: 0, user: 0, assistant: 0, tool: 0 },
    });
  };

  return {
    contextInfo,
    contextStats,
    showContextStats,
    sidebarStats,
    handleClearContext,
    handleCompact,
    handleShowContext,
    handleForget,
    handleContextStatsClose,
    setContextInfo,
    updateRealTokenCounts,
  };
}

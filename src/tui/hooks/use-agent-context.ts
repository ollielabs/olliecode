/**
 * Hook for managing context stats, compaction, and related operations.
 * Handles sidebar stats, context info notifications, and context manipulation.
 *
 * Context operations (clear, forget, compact) are persisted through the
 * message store, ensuring in-memory and SQLite stay consistent.
 */

import { createEffect, createSignal } from 'solid-js';
import { compactMessages, getCompactionLevel } from '../../agent/compaction';
import { extractCompactionConfig } from '../../config/resolve';
import type { ResolvedConfig } from '../../config/schema';
import { fetchModelInfo, getContextStats } from '../../lib/tokenizer';
import { fromOllamaMessages } from '../../session/convert';
import {
  NOTIFICATION_DURATION_LONG,
  NOTIFICATION_DURATION_SHORT,
} from '../constants';
import type { ContextStats } from '../types';
import type { UseMessageStoreReturn } from './use-message-store';

export type UseAgentContextProps = {
  /** Resolved config (config.host is authoritative, includes OLLAMA_HOST) */
  config: ResolvedConfig;
  /** Message store (owns history and provides clear/forget/compact) */
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

  // Update sidebar stats when history changes
  createEffect(() => {
    const currentHistory = store.history();
    if (currentHistory.length === 0) {
      setSidebarStats(null);
      return;
    }
    void (async () => {
      try {
        const modelInfo = await fetchModelInfo(model, host);
        const stats = getContextStats(currentHistory, modelInfo.contextLength);
        setSidebarStats(stats);
      } catch {
        setSidebarStats(null);
      }
    })();
  });

  const handleClearContext = () => {
    const sid = props.sessionId();
    if (sid) {
      store.clear(sid);
    } else {
      // No session yet — just reset in-memory state
      store.reset();
    }
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
      setContextInfo('Compacting context...');
      const modelInfo = await fetchModelInfo(model, host);
      const stats = getContextStats(currentHistory, modelInfo.contextLength);
      const level = getCompactionLevel(stats.usagePercent);

      // Pass history directly — no dummy system prompt needed.
      // classifyMessages() handles the case where index 0 isn't a system
      // message (it just won't get the system_prompt preservation rule,
      // which is correct since the system prompt isn't in the history).
      const result = await compactMessages(
        currentHistory,
        level,
        extractCompactionConfig(props.config),
        model,
        host,
      );

      // Convert compacted Message[] to StoredMessage[] for snapshot storage
      const compactedStored = fromOllamaMessages(result.messages);

      // Persist the compaction snapshot and refresh the store
      store.compact(sid, compactedStored, result.originalCount);

      setContextInfo(
        `Compacted: ${result.originalCount} -> ${result.compactedCount} messages, ` +
          `${result.tokensBefore} -> ${result.tokensAfter} tokens (${Math.round((1 - result.tokensAfter / result.tokensBefore) * 100)}% reduction)`,
      );
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_LONG);
    } catch (e) {
      setContextInfo(
        `Compaction failed: ${e instanceof Error ? e.message : String(e)}`,
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
    const usagePercent = Math.round((totalTokens / maxTokens) * 100);
    setSidebarStats({
      totalTokens,
      maxTokens,
      usagePercent,
      isNearLimit: usagePercent >= 80,
      isCritical: usagePercent >= 90,
      byRole: {
        // Real counts don't provide per-role breakdown
        // Use total as assistant since that's the dominant category
        system: 0,
        user: 0,
        assistant: promptTokens ?? totalTokens,
        tool: completionTokens ?? 0,
      },
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

/**
 * Hook for managing context stats, compaction, and related operations.
 * Handles sidebar stats, context info notifications, and context manipulation.
 */

import { createEffect, createSignal, type Setter } from 'solid-js';
import { compactMessages, getCompactionLevel } from '../../agent/compaction';
import { extractCompactionConfig } from '../../config/resolve';
import type { ResolvedConfig } from '../../config/schema';
import { fetchModelInfo, getContextStats } from '../../lib/tokenizer';
import {
  NOTIFICATION_DURATION_LONG,
  NOTIFICATION_DURATION_SHORT,
} from '../constants';
import type { ContextStats, DisplayMessage, Message } from '../types';

export type UseAgentContextProps = {
  /** Current message history (signal accessor) */
  history: () => Message[];
  /** Resolved config (config.host is authoritative, includes OLLAMA_HOST) */
  config: ResolvedConfig;
  /** Setter for history (for compaction and forget) */
  setHistory: Setter<Message[]>;
  /** Setter for display messages (for clear and forget) */
  setDisplayMessages: Setter<DisplayMessage[]>;
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
  setContextInfo: Setter<string | null>;
};

export function useAgentContext(
  props: UseAgentContextProps,
): UseAgentContextReturn {
  const model = props.config.model;
  const host = props.config.host;
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
    const currentHistory = props.history();
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
    props.setHistory([]);
    props.setDisplayMessages([]);
    setContextInfo('Context cleared. Starting fresh conversation.');
    setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
  };

  const handleCompact = async () => {
    const currentHistory = props.history();
    if (currentHistory.length === 0) {
      setContextInfo('Nothing to compact - context is empty.');
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
      return;
    }

    try {
      setContextInfo('Compacting context...');
      const modelInfo = await fetchModelInfo(model, host);
      const stats = getContextStats(currentHistory, modelInfo.contextLength);
      const level = getCompactionLevel(stats.usagePercent);
      const result = await compactMessages(
        [{ role: 'system', content: '' }, ...currentHistory],
        level,
        extractCompactionConfig(props.config),
        model,
        host,
      );
      const compactedHistory = result.messages.slice(1);
      props.setHistory(compactedHistory);
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
    const currentHistory = props.history();
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
    const currentHistory = props.history();
    if (currentHistory.length === 0) {
      setContextInfo('Nothing to forget - context is empty.');
      setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
      return;
    }

    const toRemove = Math.min(n, currentHistory.length);
    props.setHistory((prev) => prev.slice(0, -toRemove));
    // Approximate: each history message may correspond to ~2 display messages
    const displayToRemove = Math.min(toRemove * 2, 100);
    props.setDisplayMessages((prev) => prev.slice(0, -displayToRemove));
    setContextInfo(
      `Forgot last ${toRemove} message${toRemove === 1 ? '' : 's'}.`,
    );
    setTimeout(() => setContextInfo(null), NOTIFICATION_DURATION_SHORT);
  };

  const handleContextStatsClose = () => {
    setShowContextStats(false);
    setContextStats(null);
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
  };
}

/**
 * Hook for managing context stats, compaction, and related operations.
 * Handles sidebar stats, context info notifications, and context manipulation.
 */

import { useState, useEffect, useCallback } from "react";
import { compactMessages, getCompactionLevel } from "../../agent/compaction";
import { fetchModelInfo, getContextStats } from "../../lib/tokenizer";
import type { Message, ContextStats, DisplayMessage } from "../types";

export type UseAgentContextProps = {
  /** Current message history */
  history: Message[];
  /** Model name */
  model: string;
  /** Ollama host URL */
  host: string;
  /** Setter for history (for compaction and forget) */
  setHistory: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Setter for display messages (for clear and forget) */
  setDisplayMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>;
};

export type UseAgentContextReturn = {
  /** Context info notification message */
  contextInfo: string | null;
  /** Context stats for modal */
  contextStats: ContextStats | null;
  /** Whether context stats modal is visible */
  showContextStats: boolean;
  /** Context stats for sidebar */
  sidebarStats: ContextStats | null;
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
  setContextInfo: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useAgentContext({
  history,
  model,
  host,
  setHistory,
  setDisplayMessages,
}: UseAgentContextProps): UseAgentContextReturn {
  const [contextInfo, setContextInfo] = useState<string | null>(null);
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const [showContextStats, setShowContextStats] = useState(false);
  const [sidebarStats, setSidebarStats] = useState<ContextStats | null>(null);

  // Update sidebar stats when history changes
  useEffect(() => {
    if (history.length === 0) {
      setSidebarStats(null);
      return;
    }
    void (async () => {
      try {
        const modelInfo = await fetchModelInfo(model, host);
        const stats = getContextStats(history, modelInfo.contextLength);
        setSidebarStats(stats);
      } catch {
        setSidebarStats(null);
      }
    })();
  }, [history, model, host]);

  const handleClearContext = useCallback(() => {
    setHistory([]);
    setDisplayMessages([]);
    setContextInfo("Context cleared. Starting fresh conversation.");
    setTimeout(() => setContextInfo(null), 3000);
  }, [setHistory, setDisplayMessages]);

  const handleCompact = useCallback(async () => {
    if (history.length === 0) {
      setContextInfo("Nothing to compact - context is empty.");
      setTimeout(() => setContextInfo(null), 3000);
      return;
    }

    try {
      setContextInfo("Compacting context...");
      const modelInfo = await fetchModelInfo(model, host);
      const stats = getContextStats(history, modelInfo.contextLength);
      const level = getCompactionLevel(stats.usagePercent);
      const result = await compactMessages(
        [{ role: "system", content: "" }, ...history],
        level,
        undefined,
        model,
        host
      );
      const compactedHistory = result.messages.slice(1);
      setHistory(compactedHistory);
      setContextInfo(
        `Compacted: ${result.originalCount} -> ${result.compactedCount} messages, ` +
          `${result.tokensBefore} -> ${result.tokensAfter} tokens (${Math.round((1 - result.tokensAfter / result.tokensBefore) * 100)}% reduction)`
      );
      setTimeout(() => setContextInfo(null), 5000);
    } catch (e) {
      setContextInfo(`Compaction failed: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setContextInfo(null), 5000);
    }
  }, [history, model, host, setHistory]);

  const handleShowContext = useCallback(async () => {
    if (history.length === 0) {
      setContextInfo("Context is empty.");
      setTimeout(() => setContextInfo(null), 3000);
      return;
    }

    try {
      const modelInfo = await fetchModelInfo(model, host);
      const stats = getContextStats(history, modelInfo.contextLength);
      setContextStats(stats);
      setShowContextStats(true);
    } catch (e) {
      setContextInfo(`Could not get context stats: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setContextInfo(null), 5000);
    }
  }, [history, model, host]);

  const handleForget = useCallback(
    (n: number) => {
      if (history.length === 0) {
        setContextInfo("Nothing to forget - context is empty.");
        setTimeout(() => setContextInfo(null), 3000);
        return;
      }

      const toRemove = Math.min(n, history.length);
      setHistory((prev) => prev.slice(0, -toRemove));
      // Approximate: each history message may correspond to ~2 display messages
      const displayToRemove = Math.min(toRemove * 2, 100);
      setDisplayMessages((prev) => prev.slice(0, -displayToRemove));
      setContextInfo(`Forgot last ${toRemove} message${toRemove === 1 ? "" : "s"}.`);
      setTimeout(() => setContextInfo(null), 3000);
    },
    [history.length, setHistory, setDisplayMessages]
  );

  const handleContextStatsClose = useCallback(() => {
    setShowContextStats(false);
    setContextStats(null);
  }, []);

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

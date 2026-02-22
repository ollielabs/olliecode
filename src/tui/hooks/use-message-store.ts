/**
 * Central message store hook.
 *
 * Owns all message state and provides the single source of truth:
 * - allMessages (from SQLite) is the full, unaltered chat history
 * - displayMessages is derived from allMessages + pendingDisplayMessages
 * - history (Ollama format) is derived from allMessages, sliced at
 *   the summary message when one exists
 *
 * Two-tier approach:
 * - At rest (no agent running): pendingDisplayMessages is empty,
 *   displayMessages is purely derived from the store.
 * - During an agent run: pendingDisplayMessages accumulates live tool
 *   state updates. On settlement, the store is refreshed and pending cleared.
 *
 * Chat history is NEVER altered by compaction. Compaction only affects
 * what gets sent to the model (the history() signal).
 */

import type { Message } from 'ollama';
import { createMemo, createSignal } from 'solid-js';
import {
  addMessage,
  clearMessages,
  deleteTrailingMessages,
  fromAssistantResponse,
  fromUserInput,
  getActiveMessages,
  getSummaryMessageId,
  hasTrailingUserMessage,
  setSummaryMessageId,
  toDisplayMessages,
  toOllamaMessages,
} from '../../session';
import type { MessagePart, StoredMessage, ToolPart } from '../../session/types';
import type { DisplayMessage, ToolDisplayMessage, ToolState } from '../types';

// ============================================================================
// Types
// ============================================================================

export type UseMessageStoreReturn = {
  // --- Derived read-only signals ---

  /** Display messages for TUI rendering (store-derived + pending during runs) */
  displayMessages: () => DisplayMessage[];
  /** Ollama message history for agent calls (summary-aware slice) */
  history: () => Message[];

  // --- Persist + update mutations ---

  /**
   * Persist a user message and add it to the pending display.
   * Deduplicates: skips persistence if the last stored message is already
   * a user message (handles retry after error).
   */
  appendUserMessage: (
    sessionId: string,
    rawPrompt: string,
    augmentedPrompt: string,
    attachedFiles?: string[],
  ) => void;

  /**
   * Settle an agent run: persist the assistant message,
   * refresh the store, and clear pending display.
   *
   * After this call, displayMessages is purely derived from SQLite.
   */
  settleAgentRun: (
    sessionId: string,
    content: string,
    toolParts: ToolPart[],
  ) => void;

  /**
   * Settle an agent error: persist the error as an assistant message with
   * an ErrorPart (and any completed tool parts), refresh the store, and
   * clear pending display. Status returns to idle.
   */
  settleAgentError: (
    sessionId: string,
    errorType: string,
    errorMessage: string,
    toolParts: ToolPart[],
  ) => void;

  // --- Live display mutations (in-memory only, during agent run) ---

  /** Add a pending tool message (shown immediately, not yet persisted) */
  addPendingToolMessage: (msg: ToolDisplayMessage) => void;
  /** Update a pending tool message's state by ID */
  updatePendingToolState: (toolId: string, newState: ToolState) => void;
  /** Add a pending assistant message (e.g., final answer before settlement) */
  addPendingAssistantMessage: (content: string) => void;
  /** Read current pending display messages (for building ToolParts in callbacks) */
  getPendingDisplayMessages: () => DisplayMessage[];

  // --- Context operations (persist + update) ---

  /** Clear all messages for a session */
  clear: (sessionId: string) => void;
  /** Delete the last N messages from a session */
  forget: (sessionId: string, count: number) => number;
  /**
   * Save a compaction summary: appends the summary as an assistant message
   * with a CompactionSummaryPart, then updates the session's summary pointer.
   * Returns the number of messages that are now summarized.
   */
  summarize: (sessionId: string, summaryText: string) => number;

  // --- Session lifecycle ---

  /** Load messages for a session from the store */
  loadSession: (sessionId: string) => void;
  /** Reset all state (e.g., on /new) */
  reset: () => void;
};

// ============================================================================
// Hook
// ============================================================================

export function useMessageStore(): UseMessageStoreReturn {
  // Full persisted state — all messages, never altered by compaction
  const [allMessages, setAllMessages] = createSignal<StoredMessage[]>([]);

  // Summary message ID — points to the latest compaction summary
  const [summaryMsgId, setSummaryMsgId] = createSignal<string | null>(null);

  // Ephemeral display state — accumulates during agent runs, cleared on settle
  const [pendingDisplayMessages, setPendingDisplayMessages] = createSignal<
    DisplayMessage[]
  >([]);

  // --- Derived signals ---

  /** Display: always full history + pending */
  const displayMessages = createMemo<DisplayMessage[]>(() => {
    const base = toDisplayMessages(allMessages());
    const pending = pendingDisplayMessages();
    if (pending.length === 0) return base;
    return [...base, ...pending];
  });

  /**
   * History for model context: summary-aware slice.
   *
   * When a summary exists, the model sees:
   *   [summary as user message] + [messages after the summary]
   *
   * When no summary exists, the model sees all messages.
   */
  const history = createMemo<Message[]>(() => {
    const all = allMessages();
    const sumId = summaryMsgId();

    if (!sumId) {
      return toOllamaMessages(all);
    }

    const sumIndex = all.findIndex((m) => m.id === sumId);
    if (sumIndex === -1) {
      // Summary message not found — return all (safety fallback)
      return toOllamaMessages(all);
    }

    // Extract summary text from the CompactionSummaryPart
    const summaryMsg = all[sumIndex];
    const summaryText = summaryMsg
      ? summaryMsg.parts
          .filter((p) => p.type === 'compaction_summary')
          .map((p) => ('content' in p ? (p.content as string) : ''))
          .join('\n')
      : '';

    // Messages after the summary (convert to Ollama format)
    const afterSummary = all.slice(sumIndex + 1);
    const afterMessages = toOllamaMessages(afterSummary);

    // Summary becomes a user message so the model treats it as context
    return [
      {
        role: 'user' as const,
        content: `[Previous conversation summary]\n${summaryText}`,
      },
      ...afterMessages,
    ];
  });

  // --- Internal helpers ---

  function refreshStore(sessionId: string): void {
    setAllMessages(getActiveMessages(sessionId));
    setSummaryMsgId(getSummaryMessageId(sessionId));
  }

  // --- Persist + update mutations ---

  const appendUserMessage = (
    sessionId: string,
    rawPrompt: string,
    augmentedPrompt: string,
    attachedFiles?: string[],
  ): void => {
    // Dedup: if last stored message is already a user message with the
    // same content (from a failed previous attempt), skip re-persisting.
    if (!hasTrailingUserMessage(sessionId, augmentedPrompt)) {
      addMessage(sessionId, 'user', fromUserInput(augmentedPrompt));
    }

    // Refresh the store — the user message is now in allMessages,
    // so displayMessages derives it automatically.
    refreshStore(sessionId);
  };

  const settleAgentRun = (
    sessionId: string,
    content: string,
    toolParts: ToolPart[],
  ): void => {
    // Persist assistant message (only if there's content or tool parts)
    if (content.trim() || toolParts.length > 0) {
      addMessage(
        sessionId,
        'assistant',
        fromAssistantResponse(content, toolParts),
      );
    }

    // Refresh from store — this makes allMessages the source of truth
    refreshStore(sessionId);

    // Clear pending — display is now fully derived from the store
    setPendingDisplayMessages([]);
  };

  const settleAgentError = (
    sessionId: string,
    errorType: string,
    errorMessage: string,
    toolParts: ToolPart[],
  ): void => {
    // Build parts: completed tool parts first, then the error
    const parts: MessagePart[] = [
      ...toolParts,
      { type: 'error', errorType, content: errorMessage },
    ];

    // Always persist — errors are part of the conversation record
    addMessage(sessionId, 'assistant', parts);

    // Refresh from store and clear pending
    refreshStore(sessionId);
    setPendingDisplayMessages([]);
  };

  // --- Live display mutations ---

  const addPendingToolMessage = (msg: ToolDisplayMessage): void => {
    setPendingDisplayMessages((prev) => [...prev, msg]);
  };

  const updatePendingToolState = (
    toolId: string,
    newState: ToolState,
  ): void => {
    setPendingDisplayMessages((prev) =>
      prev.map((msg) =>
        msg.type === 'tool' && msg.id === toolId
          ? { ...msg, state: newState }
          : msg,
      ),
    );
  };

  const addPendingAssistantMessage = (content: string): void => {
    setPendingDisplayMessages((prev) => [
      ...prev,
      { type: 'assistant' as const, content },
    ]);
  };

  const getPendingDisplayMessages = (): DisplayMessage[] => {
    return pendingDisplayMessages();
  };

  // --- Context operations ---

  const clear = (sessionId: string): void => {
    clearMessages(sessionId);
    setAllMessages([]);
    setSummaryMsgId(null);
    setPendingDisplayMessages([]);
  };

  const forget = (sessionId: string, count: number): number => {
    const deleted = deleteTrailingMessages(sessionId, count);
    refreshStore(sessionId);
    setPendingDisplayMessages([]);
    return deleted;
  };

  const summarize = (sessionId: string, summaryText: string): number => {
    // Count messages being summarized (everything before the summary)
    const current = allMessages();
    const summarizedCount = current.length;

    // Append the summary as an assistant message with CompactionSummaryPart
    const summaryMessage = addMessage(sessionId, 'assistant', [
      {
        type: 'compaction_summary',
        content: summaryText,
        compactedCount: summarizedCount,
      },
    ]);

    // Update the session's summary pointer
    setSummaryMessageId(sessionId, summaryMessage.id);

    // Refresh store
    refreshStore(sessionId);
    setPendingDisplayMessages([]);

    return summarizedCount;
  };

  // --- Session lifecycle ---

  const loadSession = (sessionId: string): void => {
    setAllMessages(getActiveMessages(sessionId));
    setSummaryMsgId(getSummaryMessageId(sessionId));
    setPendingDisplayMessages([]);
  };

  const reset = (): void => {
    setAllMessages([]);
    setSummaryMsgId(null);
    setPendingDisplayMessages([]);
  };

  return {
    displayMessages,
    history,
    appendUserMessage,
    settleAgentRun,
    settleAgentError,
    addPendingToolMessage,
    updatePendingToolState,
    addPendingAssistantMessage,
    getPendingDisplayMessages,
    clear,
    forget,
    summarize,
    loadSession,
    reset,
  };
}

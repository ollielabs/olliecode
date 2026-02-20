/**
 * Central message store hook.
 *
 * Owns all message state and provides the single source of truth:
 * - storedMessages (from SQLite) is the canonical state
 * - history (Ollama format) is derived from storedMessages
 * - displayMessages is derived from storedMessages + pendingDisplayMessages
 *
 * Two-tier approach:
 * - At rest (no agent running): pendingDisplayMessages is empty,
 *   displayMessages is purely derived from the store.
 * - During an agent run: pendingDisplayMessages accumulates live tool
 *   state updates. On settlement, the store is refreshed and pending cleared.
 *
 * All mutations that affect persisted state go through this hook,
 * ensuring in-memory and SQLite never diverge at rest.
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
  hasTrailingUserMessage,
  saveCompactionSnapshot,
  toDisplayMessages,
  toOllamaMessages,
} from '../../session';
import type {
  SnapshotType,
  StoredMessage,
  ToolPart,
} from '../../session/types';
import type { DisplayMessage, ToolDisplayMessage, ToolState } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Compaction info passed to settleAgentRun when auto-compaction occurred.
 */
export type CompactionInfo = {
  snapshotType: SnapshotType;
  /** Compacted messages in StoredMessage format */
  messages: StoredMessage[];
  /** Number of messages before compaction */
  originalCount: number;
};

export type UseMessageStoreReturn = {
  // --- Derived read-only signals ---

  /** Display messages for TUI rendering (store-derived + pending during runs) */
  displayMessages: () => DisplayMessage[];
  /** Ollama message history for agent calls (derived from store) */
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
   * Settle an agent run: persist the assistant message, optionally save
   * a compaction snapshot, refresh the store, and clear pending display.
   *
   * After this call, displayMessages is purely derived from SQLite.
   */
  settleAgentRun: (
    sessionId: string,
    content: string,
    toolParts: ToolPart[],
    compaction?: CompactionInfo,
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

  /** Clear all messages and snapshots for a session */
  clear: (sessionId: string) => void;
  /** Delete the last N messages from a session */
  forget: (sessionId: string, count: number) => number;
  /**
   * Save a compaction snapshot. Original messages are preserved in the
   * messages table; the snapshot is an overlay used on next load.
   */
  compact: (
    sessionId: string,
    compactedMessages: StoredMessage[],
    originalCount: number,
  ) => void;

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
  // Canonical persisted state — refreshed from SQLite at settlement points
  const [storedMessages, setStoredMessages] = createSignal<StoredMessage[]>([]);

  // Ephemeral display state — accumulates during agent runs, cleared on settle
  const [pendingDisplayMessages, setPendingDisplayMessages] = createSignal<
    DisplayMessage[]
  >([]);

  // --- Derived signals ---

  const displayMessages = createMemo<DisplayMessage[]>(() => {
    const base = toDisplayMessages(storedMessages());
    const pending = pendingDisplayMessages();
    if (pending.length === 0) return base;
    return [...base, ...pending];
  });

  const history = createMemo<Message[]>(() =>
    toOllamaMessages(storedMessages()),
  );

  // --- Internal helpers ---

  function refreshStore(sessionId: string): void {
    setStoredMessages(getActiveMessages(sessionId));
  }

  // --- Persist + update mutations ---

  const appendUserMessage = (
    sessionId: string,
    rawPrompt: string,
    augmentedPrompt: string,
    attachedFiles?: string[],
  ): void => {
    // Dedup: if last stored message is already a user message (from a
    // failed previous attempt), skip re-persisting. The model will see
    // the existing user message in history.
    if (!hasTrailingUserMessage(sessionId)) {
      addMessage(sessionId, 'user', fromUserInput(augmentedPrompt));
    }

    // Refresh the store — the user message is now in storedMessages,
    // so displayMessages derives it automatically. No need to add to
    // pending (that would cause a duplicate).
    refreshStore(sessionId);
  };

  const settleAgentRun = (
    sessionId: string,
    content: string,
    toolParts: ToolPart[],
    compaction?: CompactionInfo,
  ): void => {
    // Persist assistant message (only if there's content or tool parts)
    if (content.trim() || toolParts.length > 0) {
      addMessage(
        sessionId,
        'assistant',
        fromAssistantResponse(content, toolParts),
      );
    }

    // Persist compaction snapshot if auto-compaction occurred during the run
    if (compaction) {
      saveCompactionSnapshot(
        sessionId,
        compaction.snapshotType,
        compaction.messages,
        compaction.originalCount,
      );
    }

    // Refresh from store — this makes storedMessages the source of truth
    refreshStore(sessionId);

    // Clear pending — display is now fully derived from the store
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
    setStoredMessages([]);
    setPendingDisplayMessages([]);
  };

  const forget = (sessionId: string, count: number): number => {
    const deleted = deleteTrailingMessages(sessionId, count);
    refreshStore(sessionId);
    setPendingDisplayMessages([]);
    return deleted;
  };

  const compact = (
    sessionId: string,
    compactedMessages: StoredMessage[],
    originalCount: number,
  ): void => {
    saveCompactionSnapshot(
      sessionId,
      'manual_compaction',
      compactedMessages,
      originalCount,
    );
    refreshStore(sessionId);
    setPendingDisplayMessages([]);
  };

  // --- Session lifecycle ---

  const loadSession = (sessionId: string): void => {
    setStoredMessages(getActiveMessages(sessionId));
    setPendingDisplayMessages([]);
  };

  const reset = (): void => {
    setStoredMessages([]);
    setPendingDisplayMessages([]);
  };

  return {
    displayMessages,
    history,
    appendUserMessage,
    settleAgentRun,
    addPendingToolMessage,
    updatePendingToolState,
    addPendingAssistantMessage,
    getPendingDisplayMessages,
    clear,
    forget,
    compact,
    loadSession,
    reset,
  };
}

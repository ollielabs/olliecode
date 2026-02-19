# Message History Rework — Implementation Plan

**Issue**: #56
**Branch**: TBD (create before starting)
**Goal**: Robust, scalable message system with single source of truth

## Design Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| @file augmentation | Persist augmented prompt | Faithful reload; strip `<attached-files>` for display |
| User message timing | Persist immediately + deduplicate | Crash resilient; simple last-message dedup check |
| Compaction storage | Snapshot table, originals preserved | Non-destructive; enables undo; ground truth never lost |
| Display approach | Two-tier: live in-memory during runs, derived from store at rest | Streaming UI needs real-time updates; consistency invariant holds at rest |

## Core Architecture

```
SQLite (StoredMessage[]) = source of truth

  getActiveMessages(sessionId):
    if snapshot exists:
      return snapshot.messages + messages WHERE created_at > snapshot.created_at
    else:
      return all messages

  Derived signals (via useMessageStore):
    history()         = createMemo(() => toOllamaMessages(storedMessages()))
    displayMessages() = createMemo(() => [...toDisplayMessages(storedMessages()), ...pendingDisplayMessages()])

  Invariant: at rest (no agent running), pendingDisplayMessages is empty,
             so displayMessages is purely derived from the store.
```

## Problem Summary (from issue #56)

1. **user,user stacking** — user message persisted before agent, retry adds another
2. **Compaction not persisted** — in-memory only, lost on reload
3. **`/clear` and `/forget` not persisted** — in-memory only, messages return on reload
4. **@file contents lost on reload** — raw prompt persisted, augmented content only in memory
5. **TOOL_RESULT_PREFIX mismatch** — live tool results have prefix, reloaded ones don't
6. **Three independent representations diverge** — history signal, display signal, SQLite all written separately

## Phase 1: Schema & Persistence Layer

**Files**: `src/session/migrations.ts`, `src/session/index.ts`, `src/session/types.ts`

### 1a. New migration: `add_message_snapshots`

```sql
CREATE TABLE message_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,  -- 'auto_compaction' | 'manual_compaction'
  messages TEXT NOT NULL,       -- JSON-serialized StoredMessage[]
  original_count INTEGER NOT NULL,
  compacted_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_snapshots_session ON message_snapshots(session_id);
```

### 1b. New persistence functions

- `clearMessages(sessionId)` — DELETE all messages + snapshots, reset message_count
- `saveCompactionSnapshot(sessionId, type, compactedMessages, originalCount)` — INSERT snapshot (replace any existing for session)
- `getActiveMessages(sessionId)` — If snapshot exists: deserialize snapshot messages + append messages with `created_at > snapshot.created_at`. Otherwise: return all messages.
- `deleteLatestSnapshot(sessionId)` — DELETE snapshot (for future undo-compact)
- `hasTrailingUserMessage(sessionId)` — Check if last message is `user` role (for dedup)
- `deleteTrailingMessages(sessionId, count)` — DELETE last N messages (for `/forget`)

### 1c. New type: `MessageSnapshot`

```typescript
type MessageSnapshot = {
  id: string;
  sessionId: string;
  snapshotType: 'auto_compaction' | 'manual_compaction';
  messages: StoredMessage[];
  originalCount: number;
  compactedCount: number;
  createdAt: number;
};
```

### Snapshot semantics

A snapshot captures the compacted history at a point in time. Messages added *after* the snapshot are loaded on top:

```
active_messages = snapshot.messages + raw_messages WHERE created_at > snapshot.created_at
```

Original messages are NEVER deleted — the snapshot is an overlay.

---

## Phase 2: Convert.ts Updates

**Files**: `src/session/convert.ts`, `src/utils/file-list.ts`

### 2a. TOOL_RESULT_PREFIX on reload

In `toOllamaMessages`, prepend `TOOL_RESULT_PREFIX` to completed tool results:

```typescript
if (state.status === 'completed') {
  toolContent = `${TOOL_RESULT_PREFIX}\n\n${state.output}`;
}
```

### 2b. Strip `<attached-files>` for display

Add `stripFileAugmentation(content)` helper:

```typescript
function stripFileAugmentation(content: string): { text: string; attachedFiles?: string[] } {
  const match = content.match(/\n\n<attached-files>\n([\s\S]*)<\/attached-files>$/);
  if (!match) return { text: content };
  const text = content.slice(0, match.index);
  const files = [...match[1].matchAll(/<file path="([^"]+)">/g)].map(m => m[1]);
  return { text, attachedFiles: files.length > 0 ? files : undefined };
}
```

Apply in `toDisplayMessages` for user messages — display shows clean prompt + file badges.

### 2c. Persist augmented prompt

In `handleSubmit`, pass augmented prompt (not raw) to `addMessage`. `fromUserInput` stays the same.

---

## Phase 3: Message Store Hook

**Files**: New `src/tui/hooks/use-message-store.ts`

Central hook that owns all message state. Replaces scattered signal management.

### Signal structure

```typescript
const [storedMessages, setStoredMessages] = createSignal<StoredMessage[]>([]);
const [pendingDisplayMessages, setPendingDisplayMessages] = createSignal<DisplayMessage[]>([]);

// Derived: at rest = store only; during run = store + pending
const displayMessages = createMemo(() => {
  const base = toDisplayMessages(storedMessages());
  return [...base, ...pendingDisplayMessages()];
});

// Derived: always from store
const history = createMemo(() => toOllamaMessages(storedMessages()));
```

### Mutation functions

```typescript
// Persist user message + add to pending display
appendUserMessage(sessionId, rawPrompt, augmentedPrompt, attachedFiles?): void {
  if (!hasTrailingUserMessage(sessionId)) {
    addMessage(sessionId, 'user', fromUserInput(augmentedPrompt));
    refreshStore(sessionId);
  }
  setPendingDisplayMessages(prev => [
    ...prev,
    { type: 'user', content: rawPrompt, attachedFiles }
  ]);
}

// Persist assistant message, refresh store, clear pending
settleAgentRun(sessionId, content, toolParts, compacted?): void {
  if (content.trim() || toolParts.length > 0) {
    addMessage(sessionId, 'assistant', fromAssistantResponse(content, toolParts));
  }
  if (compacted) {
    saveCompactionSnapshot(sessionId, compacted.type, compacted.messages, compacted.originalCount);
  }
  refreshStore(sessionId);
  setPendingDisplayMessages([]);
}

// Live display updates (in-memory only, during agent run)
addPendingToolMessage(msg: ToolDisplayMessage): void
updatePendingToolState(toolId: string, state: ToolState): void
addPendingAssistantMessage(content: string): void

// Context operations (persist + update signals)
clear(sessionId): void {
  clearMessages(sessionId);
  setStoredMessages([]);
  setPendingDisplayMessages([]);
}

forget(sessionId, n): void {
  deleteTrailingMessages(sessionId, n);
  refreshStore(sessionId);
  setPendingDisplayMessages([]);
}

compact(sessionId, compactedStoredMessages, stats): void {
  saveCompactionSnapshot(sessionId, 'manual_compaction', compactedStoredMessages, stats.originalCount);
  refreshStore(sessionId);
  setPendingDisplayMessages([]);
}

loadSession(sessionId): void {
  setStoredMessages(getActiveMessages(sessionId));
  setPendingDisplayMessages([]);
}

reset(): void {
  setStoredMessages([]);
  setPendingDisplayMessages([]);
}

// Internal
refreshStore(sessionId): void {
  setStoredMessages(getActiveMessages(sessionId));
}
```

---

## Phase 4: Integrate Store Hook

**Files**: `use-agent-submit.ts`, `use-agent-context.ts`, `use-session.ts`, `index.tsx`

### 4a. `use-agent-submit.ts`

- Replace `props.setDisplayMessages` → `store.addPendingToolMessage`, `store.updatePendingToolState`, `store.addPendingAssistantMessage`
- Replace `props.setHistory(result.messages)` → `store.settleAgentRun(sessionId, ...)`
- Replace `addMessage(session.id, 'user', ...)` → `store.appendUserMessage(...)`
- Remove direct `addMessage` calls for assistant
- `props.history()` → `store.history()`

### 4b. `use-agent-context.ts`

- `handleClearContext` → `store.clear(sessionId)`
- `handleForget` → `store.forget(sessionId, n)`
- `handleCompact` → run compaction on `store.history()`, then `store.compact(sessionId, ...)`
- `sidebarStats` derives from `store.history()` reactively

### 4c. `use-session.ts`

- Remove `history`, `displayMessages` signals (live in store now)
- `handleSessionSelect` → `store.loadSession(session.id)`
- `handleNewSession` → `store.reset()`
- Export store's `displayMessages()` and `history()` through session return type

### 4d. `index.tsx`

- Wire store into component tree
- Update prop passing to use store accessors

---

## Phase 5: Auto-Compaction Persistence

**Files**: `src/agent/index.ts`, `src/agent/types.ts`

### 5a. Stash compaction result in agent

Add `compacted?: CompactionResult` to `AgentResult` and `AgentError`. When auto-compaction fires inside the agent loop, stash the result. Return it alongside messages.

### 5b. TUI persists snapshot

In `settleAgentRun`, if `result.compacted` is present, call `saveCompactionSnapshot`.

Minimal agent change — agent doesn't need to know about persistence.

---

## Phase 6: Testing & Verification

Manual testing scenarios:

1. **Normal conversation** — messages persist, reload shows same conversation
2. **Agent error + retry** — no user,user stacking, model recovers cleanly
3. **@file mention** — file contents present on reload, display shows clean prompt with file badges
4. **`/clear`** — clears both display and DB, fresh on reload
5. **`/forget N`** — removes last N from both display and DB
6. **`/compact`** — snapshot created, reload loads compacted + subsequent messages
7. **Auto-compaction** — snapshot persisted, session resume loads compacted state
8. **Process crash during agent** — user message survives, no orphan issues
9. **Long session with multiple compactions** — latest snapshot used, originals preserved
10. **TOOL_RESULT_PREFIX** — tool results identical on reload vs live

---

## File Change Summary

| File | Change | Risk |
|---|---|---|
| `src/session/migrations.ts` | New migration: `message_snapshots` | Low |
| `src/session/types.ts` | Add `MessageSnapshot` type | Low |
| `src/session/index.ts` | New CRUD functions (6 new) | Low |
| `src/session/convert.ts` | Strip file augmentation, add TOOL_RESULT_PREFIX | Low |
| `src/tui/hooks/use-message-store.ts` | **New file** — central store | Medium |
| `src/tui/hooks/use-agent-submit.ts` | Rewire to use store | High |
| `src/tui/hooks/use-agent-context.ts` | Rewire to use store | Medium |
| `src/tui/hooks/use-session.ts` | Remove message signals, delegate to store | Medium |
| `src/tui/index.tsx` | Wire store into component tree | Medium |
| `src/agent/index.ts` | Stash compaction result | Low |
| `src/agent/types.ts` | Add `compacted?` field | Low |

---

## Implementation Order

Implement in phase order. Commit each phase separately. Run `bun dev` test cycle after phases 3-4.

Phase 4 (integration) has the highest regression risk — do it incrementally:
1. Wire `use-session.ts` first (load/new/select)
2. Wire `use-agent-submit.ts` second (submit flow)
3. Wire `use-agent-context.ts` last (clear/forget/compact)
4. Test each individually before moving on

---

## Discoveries / Notes

- `@opentui` overrides `console.error` — use file-based logging for debug
- `useKeyboard` is global broadcast — use `isModalOpen` guards
- `<For>` bodies run once per item — use `createMemo` for derived values
- Conditional spread for backgroundColor doesn't clear — use ternary
- The agent's local `messages` array is mutable during the loop, then returned
- Compaction currently replaces `messages` in-place via `messages.length = 0; messages.push(...)`
- `toOllamaMessages` reconstructs `{ role: 'tool', content }` without TOOL_RESULT_PREFIX — divergence
- `augmentMessageWithFiles` appends `<attached-files>` XML block — parseable for stripping

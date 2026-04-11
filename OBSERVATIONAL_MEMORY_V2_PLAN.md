# Observational Memory v2 — Observer/Reflector Implementation

**Issues:** #69 (expanded), #66 (superseded)
**Research:** `docs/research/mastra-observational-memory-source.md`
**Replaces:** Phase 0 programmatic extraction (PR #70)
**Approach:** Mastra-style Observer/Reflector with coding-specific adaptation
**Status:** Implementation complete. All phases delivered.

---

## Executive Summary

Replaced both programmatic observation extraction (PR #70) and conversation
summarization (`compaction.ts`) with a Mastra-inspired Observer/Reflector system.
An Observer LLM agent watches conversations and extracts dense, coding-specific
observations. A Reflector agent condenses observations when they grow too large.
Async buffering pre-computes observations in the background so activation is instant —
the user never experiences a compaction pause.

**Key difference from Mastra:** Our Observer prompt is coding-specific, not
domain-agnostic. Uses text priority labels (`HIGH/MED/LOW`) instead of emoji
(`🔴🟡🟢`) for better compatibility with local models.

**Key constraint preserved:** Chat history is NEVER altered. Messages are excluded
from model context after observation, but remain in SQLite for display.

---

## Architecture Overview

### Three-Agent Model

```
Actor (main agent — Ollie)
  Sees: [system prompt] + [observations] + [continuation hint] + [recent messages]

Observer (background LLM agent)
  Watches: unobserved messages (the delta since last observation)
  Produces: <observations> + <current-task> + <suggested-response>
  Trigger: message tokens > threshold (default 30k)

Reflector (background LLM agent)
  Watches: observation text when it grows too large
  Produces: condensed observations (same format, fewer tokens)
  Trigger: observation tokens > threshold (default 40k)
```

### Context Window After Observation

```
[system prompt]                          ← Ollie's identity, tools, instructions
[system: observation block]              ← <observations>...</observations>
                                           + <current-task>...</current-task>
                                           + <suggested-response>...</suggested-response>
[system: continuation hint]              ← "Conversation grew too long, continue from observations"
[recent unobserved messages...]          ← Only messages NOT yet observed
```

### Data Flow

```
User submits message
  → runAgent starts, iterates with tool calls
  → Step 0: processOMStep (full pipeline)
    → Below threshold: fire async buffering at intervals
    → At threshold: activate buffered observations (instant)
      → Observed messages excluded from context
      → Observations injected as system message
    → Above blockAfter: synchronous Observer (blocking, last resort)
  → Each iteration: checkMidLoopBuffering
    → Zone 1 async buffering + async reflection trigger
  → Agent completes

Observer produces observations
  → Stored as markdown text in SQLite (single record per session)
  → observations + currentTask + suggestedResponse

When observations exceed reflection threshold
  → Try activate buffered reflection (instant, pre-computed)
  → Fall back to sync Reflector (compression escalation levels 0-3)
  → New generation record, old pushed to history
```

---

## File Inventory

### Core Memory System

| File | Description |
|------|-------------|
| `src/memory/types.ts` | `ObservationalMemoryRecord`, `BufferedObservationChunk`, `ObserverResult`, `ReflectorResult`, config types |
| `src/memory/observer.ts` | Observer agent: coding-specific system prompt, prompt builder, output parser, degenerate detection |
| `src/memory/reflector.ts` | Reflector agent: system prompt, compression escalation (levels 0-3), output parser |
| `src/memory/om.ts` | Core orchestrator: three-zone pipeline, sync/async observation, activation, context assembly, mid-loop buffering, OM record cache |
| `src/memory/buffering.ts` | Async buffering lifecycle: interval triggers, chunk management, activation, retention floor, async reflection ops |
| `src/memory/store.ts` | CRUD for `observational_memory` table (single-record per session) |
| `src/memory/token-counter.ts` | Token counting using `estimateTokens` heuristic (2.5 chars/token) |

### Integration Points

| File | Changes |
|------|---------|
| `src/session/migrations.ts` | Migration v6: `observational_memory` table. Migration v7: `observed_up_to` column |
| `src/agent/index.ts` | OM integration in agent loop, pre-computed action signatures, cached `strippedMessages` |
| `src/agent/types.ts` | `actionSignatures` field on `AgentStep` |
| `src/agent/loop-detector.ts` | Uses pre-computed `actionSignatures` |
| `src/agent/tool-processor.ts` | Minor integration changes |
| `src/agent/prompts/shared.ts` | `SystemPromptContext` updated for observation format |
| `src/agent/prompts/build.ts` | Observation injection |
| `src/agent/prompts/plan.ts` | Observation injection |
| `src/tui/hooks/use-agent-submit.ts` | Wired OM into agent lifecycle |
| `src/tui/hooks/use-agent-context.ts` | Sidebar stats update per iteration |
| `src/tui/hooks/use-message-store.ts` | Observation-aware message filtering |
| `src/tui/components/command-menu.tsx` | Context stats display |
| `src/config/schema.ts` | `memory` config section with Zod validation |
| `src/config/resolve.ts` | Memory config resolution |

### Tests

| File | Description |
|------|-------------|
| `tests/test-om.ts` | 136 tests: observer parsing, degenerate detection, reflector parsing, store CRUD, buffering intervals/activation/retention, mid-loop slice tracking, config extraction, reflection buffering |
| `tests/test-loop-detector.ts` | 15 tests: loop detection with pre-computed action signatures |

### Deleted (v1 dead code)

| File | Reason |
|------|--------|
| `src/memory/extractors.ts` | Replaced by Observer LLM |
| `src/memory/working-memory.ts` | Replaced by observation block |
| `tests/test-memory.ts` | Replaced by `test-om.ts` |
| `tests/test-memory-integration.ts` | Replaced by `test-om.ts` |

---

## Storage Schema

### Migration v6: `observational_memory` table

Single row per session. All state in one record.

```sql
CREATE TABLE IF NOT EXISTS observational_memory (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,

  -- Active observations (what the Actor sees)
  active_observations TEXT NOT NULL DEFAULT '',
  observation_token_count INTEGER NOT NULL DEFAULT 0,

  -- Observation tracking
  origin_type TEXT NOT NULL DEFAULT 'initial',  -- 'initial' | 'observation' | 'reflection'
  generation_count INTEGER NOT NULL DEFAULT 0,
  last_observed_at INTEGER,                      -- epoch ms cursor
  observed_message_ids TEXT NOT NULL DEFAULT '[]', -- JSON array (deprecated, kept for compat)
  observed_up_to INTEGER NOT NULL DEFAULT 0,      -- slice boundary (added in v7)

  -- Async buffering: observation chunks
  buffered_observation_chunks TEXT NOT NULL DEFAULT '[]', -- JSON array of chunks
  is_buffering_observation INTEGER NOT NULL DEFAULT 0,
  last_buffered_at_tokens INTEGER NOT NULL DEFAULT 0,
  last_buffered_at_time INTEGER,

  -- Async buffering: reflection
  buffered_reflection TEXT,
  buffered_reflection_tokens INTEGER,
  buffered_reflection_input_tokens INTEGER,
  reflected_observation_line_count INTEGER,
  is_buffering_reflection INTEGER NOT NULL DEFAULT 0,

  -- Lock flags
  is_observing INTEGER NOT NULL DEFAULT 0,
  is_reflecting INTEGER NOT NULL DEFAULT 0,

  -- Token tracking
  pending_message_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens_observed INTEGER NOT NULL DEFAULT 0,

  -- Thread metadata (current task, suggested response)
  current_task TEXT,
  suggested_response TEXT,

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

### Message Tracking: `observedUpTo`

Messages are tracked by position, not ID. `observedUpTo` is an integer slice
boundary: `allMessages.slice(observedUpTo)` = unobserved messages.

The deprecated `observedMessageIds` JSON array is kept for DB compatibility but
not read. Migration v7 backfills `observedUpTo` from the array length.

---

## Async Buffering Design

### Three Zones (Observation)

| Token Range | Behavior |
|-------------|----------|
| 0 → `messageTokens` | Normal operation + async buffering at intervals |
| `messageTokens` → `blockAfter` | Try activate buffered chunks; if unavailable, wait |
| > `blockAfter` | Synchronous blocking observation (last resort) |

### Default Thresholds

| Setting | Default | Rationale |
|---------|---------|-----------|
| `messageTokens` | 30,000 | Mastra default; ~15k words of conversation |
| `bufferTokens` | 0.2 (= 6,000) | Buffer every 20% of threshold |
| `bufferActivation` | 0.933 | Retain ~2k tokens of raw messages (tuned from Mastra's 0.8) |
| `blockAfter` | 1.2 (= 36,000) | Force sync at 120% of threshold |
| `observationTokens` | 40,000 | Reflection threshold |

### Mid-Loop Buffering

During the agent loop, `checkMidLoopBuffering` runs after each tool iteration.
It only fires Zone 1 async buffering (no activation or sync fallback — those
require message array mutation which can't happen mid-loop).

To prevent chunk overlap, slice tracking records where the last trigger cut the
agent message array. Subsequent triggers only observe NEW messages since the
last slice point.

### Ramp Mechanism

Near the threshold (within ~1 buffer interval), the buffering interval halves.
This produces finer-grained chunks so activation boundaries align better with
the retention floor target.

---

## Reflector Design

### Compression Escalation

| Level | Guidance | Detail Target |
|-------|----------|---------------|
| 0 | None (first attempt) | Full detail |
| 1 | "COMPRESSION REQUIRED" | 8/10 detail |
| 2 | "AGGRESSIVE COMPRESSION REQUIRED" | 6/10 detail |
| 3 | "CRITICAL COMPRESSION REQUIRED" | 4/10 detail |

If output tokens exceed the target, retry at the next level. Max 4 attempts.

### Async Reflection Buffering (Three-Tier Strategy)

| Tier | Token Range | Behavior |
|------|-------------|----------|
| 1. Async buffer | observations ≥ 50% of threshold (20k) | Fire background Reflector on oldest 80% of lines |
| 2. Activate | observations ≥ threshold (40k) | Try instant activation of pre-computed reflection |
| 3. Sync fallback | observations ≥ blockAfter (44k) | Block and run sync reflection |

When async reflection activates:
1. Split current observations at the recorded line boundary
2. Replace oldest lines with compressed reflection
3. Append unreflected new lines verbatim
4. Create new generation record

### Reflection Config

| Setting | Default | Description |
|---------|---------|-------------|
| `observationTokens` | 40,000 | Threshold to trigger reflection |
| `temperature` | 0 | Reflector LLM temperature |
| `bufferActivation` | 0.5 | Start async reflection at 50% of threshold |
| `blockAfter` | 1.1 | Force sync reflection at 110% of threshold |
| `reflectionSplit` | 0.8 | Reflect oldest 80% of observation lines |

---

## Config Schema

```typescript
memory: {
  enabled: boolean,              // default true
  model?: string,                // default: same as main agent model
  observation: {
    messageTokens: number,       // default 30000
    bufferTokens: number | false,// default 0.2 (fraction of messageTokens)
    bufferActivation: number,    // default 0.933
    blockAfter: number,          // default 1.2 (multiplier)
    temperature: number,         // default 0.3
  },
  reflection: {
    observationTokens: number,   // default 40000
    temperature: number,         // default 0
    bufferActivation: number | false, // default 0.5
    blockAfter: number,          // default 1.1
    reflectionSplit: number,     // default 0.8
  },
}
```

---

## Performance Optimizations

- **OM record cache**: In-memory `Map<sessionId, record>` avoids SQLite SELECT +
  `JSON.parse(buffered_observation_chunks)` on every agent iteration. Refreshed
  after processOMStep and DB writes.
- **Action signature pre-compute**: `actionSignatures` computed once on step creation
  instead of re-serialized on every loop detection comparison.
- **Cached `strippedMessages`**: Agent loop caches `stripSystemPrompt(messages)` to
  avoid re-filtering the full array on every callback/return path.
- **Skip DB writes mid-loop**: `pendingMessageTokens` is stats-only; mid-loop
  buffering skips the SQLite UPDATE to avoid blocking the agent loop.

---

## Implementation Phases (Completed)

### Phase 1: Core Observer ✅

Sync observation, types, store, orchestrator, migration v6, agent integration,
observation-aware message filtering, config schema.

### Phase 2: Reflector ✅

Compression escalation (levels 0-3), reflection trigger, generation count.

### Phase 3: Async Observation Buffering ✅

`buffering.ts`, three-zone pipeline, ramp mechanism, retention floor, chunk
activation, `blockAfter` sync fallback.

### Phase 3.5: Async Reflection Buffering + Performance ✅

Background Reflector, `splitObservationLines`, three-tier reflection strategy,
mid-loop buffering, OM record cache, action signature pre-compute, migration v7
(`observed_up_to`).

### Phase 4: Cleanup ✅

Deleted dead v1 code (`extractors.ts`, `working-memory.ts`, old tests).
Updated this plan document.

---

## Resolved Design Decisions

| Question | Decision |
|----------|----------|
| Model for Observer/Reflector | `memory.model` config option (optional, defaults to main model) |
| Token counting | `estimateTokens` heuristic (2.5 chars/token). Sufficient for threshold decisions. Tiktoken available if accuracy becomes an issue. |
| Priority format | `HIGH/MED/LOW` text labels (not emoji). Better for local models. `optimizeObservationsForContext()` strips all labels before Actor sees them. |
| Existing session migration | Lazy init: `getOrCreateOMRecord` creates initial record on first access. Old sessions get OM when threshold is first crossed. |
| Message tracking | `observedUpTo` integer boundary (not `observedMessageIds` array). Simpler, faster, no JSON parsing. |
| `bufferActivation` | 0.933 (retains ~2k raw tokens). Tuned from Mastra's 0.8 during testing. |
| Compaction fallback | Kept but disabled when OM is active. Can be removed in follow-up. |

---

## Known Limitations & Future Work

Deferred architecture issues from code review. None are blockers for the initial
ship, but should be addressed as OM matures in production use.

- [ ] **Reflector prompt size**: The Reflector system prompt embeds the full Observer
  prompt (~5.2k tokens total). On small models (8k context), this consumes 65% of
  context before any observation content. Consider a condensed Reflector prompt that
  summarizes Observer conventions instead of embedding verbatim.

- [ ] **Token counting heuristic**: All threshold decisions use `estimateTokens` (2.5
  chars/token heuristic). Ollama returns actual token counts in responses but these
  aren't fed back into OM tracking. Could be off by 20-30% depending on content type.
  Consider calibrating against actual counts from `onIterationComplete`.

- [ ] **No observation history**: Reflections replace `activeObservations` in-place.
  `generationCount` increments but previous generations aren't stored. If a reflection
  loses critical info, it's gone. A simple `observational_memory_history` table would
  preserve previous generations.

- [ ] **Remove compaction fallback**: `compaction.ts` and related code paths remain in
  the codebase, gated by `memoryConfig.enabled`. Once OM is validated in production,
  remove compaction entirely to reduce code surface.

- [ ] **In-memory state coupling**: Process-level Maps are spread across `om.ts`
  (`cachedOMRecord`) and `buffering.ts` (`activeBufferingOps`, `lastBufferedBoundary`,
  `lastMidLoopSliceEnd`, `activeReflectionOps`). These must be cleared together but
  have separate reset functions. Consider bundling into a single `OMSessionState`
  object if concurrent sessions or hot-reload are ever needed.

- [ ] **Sync fallback doesn't check in-flight ops**: `needsSyncFallback` triggers sync
  observation when tokens exceed `blockAfter` and no chunks exist, even if a buffering
  op is in-flight. The sync result is correct but redundant. Low risk — would require
  a ~6k token jump in one agent step.

- [ ] **Async chunk race after sync observation**: `updateAfterObservation` clears
  `buffered_observation_chunks` to `[]`. If an in-flight async op lands after this, the
  chunk covers already-observed messages. `pruneStaleChunks` handles this at activation
  time, but the race isn't prevented upstream.

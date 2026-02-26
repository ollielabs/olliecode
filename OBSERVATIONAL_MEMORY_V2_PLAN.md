# Observational Memory v2 — Full Observer/Reflector Implementation Plan

**Issues:** #69 (expanded), #66 (superseded)
**Research:** `docs/research/mastra-observational-memory-source.md`
**Replaces:** Phase 0 programmatic extraction (PR #70)
**Approach:** Mastra-style Observer/Reflector with coding-specific adaptation

---

## Executive Summary

Replace both programmatic observation extraction (PR #70) and conversation
summarization (`compaction.ts`) with a Mastra-inspired Observer/Reflector system.
An Observer LLM agent watches conversations and extracts dense, coding-specific
observations. A Reflector agent condenses observations when they grow too large.
Async buffering pre-computes observations in the background so activation is instant —
the user never experiences a compaction pause.

**Key difference from Mastra:** Our Observer prompt is coding-specific, not
domain-agnostic. We know exactly what our tools produce and what matters in coding
conversations.

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
  → Each step: check message token count
    → Below threshold: continue normally
    → At buffer interval: fire background Observer (async, non-blocking)
    → At threshold: activate buffered observations (instant)
      → Observed messages excluded from context
      → Observations injected as system message
    → Above blockAfter: synchronous Observer (blocking, last resort)
  → Agent completes

Observer produces observations
  → Stored as markdown text in SQLite (single record per session)
  → observations + currentTask + suggestedResponse

When observations exceed reflection threshold
  → Reflector condenses them (compression escalation levels 0-3)
  → New generation record, old pushed to history
```

---

## What Gets Removed

### PR #70 code (programmatic extraction)

| File | Action |
|------|--------|
| `src/memory/extractors.ts` | **Delete** — Observer replaces programmatic extraction |
| `src/memory/working-memory.ts` | **Delete** — Observer block replaces the builder |
| `src/memory/types.ts` | **Rewrite** — new types for Observer/Reflector system |
| `src/memory/store.ts` | **Rewrite** — new storage for observation records |
| `tests/test-memory.ts` | **Rewrite** — new tests for Observer system |
| `tests/test-memory-integration.ts` | **Rewrite** — new integration tests |

### Compaction code

| File | Action |
|------|--------|
| `src/agent/compaction.ts` | **Keep but disable** — not called when OM is active |

The compaction code stays in the codebase as a fallback during development. Once OM
proves itself, compaction can be removed in a follow-up.

### Migration v5 (observations table)

The existing `observations` table from PR #70 is not suitable for the new system.
The new migration will:
- Drop the `observations` table (or leave it and create new tables)
- Create the `observational_memory` table (single-record design)

---

## New/Modified Files

### Phase 1: Core Observer

| File | Action | Description |
|------|--------|-------------|
| `src/memory/types.ts` | Rewrite | `ObservationalMemoryRecord`, `BufferedObservationChunk`, `ObserverResult`, config types |
| `src/memory/observer.ts` | New | Observer agent: system prompt, prompt builder, output parser, degenerate detection |
| `src/memory/reflector.ts` | New | Reflector agent: system prompt, compression escalation, output parser |
| `src/memory/om.ts` | New | Core orchestrator: threshold checks, sync/async observation, activation, context assembly |
| `src/memory/store.ts` | Rewrite | CRUD for `observational_memory` table (single-record per session) |
| `src/memory/token-counter.ts` | New | Token counting for messages (evaluate: tiktoken vs our `estimateTokens`) |

### Phase 2: Integration

| File | Action | Description |
|------|--------|-------------|
| `src/session/migrations.ts` | Modify | Migration v6: `observational_memory` table |
| `src/agent/index.ts` | Modify | Replace `observationBlock` with OM integration in the iteration loop |
| `src/agent/prompts/shared.ts` | Modify | Update `SystemPromptContext` for new observation format |
| `src/agent/prompts/build.ts` | Modify | Update observation injection |
| `src/agent/prompts/plan.ts` | Modify | Update observation injection |
| `src/tui/hooks/use-agent-submit.ts` | Modify | Remove programmatic extraction, wire OM into agent lifecycle |
| `src/tui/hooks/use-message-store.ts` | Modify | New `history()` logic: observation-aware message filtering |
| `src/config/schema.ts` | Modify | Add `memory` config section |

### Phase 3: Async Buffering

| File | Action | Description |
|------|--------|-------------|
| `src/memory/buffering.ts` | New | Async buffering lifecycle: intervals, chunks, activation, retention floor |
| `src/memory/om.ts` | Modify | Integrate buffering into the step-by-step pipeline |

### Tests

| File | Action | Description |
|------|--------|-------------|
| `tests/test-observer.ts` | New | Observer prompt building, output parsing, degenerate detection |
| `tests/test-reflector.ts` | New | Reflector output parsing, compression validation |
| `tests/test-om-store.ts` | New | Storage CRUD, record lifecycle |
| `tests/test-om-integration.ts` | New | End-to-end: observation → storage → context assembly |
| `tests/test-buffering.ts` | New | Async buffering intervals, chunk activation, retention floor |

### Cleanup

| File | Action | Description |
|------|--------|-------------|
| `src/memory/extractors.ts` | Delete | Replaced by Observer |
| `src/memory/working-memory.ts` | Delete | Replaced by Observer |
| `tests/test-memory.ts` | Delete | Replaced by new test files |
| `tests/test-memory-integration.ts` | Delete | Replaced by new test files |

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
  observed_message_ids TEXT NOT NULL DEFAULT '[]', -- JSON array
  
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

CREATE INDEX IF NOT EXISTS idx_om_session
  ON observational_memory(session_id);
```

### `BufferedObservationChunk` (stored as JSON in `buffered_observation_chunks`)

```typescript
type BufferedObservationChunk = {
  cycleId: string;
  observations: string;
  tokenCount: number;
  messageIds: string[];
  messageTokens: number;
  lastObservedAt: number;  // epoch ms
  currentTask?: string;
  suggestedResponse?: string;
};
```

---

## Observer Prompt Design (Coding-Specific)

The Observer prompt is the most critical piece. It must be tailored to coding
conversations — we know our tools, our workflows, and what context matters.

### Structure

```
You are the memory consciousness of Ollie, an AI coding assistant. Your observations
will be the ONLY information Ollie has about past interactions in this coding session.

Your job is to watch the conversation and extract concise, actionable observations
that help Ollie continue working effectively.

=== WHAT TO OBSERVE ===

[Coding-specific extraction instructions]

=== OUTPUT FORMAT ===

[Priority emojis, date grouping, XML tags]

=== GUIDELINES ===

[Terse language, anti-repetition, grouping rules]
```

### Coding-Specific Extraction Instructions

```
TOOL CALL OBSERVATIONS:
When the agent calls tools, observe the semantic intent, not the raw calls.

BAD (repetitive, mechanical):
* 🟡 (14:30) Agent called read_file on src/auth.ts
* 🟡 (14:31) Agent called read_file on src/users.ts
* 🟡 (14:32) Agent called grep for "validateToken"

GOOD (semantic, grouped):
* 🟡 (14:30) Agent investigated auth flow
  * -> read src/auth.ts — found token validation using JWT at line 45
  * -> read src/users.ts — found user lookup by email at line 23
  * -> grep "validateToken" — 3 matches across auth module

FILE MODIFICATIONS:
Observe what changed and why, not just that a file was touched.

BAD: Agent edited src/agent/index.ts
GOOD: Agent edited src/agent/index.ts:45-60 — added observationBlock to RunAgentArgs
      to support memory injection into system prompt

COMMAND RESULTS:
Observe the outcome, especially failures. Preserve error messages that may recur.

BAD: Agent ran bun test
GOOD: Agent ran bun test — 44 passed, 0 failed (memory tests)
GOOD: Agent ran bun check:types — 5 errors in src/agent/index.ts (TS2345: type mismatch
      on observationBlock argument)

ARCHITECTURAL DECISIONS:
When the user or agent makes a design choice, observe the decision AND the reasoning.

GOOD: 🔴 (14:45) Decided to use SQLite single-record design for observation storage
      (simpler than per-observation rows, matches Mastra pattern, all state in one place)

USER REQUESTS AND GOALS:
User messages are always high priority. Observe the intent, not just the words.

GOOD: 🔴 (14:00) User wants to implement observational memory following Mastra's approach
      — Observer/Reflector pattern, async buffering, coding-specific prompts
      
GIT AND VERSION CONTROL:
Observe branch context, commits, PR state.

GOOD: 🟡 (15:00) On branch feat/observational-memory, committed "fix: cap errors at 10",
      PR #70 ready for merge

TEST RESULTS:
Preserve pass/fail counts and specific failure details.

GOOD: 🔴 (15:30) Tests: 44 passed, 2 failed
  * -> test-observer.ts: "expected observations to contain file path" — Observer not
       extracting file paths from edit_file results
  * -> test-om-integration.ts: timeout on async buffering activation
```

### Output Format

```
Use priority levels:
- 🔴 High: user requests, goals, decisions, completed tasks, errors, test failures
- 🟡 Medium: file modifications, command results, tool sequences, codebase discoveries
- 🟢 Low: file reads (unless something significant was discovered), routine operations

Group related tool call sequences by indenting under a semantic header.
Group observations by date, then list each with 24-hour time.

<observations>
Date: Feb 25, 2026
* 🔴 (14:00) User wants to implement full Observer/Reflector memory system
* 🟡 (14:05) Agent researched Mastra OM source code
  * -> read observer-agent.ts — massive prompt (~800 lines), domain-agnostic
  * -> read reflector-agent.ts — compression escalation levels 0-3
  * -> read observational-memory.ts — 6115 lines, async buffering with chunks
* 🔴 (14:30) Decision: go full Mastra-style, remove programmatic extraction layer
  * Rationale: Observer captures meaning not just artifacts, dual maintenance burden
* 🟡 (14:45) Agent drafted implementation plan
  * -> new files: observer.ts, reflector.ts, om.ts, buffering.ts
  * -> rewrite: types.ts, store.ts
  * -> delete: extractors.ts, working-memory.ts
</observations>

<current-task>
- Primary: Implementing observational memory v2 (Observer/Reflector system)
- Phase: Planning — implementation plan drafted, awaiting user approval
</current-task>

<suggested-response>
Present the implementation plan to the user for review. Key decisions to confirm:
Observer prompt design, async buffering scope, migration strategy for existing sessions.
</suggested-response>
```

---

## Async Buffering Design

### Three Zones

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
| `bufferActivation` | 0.8 | Retain ~20% of raw messages after activation |
| `blockAfter` | 1.2 (= 36,000) | Force sync at 120% of threshold |
| `observationTokens` | 40,000 | Reflection threshold |

### Buffering Lifecycle

1. **Interval trigger**: Every ~6k tokens of unobserved messages, fire a background
   Observer call. Near the threshold, halve the interval for finer chunks.

2. **Chunk storage**: Each background call produces a `BufferedObservationChunk` with
   observation text, message IDs, and token counts. Stored as JSON in the OM record.

3. **Activation**: When message tokens exceed threshold, activate buffered chunks:
   - Move chunk observations to `active_observations`
   - Remove activated chunks from buffer
   - Exclude observed messages from model context
   - Apply retention floor (keep ~6k tokens of raw messages)

4. **Safety fallback**: If messages exceed `blockAfter` and no buffered chunks are
   available, run a synchronous Observer call (blocking).

### Ramp Mechanism

Near the threshold (within ~1 buffer interval), the buffering interval halves.
This produces finer-grained chunks so activation boundaries align better with
the retention floor target.

---

## Reflector Design

### Trigger

When `observation_token_count` exceeds `observationTokens` threshold (default 40k).

### Compression Escalation

| Level | Guidance | Detail Target |
|-------|----------|---------------|
| 0 | None (first attempt) | Full detail |
| 1 | "COMPRESSION REQUIRED" | 8/10 detail |
| 2 | "AGGRESSIVE COMPRESSION REQUIRED" | 6/10 detail |
| 3 | "CRITICAL COMPRESSION REQUIRED" | 4/10 detail |

If output tokens exceed the target, retry at the next level. Max 4 attempts.

### Reflection Lifecycle

1. Reflector receives all current observations
2. Produces condensed version (same format, fewer tokens)
3. Creates a new generation record (`generation_count + 1`)
4. Old record pushed to history
5. `origin_type` changes from `'observation'` to `'reflection'`
6. Recursive: reflections can be reflected upon when they grow too large

### Async Buffered Reflection

When observations reach 50% of reflection threshold:
1. Background Reflector starts on first N lines of observations
2. Records `reflected_observation_line_count` boundary
3. New observations can still be appended while Reflector runs
4. At activation: lines before boundary replaced by reflection, lines after kept

---

## Integration Points

### `runAgent()` Changes

The agent loop currently builds messages once and iterates. With OM, each iteration
step needs to:

1. **Count unobserved message tokens** (including new tool results from this iteration)
2. **Check thresholds**: trigger async buffering or activate chunks
3. **Rebuild context** if activation occurred: inject observations, filter messages
4. **Continue iteration** with updated context

This means OM logic runs **per iteration**, not per turn. The observation block is no
longer a static string passed to `runAgent` — it's dynamically managed within the loop.

### `use-message-store.ts` Changes

The `history()` memo needs a new mode: observation-aware filtering.

When OM is active:
- No summary pointer (`summaryMsgId` is not used)
- Instead, filter by `lastObservedAt` and `observedMessageIds`
- History = only unobserved messages (messages after the observation cursor)
- Observations are injected separately as a system message, not through history

When OM is not active (fallback):
- Current behavior with summary pointer

### Config Schema

New `memory` section in config:

```typescript
memory: {
  enabled: boolean,           // default true
  model: string,              // default: same as main model
  observation: {
    messageTokens: number,    // default 30000
    bufferTokens: number,     // default 0.2 (fraction of messageTokens)
    bufferActivation: number, // default 0.8
    blockAfter: number,       // default 1.2 (multiplier)
    temperature: number,      // default 0.3
  },
  reflection: {
    observationTokens: number, // default 40000
    temperature: number,       // default 0
  },
}
```

---

## Migration Strategy

### Existing sessions

Existing sessions have:
- Messages in `messages` table (unchanged)
- Possible `summary_message_id` pointer (from old compaction)
- Possible rows in `observations` table (from PR #70 programmatic extraction)

Migration v6:
1. Create `observational_memory` table
2. Leave `observations` table in place (no data loss) but stop reading from it
3. Leave `summary_message_id` on sessions (old compaction still works as fallback)

When loading an existing session:
- If no OM record exists, create one with `origin_type: 'initial'`
- The Observer will lazily observe the backlog when the threshold is first exceeded
  (same as Mastra's approach for migrating existing threads)

### New sessions

Created with an OM record from the start. No compaction, no summary pointer.

---

## Implementation Phases

### Phase 1: Core Observer (sync only, no buffering)

**Goal:** Observer extracts observations, context is assembled correctly, messages
are filtered. Sync-only (blocking when threshold is hit). Proves the concept.

1. Rewrite `src/memory/types.ts` with new type definitions
2. Create `src/memory/observer.ts` — coding-specific prompt, output parser
3. Rewrite `src/memory/store.ts` — CRUD for `observational_memory` table
4. Create `src/memory/om.ts` — core orchestrator (sync observation only)
5. Add migration v6
6. Modify `src/agent/index.ts` — integrate OM into iteration loop
7. Modify `src/tui/hooks/use-agent-submit.ts` — remove programmatic extraction
8. Modify `src/tui/hooks/use-message-store.ts` — observation-aware history
9. Update prompts (`shared.ts`, `build.ts`, `plan.ts`)
10. Add config schema for `memory` section
11. Write tests for observer, store, integration
12. Manual testing with real conversations

### Phase 2: Reflector

**Goal:** Observations are condensed when they grow too large.

1. Create `src/memory/reflector.ts` — prompt, compression escalation, parser
2. Integrate reflection trigger into `om.ts`
3. Add generation count and history support to store
4. Write tests for reflector, compression validation
5. Manual testing with long conversations that exceed observation threshold

### Phase 3: Async Buffering

**Goal:** Background observation so activation is instant. "Never compacts" experience.

1. Create `src/memory/buffering.ts` — interval triggers, chunk management, activation
2. Integrate buffering into `om.ts` step pipeline
3. Add ramp mechanism near threshold
4. Add retention floor calculation
5. Add `blockAfter` synchronous fallback
6. Write tests for buffering intervals, activation, edge cases
7. Manual testing — verify no blocking pauses during conversation

### Phase 4: Cleanup

**Goal:** Remove old code, update issues, docs.

1. Delete `src/memory/extractors.ts`, `src/memory/working-memory.ts`
2. Delete old test files
3. Evaluate whether compaction code should be removed or kept as dead code
4. Update `OBSERVATIONAL_MEMORY_PLAN.md` (or replace with this doc)
5. Close #66 (superseded), update #69
6. Update AGENTS.md if needed

---

## Open Questions

1. **Model for Observer/Reflector**: Same model as the main agent, or a dedicated
   model? Mastra defaults to Gemini 2.5 Flash. Our users configure their own model.
   Should we use the same model (simpler) or add a `memory.model` config option
   (allows a cheaper/faster model for observation)?

2. **Token counting accuracy**: Our `estimateTokens()` is a heuristic. Mastra uses
   tiktoken with `o200k_base`. Should we adopt tiktoken for OM token counting, or is
   our heuristic accurate enough for threshold decisions?

3. **Observation prompt iteration**: The Observer prompt is the most important piece
   and will need iteration based on real-world testing. How do we plan for prompt
   refinement cycles?

4. **Existing session migration**: When a user opens an old session that has a
   compaction summary, should we: (a) keep using the summary until OM naturally takes
   over, (b) immediately observe the backlog, or (c) start fresh with OM from the
   next message?

5. **Observation format in context**: Mastra strips 🟡 and 🟢 emojis before showing
   observations to the Actor (only 🔴 survives). Should we do the same, or show all
   priorities to the Actor?

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Observer produces low-quality observations | Medium | High | Coding-specific prompt, degenerate detection, manual testing |
| Observer LLM call adds latency | Medium | Medium | Async buffering (Phase 3) eliminates perceived latency |
| Reflector loses important context | Low | High | Compression escalation, "your reflections are the ENTIRE memory" instruction |
| Token counting inaccuracy causes premature/late triggering | Low | Medium | Can tune thresholds; evaluate tiktoken if needed |
| Compaction fallback needed during development | Expected | Low | Keep compaction code, disable when OM is active |
| Migration breaks existing sessions | Low | Medium | Lazy initialization, graceful fallback to old compaction |

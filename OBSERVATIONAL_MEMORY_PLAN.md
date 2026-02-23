# Observational Memory — Phase 0 Implementation Plan

Issue: #65
Branch: `feat/observational-memory`
Base: `main` (`416c92a`)

## Summary

Programmatic extraction of structured observations from tool calls, stored in SQLite,
surfaced as an observation block in the system prompt. Zero LLM cost for Phase 0.
Survives compaction because observations live in a separate table, not in message history.

LLM-based extraction (goals, decisions, reasoning) is a fast-follow, not deferred to a
distant phase. The types, schema, and store API are designed to accommodate it without
rework.

## Target Models

Cloud-based models with large context windows: GLM-4.7, GLM-5, MiniMax 2.1/2.5,
Qwen3-Coder-Next, GPT-OSS, Kimi K2.5, etc. These have 200K–1M+ token context windows.
The observation block (~2000 tokens max) is <1% of the budget.

## Architecture

```
Tool call completes
  → onToolResult callback (use-agent-submit.ts:275)
  → extractObservations(toolName, args, result, sessionId) → Observation[]
  → addObservations(observations) → SQLite `observations` table

Before each runAgent call (per turn, not per iteration)
  → buildObservationBlock(sessionId) → string | null
  → Passed as observationBlock on RunAgentArgs
  → Injected into SystemPromptContext
  → Placed after environment block in system prompt
  → [system+observations, ...history, userMsg]
```

### Known limitation: observation block freshness

The observation block is built once per turn (before `runAgent`), not rebuilt per
iteration within the agent loop. Observations from tool calls within the current
turn are stored in SQLite but not visible to the model until the next turn. This
means observations are always one turn behind.

This is acceptable for Phase 0. Per-iteration freshness would require passing a
builder function into `runAgent` instead of a static string — a straightforward
change if needed later.

## New Files

### 1. `src/memory/types.ts`

```typescript
type ObservationType =
  | "file_modified"     // edit_file
  | "file_read"         // read_file
  | "file_created"      // write_file
  | "command_run"       // run_command (success)
  | "command_error"     // run_command (non-zero exit or error)
  | "search_performed"  // glob, grep
  | "todo_updated"      // todo_write
  | "task_delegated";   // task (subagent)

type Observation = {
  id: string;                        // randomUUID()
  sessionId: string;
  type: ObservationType;
  content: string;                   // human-readable description
  metadata: Record<string, unknown>; // structured data (path, command, exitCode, etc.)
  importance: number;                // 1-10, hardcoded per extractor
  source: "programmatic" | "llm";    // future-proofs for LLM extraction fast-follow
  createdAt: number;                 // Date.now()
};
```

### 2. `src/memory/extractors.ts`

Pure functions: `(toolName, args, result) → Observation[]`

| Tool | Type | Importance | Content example |
|------|------|------------|-----------------|
| `edit_file` | `file_modified` | 7 | `"Modified src/agent/index.ts"` |
| `write_file` | `file_created` | 7 | `"Created src/memory/types.ts"` |
| `read_file` | `file_read` | 3 | `"Read src/agent/index.ts"` |
| `run_command` (exit 0) | `command_run` | 4 | `"Ran: bun check:types → exit 0"` |
| `run_command` (error) | `command_error` | 8 | `"Failed: bun test → exit 1: TypeError..."` |
| `glob` | `search_performed` | 3 | `"Glob src/**/*.ts → 42 files"` |
| `grep` | `search_performed` | 3 | `"Grep 'onToolResult' → 3 matches"` |
| `todo_write` | `todo_updated` | 5 | `"Updated todos: 2 completed, 3 pending"` |
| `task` | `task_delegated` | 5 | `"Delegated: Explore codebase for memory hook points"` |

Returns `[]` for unrecognized tools.

### 3. `src/memory/store.ts`

Stateless module functions using `getDatabase()` from `src/session/db.ts`.

```typescript
function addObservations(observations: Observation[]): void
function getObservationsBySession(sessionId: string): Observation[]
function getRecentObservations(sessionId: string, opts?: {
  types?: ObservationType[];
  minImportance?: number;
  limit?: number;
}): Observation[]
function clearObservations(sessionId: string): void
function getLatestObservationTimestamp(sessionId: string): number | null
```

### 4. `src/memory/working-memory.ts`

```typescript
function buildObservationBlock(sessionId: string): string | null
```

Returns `null` if no observations exist.

Output format:
```markdown
<observations>
## Modified Files
- src/memory/types.ts (created)
- src/memory/extractors.ts (modified × 3)
- src/agent/index.ts (modified)

## Commands
- bun check:types → success
- bun test tests/test-memory.ts → success

## Errors
- run_command: TypeScript error TS2345 in src/agent/index.ts:208

## Searches
- grep "onToolResult" → 3 matches
- glob "src/memory/**" → 4 files

## Tasks Delegated
- "Explore codebase for memory hook points"
</observations>
```

Deduplication:
- Modified/created files: one entry per unique path, count of modifications
- Read files: omitted (low importance, not actionable)
- Commands: deduplicate by command string, keep last 10 unique
- Errors: keep all
- Searches: deduplicate by pattern, keep last 8 unique
- Todos: latest state only
- Task delegations: keep all

Token budget: 2000 tokens max (estimateTokens from src/lib/tokenizer.ts).
Trim order (lowest value first): searches → commands → delegations → todos.
Modified files and errors are never trimmed.

## Modified Files

### 5. `src/session/migrations.ts`

Migration v5:

```sql
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  importance INTEGER NOT NULL DEFAULT 5,
  source TEXT NOT NULL DEFAULT 'programmatic',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_observations_session_type ON observations(session_id, type);
CREATE INDEX IF NOT EXISTS idx_observations_session_importance ON observations(session_id, importance DESC);
```

### 6. `src/agent/prompts/shared.ts`

Add `observationBlock?: string` to `SystemPromptContext`.
Add `buildObservationBlockSection(block: string)` helper.

### 7. `src/agent/prompts/build.ts` + `plan.ts`

Include observation block after environment block, before communication style.

### 8. `src/agent/index.ts`

Add `observationBlock?: string` to `RunAgentArgs`.
Pass through to `SystemPromptContext` in `runAgent()`.

### 9. `src/tui/hooks/use-agent-submit.ts`

After `store.updatePendingToolState` (line 275): extract observations via
`extractObservations()` and store via `addObservations()`.

Before `runAgent()` call: build observation block via `buildObservationBlock(session.id)`
and pass as `observationBlock` arg.

## Test File

### `tests/test-memory.ts`

Using `bun:test` pattern.

1. **Extractors** — pure function tests, no DB
2. **Store** — SQLite round-trip tests (in-memory DB)
3. **Observation block builder** — formatting, deduplication, token budget

## Out of Scope

- LLM-based extraction (goals, decisions, preferences) — fast-follow
- Staleness detection / supersedes mechanism
- Cross-session persistence
- FTS5 or semantic retrieval
- Config options for memory (enable/disable, token budget)
- Changes to compaction logic

# User-Defined Agents — Implementation Plan

> **Issue:** [#28 - User-Defined Subagents](https://github.com/ollielabs/olliecode/issues/28)
> **Status:** Planning complete
> **Epic:** 7 stories (6 in scope, 1 deferred)

## Overview

Add a unified agent system to olliecode. Agents are reusable definitions with custom system prompts, permission-based tool restrictions, and configurable iteration budgets. They can operate as **primary agents** (Tab-switchable, shared context) or **subagents** (task-delegated, isolated context).

This replaces the current hardcoded `plan`/`build` mode system and the hardcoded `explore` subagent with a single, extensible agent registry.

## Design Decisions

### Agent Definition Format

Markdown files with YAML frontmatter. The filename is the fallback agent name; the `name` field in frontmatter is canonical when present.

```markdown
---
name: reviewer
description: Reviews code for quality, security, and best practices
mode: subagent
permission:
  "*": deny
  read: allow
  glob: allow
  grep: allow
  bash:
    "*": deny
    "git diff*": allow
maxIterations: 20
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

**File locations (precedence order, later wins):**

| Scope | Location |
|---|---|
| Built-in | Defined in code (build, plan, explore) |
| Global | `~/.config/ollie/agents/**/*.md` |
| Project | `.ollie/agents/**/*.md` |

- Recursive discovery (`**/*.md`)
- Project overrides global for same agent name
- `disabled: true` in project frontmatter suppresses a global agent
- Duplicate names within the same scope are an error at load time

### Agent Schema

```typescript
const AgentSchema = z.object({
  name: z.string().optional(),       // required in JSON config, filename fallback in markdown
  description: z.string(),           // required — used in task tool dynamic description
  mode: z.enum(['primary', 'subagent', 'all']).default('subagent'),
  model: z.string().optional(),      // Ollama model override
  temperature: z.number().min(0).max(2).optional(),
  maxIterations: z.union([
    z.number().int().positive(),
    z.enum(['quick', 'medium', 'thorough']),
  ]).optional(),
  permission: PermissionSchema.optional(),
  disabled: z.boolean().default(false),
});
```

**`maxIterations`** accepts a number or a named preset:

| Preset | Iterations |
|---|---|
| `quick` | 8 |
| `medium` | 15 |
| `thorough` | 25 |

The task tool caller can override in either direction. The global `AgentConfig.maxIterations` (50) is the hard ceiling.

### Unified Agent Model

`plan` and `build` are not separate "modes" — they are built-in agents with different permission defaults. The current `MODE_TOOLS` / `AgentMode` system is replaced by the permission system entirely.

**Built-in agents:**

| Name | Mode | Permissions |
|---|---|---|
| `build` | `primary` | `"*": allow` (full access, current default behavior) |
| `plan` | `primary` | `edit: deny` (read-only, current plan mode behavior) |
| `explore` | `subagent` | `"*": deny`, `read: allow`, `glob: allow`, `grep: allow`, `list: allow`, `bash: allow`, `web_fetch: allow` |

### Permission System

Full glob-pattern permission system modeled after OpenCode. Each agent has a permission ruleset controlling tool access.

**Actions:** `allow`, `ask`, `deny`

**Evaluation:** Last matching rule wins (evaluated via `findLast`).

**Permission keys:**

| Key | Maps to | Supports globs |
|---|---|---|
| `*` | All tools (wildcard default) | No |
| `read` | `read_file` | Yes (path patterns) |
| `edit` | `edit_file`, `write_file` | Yes (path patterns) |
| `glob` | `glob` | No |
| `grep` | `grep` | No |
| `list` | `list_dir` | No |
| `bash` | `run_command` | Yes (command patterns) |
| `task` | `task` | Yes (agent name patterns) |
| `todo` | `todo_write`, `todo_read` | No |
| `web_fetch` | `web_fetch` | No |
| `mcp` | All MCP tools | Yes (qualified name patterns) |

**Unknown keys fall through** via open record — future tools (`websearch`, `codesearch`, `skill`) work without schema changes.

**Example:**

```yaml
permission:
  "*": deny
  read: allow
  glob: allow
  grep: allow
  bash:
    "*": deny
    "git diff*": allow
    "git log*": allow
    "bun test*": allow
  mcp:
    "*": deny
    "mcp__github__*": allow
  task:
    "*": deny
    "explore": allow
```

**Runtime resolution order:**

1. Start with all registered tools
2. Apply agent's permission rules (filter/restrict)
3. Apply global safety config as ceiling (can never exceed global)
4. Intersect MCP tools with agent's `mcp` permissions

**Unavailable tools/MCP servers:** Warn at load time, silently ignore at runtime. MCP servers connect/disconnect dynamically — agent configs should not break on transient unavailability.

### Task Tool Changes

The task tool becomes a general delegation mechanism. Updated schema:

```typescript
const taskInput = z.object({
  description: z.string().min(1).describe('Short 3-5 word description of the task'),
  prompt: z.string().min(1).describe('Detailed task description for the agent'),
  agent: z.string().min(1).describe('Agent name to delegate to'),
  maxIterations: z.union([
    z.number().int().positive(),
    z.enum(['quick', 'medium', 'thorough']),
  ]).optional().describe('Override iteration budget'),
});
```

- `agent` is **required** — no default fallback
- `thoroughness` is removed, replaced by `maxIterations` (number or preset)
- `maxIterations` on the call overrides the agent's configured value (either direction), capped by global max

**Dynamic description:** The task tool description is generated at resolution time, listing available subagent-mode agents (permission-filtered, sorted alphabetically):

```
Available agents:
- explore: Fast codebase search specialist
- reviewer: Code review focused on quality and security
```

Only agents the calling agent is permitted to spawn (via `task` permission) are listed.

### Config File Support

Agents defined in `ollie.json` use the same schema with `name` required:

```json
{
  "agents": {
    "reviewer": {
      "name": "reviewer",
      "description": "Code review specialist",
      "mode": "subagent",
      "permission": {
        "*": "deny",
        "read": "allow",
        "glob": "allow",
        "grep": "allow"
      }
    }
  }
}
```

JSON config agents merge with markdown file agents. Duplicate names across formats within the same scope are an error.

## Stories

### Story 1: Permission System

**Goal:** Implement the permission evaluation engine independent of agents.

**Work:**
- Define `PermissionAction` type: `'allow' | 'ask' | 'deny'`
- Define `PermissionRule` type: `PermissionAction | Record<string, PermissionAction>`
- Define `PermissionRuleset` type: array of `{ permission: string, pattern: string, action: PermissionAction }`
- Implement `fromConfig(config)` — normalizes config format into a ruleset
  - Simple action (`"deny"`) normalized to `{ pattern: "*", action: "deny" }`
  - Object with patterns preserved as-is
- Implement `evaluate(permission, pattern, ...rulesets)` — finds last matching rule using glob matching
- Implement `merge(...rulesets)` — concatenates rulesets (later rules win via `findLast`)
- Implement `disabled(ruleset)` — returns set of tools denied by wildcard rules

**New files:**
- `src/agent/permission/index.ts` — evaluation engine
- `src/agent/permission/types.ts` — type definitions
- `tests/test-permissions.ts` — comprehensive unit tests

**Tests (bun:test):**
- Wildcard default (`"*": "deny"` denies everything)
- Specific override wins over wildcard (`"*": "deny"`, `"read": "allow"` → read is allowed)
- Glob pattern matching for bash commands (`"git diff*"` matches `"git diff HEAD"`)
- Last-match-wins ordering
- Merge concatenation behavior
- Unknown permission keys pass through
- Edge cases: empty ruleset, no matching rule (default allow), overlapping patterns

### Story 2: Agent Schema + Loader

**Goal:** Define the agent schema, parse markdown frontmatter, load agent files.

**Work:**
- Add `gray-matter` dependency for YAML frontmatter parsing
- Define `AgentInfo` Zod schema (as specified above)
- Implement markdown agent file parser:
  - Parse frontmatter with `gray-matter`
  - Body becomes the system prompt
  - `name` from frontmatter, filename as fallback
  - Validate against `AgentInfo` schema
- Implement agent file discovery:
  - Glob `**/*.md` in agents directories
  - Scan `~/.config/ollie/agents/` (global) and `.ollie/agents/` (project)
  - Recursive directory support
- Implement duplicate name detection (error within same scope)
- Implement `disabled: true` filtering
- Add `agents` field to `ConfigSchema` in `src/config/schema.ts` for JSON config support
- Surface warnings for invalid files (parse errors, schema violations)

**New files:**
- `src/agent/agents/loader.ts` — file discovery and parsing
- `src/agent/agents/schema.ts` — Zod schema definition
- `tests/test-agent-loader.ts` — unit tests

**Tests (bun:test):**
- Valid markdown parsing (frontmatter + body)
- Name from frontmatter vs filename fallback
- Missing required fields → helpful error
- Duplicate name detection within scope
- `disabled: true` filtering
- Recursive discovery finds nested files
- Invalid YAML frontmatter → warning, skip file
- Project overrides global for same name

### Story 3: Agent Registry + Built-in Agents

**Goal:** Create the central agent registry. Express `build`, `plan`, and `explore` as built-in agent definitions.

**Work:**
- Create `AgentRegistry` class/module:
  - Holds all resolved agents (built-in + user-defined)
  - `register(agent)` — add an agent
  - `get(name)` — lookup by name
  - `list(filter?)` — list agents, optionally filtered by mode
  - `listForTask(callerPermission)` — list subagent-mode agents the caller can invoke (permission-filtered)
- Define built-in agents:
  - `build`: `mode: "primary"`, `permission: { "*": "allow" }`, current build system prompt
  - `plan`: `mode: "primary"`, `permission: { edit: "deny" }`, current plan system prompt
  - `explore`: `mode: "subagent"`, `permission: { "*": "deny", read: "allow", glob: "allow", ... }`, current explore prompt
- Implement merging pipeline: built-in → global files → project files → JSON config
- Wire into config resolution (`src/config/resolve.ts`)

**New files:**
- `src/agent/agents/registry.ts` — agent registry
- `src/agent/agents/builtins.ts` — built-in agent definitions
- `src/agent/agents/index.ts` — public API
- `tests/test-agent-registry.ts` — unit tests

**Tests (bun:test):**
- Built-in agents are registered by default
- User-defined agents merge correctly
- Project overrides global
- `disabled: true` removes agent
- `get()` returns correct agent
- `listForTask()` filters by mode and permission
- Built-in override (user redefines `explore`)

### Story 4: Refactor Mode System

**Goal:** Remove hardcoded `MODE_TOOLS` / `AgentMode` and wire everything through the agent registry.

**Work:**
- Remove `src/agent/modes/index.ts` (or gut it to a thin wrapper)
- Remove `MODE_TOOLS` constant and `AgentMode` type
- Update `getToolsForMode()` in `src/agent/tools/index.ts`:
  - Takes an agent's permission ruleset instead of a mode string
  - Filters tools based on permission evaluation
- Update `getSystemPromptForMode()` in `src/agent/prompts/index.ts`:
  - Resolves prompt from agent definition instead of mode
  - Built-in agents carry their prompts (current `build.ts`, `plan.ts` content)
- Update `runAgent()` in `src/agent/index.ts`:
  - Accept an agent definition instead of mode
  - Use agent's permissions for tool filtering
  - Use agent's prompt as system prompt
- Update TUI mode toggle:
  - Toggle between `build` and `plan` agents via registry
  - Preserve current UX (same keybinding, same status bar display)
- Update `tool-processor.ts` to use permission evaluation instead of `isToolAvailable(mode, toolName)`

**Modified files:**
- `src/agent/modes/index.ts` — remove or replace
- `src/agent/tools/index.ts` — permission-based filtering
- `src/agent/prompts/index.ts` — agent-driven prompt resolution
- `src/agent/index.ts` — `runAgent()` signature change
- `src/agent/tool-processor.ts` — permission-based tool availability
- TUI components that reference mode (status bar, keybindings)

**Tests (bun:test):**
- Tool filtering matches current plan/build behavior exactly (regression)
- System prompt resolution works for built-in and user-defined agents
- Mode toggle cycles between build/plan agents

### Story 5: Task Tool + Subagent Invocation

**Goal:** Update the task tool to support agent selection and delegation through the registry.

**Work:**
- Update task tool schema:
  - `agent` (required): agent name to delegate to
  - `maxIterations` (optional): number or thoroughness preset, overrides agent default
  - Remove `thoroughness` parameter
- Implement agent resolution in task tool:
  - Look up agent in registry via `registry.get(params.agent)`
  - Error if agent not found or not available as subagent
  - Permission check: verify calling agent can invoke this subagent via `task` permission
- Implement dynamic task tool description:
  - `registry.listForTask(callerPermission)` returns available agents
  - Format as `- name: description` list, sorted alphabetically
  - Rebuild description when agent registry changes
- Implement subagent invocation:
  - Resolve tools based on agent's permissions
  - Use agent's system prompt (or `buildExplorePrompt` for built-in explore)
  - Use agent's model/temperature or inherit from parent
  - Resolve `maxIterations`: task call value → agent config → global default (capped by global max)
  - Create isolated context (fresh history, own iteration budget)
  - Pass through safety config and MCP tools
- Refactor existing explore subagent logic into the new system (remove hardcoded explore path)

**Modified files:**
- `src/agent/tools/task.ts` — full rewrite
- `src/agent/tools/index.ts` — dynamic task description injection
- `src/agent/prompts/explore.ts` — becomes the built-in explore agent's prompt (no functional change)

**Tests (bun:test):**
- Agent resolution from registry
- Permission check for subagent invocation
- `maxIterations` resolution (call override, agent default, global fallback)
- Unknown agent name → error
- Primary-only agent → error when invoked as subagent
- Dynamic description lists correct agents

**Promptfoo evals:**
- Agent selection accuracy: given a task description, does the LLM pick the right agent?
- Tool restriction enforcement: does a restricted subagent stay within its allowed tools?
- End-to-end delegation: parent → task tool → subagent → result

### Story 6: Promptfoo Eval Suite

**Goal:** Add comprehensive eval coverage for the agent system.

**Work:**
- Add eval cases to `promptfooconfig.yaml`:
  - **Agent selection:** "Review this code for security issues" → should pick `reviewer` agent
  - **Agent selection:** "Find all usages of the logger" → should pick `explore` agent
  - **Fallback behavior:** Task with unknown agent name → graceful error
  - **Tool restriction:** Subagent with `edit: deny` should not attempt file writes
  - **Multi-agent:** Multiple task calls with different agents in one response
- Update `tests/run-agent.ts` or create test harness that loads test agent configs
- Define test agent markdown files for eval scenarios

**New files:**
- `tests/agents/*.md` — test agent definitions for eval scenarios
- Updated `promptfooconfig.yaml` with new test cases

### Story 7 (Deferred): Primary Agent Tab-Switching

**Goal:** Allow users to Tab-switch between user-defined primary agents.

**Deferred because:** Requires TUI changes, session management updates, and UX design for agent switching beyond the current plan/build toggle. The data model supports it from Story 3 onward — this is purely a TUI integration story.

**Work (when picked up):**
- Tab key cycles through all `primary` and `all` mode agents
- Status bar shows active agent name
- `@mention` invocation for any agent
- Agent-specific color in TUI (if `color` field is added later)

## Dependencies

```
Story 1 (Permission System)
    └──> Story 2 (Schema + Loader) — uses PermissionSchema
              └──> Story 3 (Registry + Built-ins) — uses loader + schema
                        └──> Story 4 (Refactor Modes) — uses registry
                        └──> Story 5 (Task Tool) — uses registry
                                  └──> Story 6 (Evals) — tests full pipeline
```

Stories 4 and 5 can be worked in parallel after Story 3.

## Research References

- **OpenCode** ([github.com/sst/opencode](https://github.com/sst/opencode)): Primary reference implementation. Unified agent model, markdown+frontmatter, glob-pattern permissions, dynamic task tool descriptions.
- **Claude Code**: Pioneered user-defined subagents. Markdown files in `.claude/agents/`, rich frontmatter schema, 31+ community repos of reusable agents.
- **Codex CLI**: Separates Skills (markdown) from Subagents (TOML). Thread management with `max_threads`/`max_depth`.

## Key Design Principles

1. **Unified model** — agents are agents, whether primary or subagent. No separate "mode" system.
2. **Permissions are the security boundary** — tool restriction is always via the permission system, never via hardcoded tool lists.
3. **Extensible schema** — unknown permission keys pass through. Future tools work without schema changes.
4. **Correct over convenient** — `agent` is required on task calls, no magic defaults.
5. **Warn, don't break** — unavailable tools/MCP servers produce warnings, not load failures.
6. **Safety ceiling** — global safety config can never be exceeded by agent permissions.

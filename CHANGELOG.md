# olliecode

## 0.5.0

### Minor Changes

- [#79](https://github.com/ollielabs/olliecode/pull/79) [`bf2a146`](https://github.com/ollielabs/olliecode/commit/bf2a14616ecac807255e346604c1efe30a478b99) Thanks [@platypusrex](https://github.com/platypusrex)! - Replace programmatic observation extraction with Mastra-inspired Observer/Reflector memory system.

  An Observer LLM agent watches conversations and extracts dense, coding-specific observations. A Reflector agent condenses observations when they grow too large. Async buffering pre-computes observations in the background so activation is instant — no compaction pause.

  - Three-agent model: Actor (main), Observer (background), Reflector (compression)
  - Three-zone async buffering: below threshold = background chunks, at threshold = instant activation, above = sync fallback
  - Observer with coding-specific prompt using HIGH/MED/LOW text priority labels
  - Reflector with compression escalation (levels 0-3) and async pre-computation
  - Mid-loop buffering with slice tracking to prevent chunk overlap
  - Observation history table preserving previous generations before reflection overwrites
  - OM record cache and action signature pre-compute for performance
  - SQLite single-record design (migrations v6-v8)
  - Configurable via `memory` config section (model, thresholds, activation, reflection)
  - 140 tests covering observer, reflector, store, buffering, history, and orchestration

- [#53](https://github.com/ollielabs/olliecode/pull/53) [`4756396`](https://github.com/ollielabs/olliecode/commit/475639606b8012cae704a0afdd4e8609748ed37c) Thanks [@platypusrex](https://github.com/platypusrex)! - Migrate TUI rendering layer from React (@opentui/react) to SolidJS (@opentui/solid). All components, hooks, and build infrastructure rewritten for Solid's fine-grained reactivity model. Includes reactive theme switching via store-based ThemeProvider, correct scroll-follow in menus, and fixes for confirmation key leak, Ctrl+E during thinking, and diff preview for multi-line edits.

### Patch Changes

- [#62](https://github.com/ollielabs/olliecode/pull/62) [`132a873`](https://github.com/ollielabs/olliecode/commit/132a8730348019147f20d906b64beba889dcced4) Thanks [@platypusrex](https://github.com/platypusrex)! - Fix message history inconsistencies between in-memory and persisted state.

  - Add central `useMessageStore` hook as single source of truth for all message state
  - Add message snapshot schema and persistence layer for compaction
  - Persist agent errors as chat messages (`ErrorPart`) instead of ephemeral status
  - Fix user message dedup to check content, not just role
  - Reconstruct tool call history when loading from compaction snapshots
  - Prevent "prompt too long" crashes with pre-call compaction check and emergency retry
  - Capture real token counts from Ollama (`prompt_eval_count`/`eval_count`)
  - Fix Zod `.transform()` breaking JSON Schema generation for Ollama tool definitions
  - Fix `@` and `/` commands blocked during error state
  - Add `write_file` diff preview in confirmation dialog
  - Raise `maxIterations` to 50 with soft warning at 80%

- [#68](https://github.com/ollielabs/olliecode/pull/68) [`416c92a`](https://github.com/ollielabs/olliecode/commit/416c92ae7e3bf1fc8bf8696f6cf77c5e4343fce9) Thanks [@platypusrex](https://github.com/platypusrex)! - Fix token counting accuracy: sidebar now displays real token counts from Ollama's prompt_eval_count instead of a character-based heuristic that overestimated by 33-60%.

  - Replace heuristic sidebar estimation with real counts from prompt_eval_count/eval_count
  - Parse num_ctx from /api/show parameters to detect operational context limits below the architecture max
  - Compute tool schema overhead dynamically instead of using hardcoded constants
  - Add debug logging comparing estimated vs real token counts after each model call

- [#59](https://github.com/ollielabs/olliecode/pull/59) [`0768cc1`](https://github.com/ollielabs/olliecode/commit/0768cc1bda40be1415aa63f24b85e80d020519bf) Thanks [@platypusrex](https://github.com/platypusrex)! - Fix TUI bugs across event isolation, error resilience, scroll behavior, and side panel display.

  - Preserve message history on agent abort, error, and tool denial instead of silently losing it
  - Strip system prompt from all error return paths to prevent double system prompt on recovery
  - Prevent Escape key in command modal from denying active tool confirmations
  - Prevent textarea from capturing keys during confirmation dialogs
  - Fix session picker selection highlight not updating on arrow navigation (Solid reactivity)
  - Fix file picker Enter key submitting the chat query instead of selecting the file
  - Fix oscillation detector false positives on legitimate edit/read workflows
  - Add scroll-into-view for session picker, command menu, and file picker navigation
  - Replace console.error debug logger with file-based logging (bypasses @opentui capture)
  - Overhaul side panel: show all todos with strikethrough on completed, expandable list, real-time refresh
  - Highlight @file mentions in textarea with accent color and underline
  - Use neutral diff backgrounds for improved legibility
  - Disable a11y/noStaticElementInteractions Biome rule (not applicable to terminal UIs)

## 0.4.0

### Minor Changes

- [`b464a92`](https://github.com/ollielabs/olliecode/commit/b464a92310c956ba30dcba4ac901ba1b90767f7d) Thanks [@platypusrex](https://github.com/platypusrex)! - Add user-configurable settings with JSON/JSONC config files

  - Support global (`~/.config/ollie/config.json`) and project-level (`ollie.json`) config files with JSON and JSONC (comments, trailing commas) support, deep merging, and layer precedence
  - Add configurable model, host, temperature, autonomy level, tool permissions, agent settings, compaction, TUI theme, and custom instruction files
  - Add `/config` slash command to inspect active configuration sources, resolved values, effective permissions, and validation warnings
  - Autonomy levels (paranoid/cautious/balanced/autonomous) control per-tool permission baselines with explicit overrides
  - Partial recovery on validation errors: invalid fields fall back to defaults while preserving valid settings
  - 83 unit tests covering config parsing, merging, resolution, and source attribution

## 0.3.0

### Minor Changes

- [#10](https://github.com/ollielabs/olliecode/pull/10) [`91c6f8b`](https://github.com/ollielabs/olliecode/commit/91c6f8bc959680dc2ceeb58d2d397144854d6be7) Thanks [@platypusrex](https://github.com/platypusrex)! - Add AGENTS.md support and /init command

  - Automatically load project instructions from `AGENTS.md` files
    - Global: `~/.config/ollie/AGENTS.md`
    - Project: `./AGENTS.md`
  - Inject instructions into system prompts for all modes (build, plan, explore)
  - Add `/init` slash command to create or update AGENTS.md
    - Analyzes codebase and generates comprehensive project instructions
    - Supports optional arguments: `/init focus on testing conventions`

## 0.2.0

### Minor Changes

- [#8](https://github.com/ollielabs/olliecode/pull/8) [`7115ab3`](https://github.com/ollielabs/olliecode/commit/7115ab330c0293c9f0e2b8f41984057224fc38b0) Thanks [@platypusrex](https://github.com/platypusrex)! - Add clipboard support and keyboard shortcuts help modal

  - Ctrl+Y copies selected text to system clipboard (cross-platform: macOS, Linux, Windows)
  - Ctrl+P opens keyboard shortcuts help modal showing all available shortcuts and commands
  - Toast notification confirms successful copy
  - Status bar now shows shortcut hints (tab/ctrl+p)

## 0.1.6

### Patch Changes

- [`7881ec0`](https://github.com/ollielabs/olliecode/commit/7881ec08965e9a61497da8373f9e1733e09ea6c9) Thanks [@platypusrex](https://github.com/platypusrex)! - Fix worker path for compiled binaries using Bun's virtual filesystem

## 0.1.5

### Patch Changes

- [`8e03569`](https://github.com/ollielabs/olliecode/commit/8e03569311f0c2edefea58a0c258477577ae1db7) Thanks [@platypusrex](https://github.com/platypusrex)! - Fix macOS Intel runner for x64 builds

## 0.1.4

### Patch Changes

- [`2893ad5`](https://github.com/ollielabs/olliecode/commit/2893ad572e1206868158e5b614742a84f26936fb) Thanks [@platypusrex](https://github.com/platypusrex)! - Replace GoReleaser with native matrix builds for proper cross-platform compilation

## 0.1.3

### Patch Changes

- [`e970a9d`](https://github.com/ollielabs/olliecode/commit/e970a9d5743f5bd5f691c175e37c9bae4acdfa96) Thanks [@platypusrex](https://github.com/platypusrex)! - Fix goreleaser pipeline (again)

## 0.1.2

### Patch Changes

- [`c28169f`](https://github.com/ollielabs/olliecode/commit/c28169f8819cc2510df2bf13a08c1f491eef51fb) Thanks [@platypusrex](https://github.com/platypusrex)! - Fix release pipeline for GoReleaser

## 0.1.1

### Patch Changes

- [`96d73ea`](https://github.com/ollielabs/olliecode/commit/96d73ea1d368400cb0f9877eb5a1b7edecde3b4f) Thanks [@platypusrex](https://github.com/platypusrex)! - fix release pipeline

## 0.1.0

### Minor Changes

- Initial release of Ollie Code - an agentic coding tool powered by Ollama

# Plan: TUI Overhaul — OpenTUI Feature Adoption & Architecture Cleanup

> Source: GitHub Issue #51 — "Adopt new @opentui features (post-Solid migration)"
> Date: 2026-05-17
> Current versions: `@opentui/core` ^0.1.97, `@opentui/solid` ^0.1.97, `solid-js` 1.9.9

## Executive Summary

This plan brings the OllieCode TUI from its current post-migration state to a polished,
fully-modernized terminal interface. The work spans two major version upgrades
(0.1.97 → 0.1.107 → 0.2.12), replaces custom workarounds with native opentui
primitives, eliminates architectural debt from the React→Solid migration, and adopts
every high-value feature identified in issue #51 plus features released since.

The plan is organized as **vertical slices** — each phase delivers a complete,
testable improvement. Phases are ordered by dependency (later phases build on earlier
ones) and risk (safer changes first).

---

## Architectural Decisions

These decisions apply across all phases:

- **Runtime**: Bun (current). Phase 8 enables Node.js runtime support via 0.2.x platform layer.
- **Framework**: `@opentui/solid` with SolidJS signals/stores for all reactivity.
- **Keyboard architecture**: Native opentui keymap system replaces the custom `KeyboardFocusProvider` stack. `stopPropagation` + focusable elements replace userland gating.
- **Markdown rendering**: `<markdown streaming>` element replaces `<code filetype="markdown">` for assistant messages (both streaming and finalized).
- **Clipboard**: OSC 52 via `renderer.copyToClipboardOSC52()` replaces the cross-platform clipboard detection module.
- **Theme detection**: `renderer.themeMode` + `renderer.on("theme_mode", ...)` replaces manual `COLORFGBG` env var parsing.
- **Focus model**: Native `focusable` Box elements with auto-focus-on-click for interactive lists.
- **Layout shorthands**: `marginX`/`marginY`/`paddingX`/`paddingY` preferred over explicit left/right/top/bottom pairs.
- **Testing**: `testRender` from `@opentui/solid` for snapshot tests on all new/refactored components.

---

## Phase 1: Dependency Upgrade to 0.1.107 (Safe Semver Range)

**Goal**: Get to the latest 0.1.x release without any code changes. Verify nothing breaks.

### What to build

Update `@opentui/core` and `@opentui/solid` to `0.1.107` (within the existing `^0.1.97`
semver range, so this is effectively just a lockfile update). Update `solid-js` to
`1.9.12` to match the peer dependency expectation. Run the full test suite and
manually verify the TUI renders correctly.

This phase is pure dependency management — no source code changes. It unlocks all
features from v0.1.80 through v0.1.107 for subsequent phases.

### Acceptance criteria

- [ ] `bun install` resolves `@opentui/core@0.1.107` and `@opentui/solid@0.1.107`
- [ ] `solid-js` updated to `1.9.12`
- [ ] `babel-preset-solid` updated to match (1.9.12 if available, or compatible)
- [ ] `bun run dev` launches without errors
- [ ] All existing tests pass (`bun test`)
- [ ] Type checking passes (`bun run check:types`)
- [ ] Manual smoke test: start a chat session, send a message, receive streaming response, open command menu, open session picker, open config modal — all function correctly
- [ ] No visual regressions in theme rendering

---

## Phase 2: Architecture Cleanup — DRY Modal Rendering & Component Extraction

**Goal**: Eliminate duplicated JSX and establish clean component boundaries before feature work.

### What to build

The current `src/tui/index.tsx` renders all modals (ContextStatsModal, ConfigModal,
McpStatusModal, KeyboardShortcutsModal, SessionPicker, ThemePicker) in both the
welcome screen branch AND the chat screen branch (~80 lines duplicated). Extract this
into a `<ModalLayer>` component that renders once, above both branches.

Additionally, extract the welcome screen and chat screen into their own dedicated
components (`<WelcomeScreen>` and `<ChatScreen>`) to reduce the size of `AppContent`
and improve readability.

Address the fragile prop extraction in `AppContent` (lines 72-74 where `props.config`,
`props.configLayers`, `props.configWarnings` are assigned to plain variables). Convert
these to proper accessor patterns or document why they're safe.

### Acceptance criteria

- [ ] New `<ModalLayer>` component renders all modals exactly once, regardless of app state (welcome vs chat)
- [ ] `<WelcomeScreen>` component extracted with its own props interface
- [ ] `<ChatScreen>` component extracted with its own props interface
- [ ] `src/tui/index.tsx` reduced to composition of the above components plus context providers
- [ ] No props destructuring introduced — all components access `props.foo` directly
- [ ] Fragile `const model = props.config.model` patterns either converted to accessors or annotated with `// Static: set once at mount, never changes` with a comment explaining why
- [ ] All existing functionality preserved — zero behavioral changes
- [ ] Snapshot tests added for `<ModalLayer>`, `<WelcomeScreen>`, `<ChatScreen>`

---

## Phase 3: Streaming Markdown Rendering

**Goal**: Replace raw `<text>` streaming with progressive markdown rendering using `<markdown streaming>`.

### What to build

Currently, streaming assistant responses display as plain unstyled text:
```tsx
<Show when={agent.streamingContent()}>
  <box><text>{agent.streamingContent()}</text></box>
</Show>
```

Replace this with the `<markdown>` element in streaming mode:
```tsx
<markdown
  content={agent.streamingContent()}
  syntaxStyle={markdownStyle()}
  streaming={true}
/>
```

This provides progressive rendering of headings, bold, code blocks, lists, and tables
as tokens arrive — rather than the jarring switch from plain text to fully-formatted
content when the message finalizes.

Also migrate the finalized assistant message rendering in `assistant-message.tsx` from
`<code filetype="markdown">` to `<markdown>` for consistency. The `<markdown>` element
provides purpose-built markdown rendering (table alignment, list formatting, concealment
of syntax characters) that `<code>` with a markdown filetype cannot match.

### Acceptance criteria

- [ ] Streaming responses render with markdown formatting (headings, bold, code fences, lists) in real-time
- [ ] `streaming={true}` prop used during active streaming; switches to `streaming={false}` when finalized
- [ ] Finalized messages in `assistant-message.tsx` use `<markdown>` instead of `<code filetype="markdown">`
- [ ] `syntaxStyle` from the current theme is passed through correctly
- [ ] Code blocks within markdown responses have syntax highlighting
- [ ] No visual glitches during rapid token streaming
- [ ] Tables render with proper column alignment (TextTable renderable, available since v0.1.82)
- [ ] `selectable={true}` preserved for text selection in finalized messages
- [ ] Performance: no noticeable frame drops during streaming (target: maintain 60fps)

---

## Phase 4: Replace Keyboard Focus Stack with Native Keymap System

**Goal**: Remove the custom 163-line `keyboard-focus.tsx` and replace with opentui's native keyboard primitives.

### What to build

The current `KeyboardFocusProvider` registers 7+ `useKeyboard` handlers that ALL fire
on every keypress, with userland `isActive()` gating to determine which handler
should actually execute. This is replaced by:

1. **`stopPropagation`** (available since v0.1.70) — Modal/overlay components stop
   event propagation, preventing events from reaching underlying layers.

2. **Focusable Box** (v0.1.76) — Interactive containers receive focus natively,
   scoping keyboard events to the focused element tree.

3. **Keymap system** (v0.1.98+) — Declarative key binding registration with
   priority-based resolution, replacing the imperative switch statements.

**Migration strategy:**

- Remove `KeyboardFocusProvider`, `useFocusLayer`, `useScopedKeyboard` entirely
- Each modal/overlay component uses `focusable` Box + `stopPropagation` in its keyboard handler
- Global shortcuts (Ctrl+K, Ctrl+Y, Ctrl+P) registered via the keymap system with appropriate priority
- Component-local shortcuts (arrow navigation in menus) scoped to their focusable container
- The `APP` layer's keyboard handling moves into the main `<ChatScreen>` component directly

### Acceptance criteria

- [ ] `src/tui/keyboard/keyboard-focus.tsx` deleted entirely
- [ ] `KeyboardFocusProvider` removed from the component tree
- [ ] All imports of `useFocusLayer`, `useScopedKeyboard`, `FocusLayer` removed
- [ ] Modals stop keyboard propagation — typing in a modal never triggers app-level shortcuts
- [ ] Command menu stops propagation — arrow keys don't scroll the chat
- [ ] File picker stops propagation — same isolation guarantee
- [ ] Global shortcuts (Ctrl+K command menu, Ctrl+Y copy, Ctrl+P session picker) work from any context
- [ ] Escape in a modal closes the modal without triggering app-level escape handling
- [ ] Nested modals work correctly (e.g., opening theme picker from config modal)
- [ ] No regressions in textarea input — typing in the input box works exactly as before
- [ ] Performance: only 1 handler fires per keypress (not 7+)
- [ ] Integration tests covering: modal open/close, command menu navigation, shortcut isolation

---

## Phase 5: OSC 52 Clipboard & Selection Improvements

**Goal**: Replace the 129-line custom clipboard with native OSC 52 support.

### What to build

Remove `src/lib/clipboard.ts` which manually detects macOS (osascript), Linux
(wl-copy/xclip/xsel), and Windows (PowerShell) clipboard commands. Replace with
`renderer.copyToClipboardOSC52()` which works natively in all modern terminals
including over SSH, inside tmux/screen, and in containerized environments.

Also adopt the `useSelectionHandler` hook for text selection, replacing any manual
selection + copy logic:

```tsx
useSelectionHandler((selection) => {
  selection.copyToClipboard() // Uses OSC 52 internally
})
```

Remove the `clipboardy` npm dependency.

### Acceptance criteria

- [ ] `src/lib/clipboard.ts` deleted
- [ ] `clipboardy` removed from `package.json` dependencies
- [ ] All clipboard copy operations use `renderer.copyToClipboardOSC52()`
- [ ] `useSelectionHandler` hook integrated for text selection copy
- [ ] Ctrl+Y (copy selection) works using OSC 52
- [ ] Clipboard works over SSH sessions (where native commands would fail)
- [ ] Clipboard works inside tmux/screen
- [ ] Fallback behavior documented for terminals that don't support OSC 52
- [ ] `renderer.isOsc52Supported()` checked before attempting copy, with user-facing notification on unsupported terminals

---

## Phase 6: Focusable Interactive Lists

**Goal**: Simplify command menu, file picker, and session picker using native focus and `scrollChildIntoView`.

### What to build

The three interactive list components (command-menu, file-picker, session-picker) all
share the same manual pattern:
- `createSignal<number>` for `selectedIndex`
- `useScopedKeyboard` with arrow/j/k handling
- Manual `scrollIntoView` helper for scroll tracking
- Imperative `scrollboxRef` management

Replace with native opentui patterns:
- `<box focusable>` for each list item
- Auto-focus on click (v0.1.76)
- `scrollChildIntoView` method on ScrollBox (v0.1.88) for automatic scroll tracking
- Arrow key navigation handled by the focusable container's native behavior

Extract a shared `<NavigableList>` component that encapsulates this pattern once,
used by all three list UIs.

### Acceptance criteria

- [ ] `<NavigableList>` shared component created with props: `items`, `onSelect`, `renderItem`, `onCancel`
- [ ] Command menu uses `<NavigableList>` — keyboard navigation works (arrows, j/k, enter, escape)
- [ ] File picker uses `<NavigableList>` — same navigation, plus filtering
- [ ] Session picker uses `<NavigableList>` — same navigation, plus rename/delete actions
- [ ] Mouse click on any list item focuses and selects it (auto-focus on click)
- [ ] Scroll automatically follows the focused item via `scrollChildIntoView`
- [ ] Removed: manual `selectedIndex` signals from all three components
- [ ] Removed: manual scroll offset calculations
- [ ] Each list item has `focusable` Box wrapping
- [ ] Visual focus indicator (border color change or highlight) on the focused item
- [ ] Performance: instant focus transitions, no scroll jank

---

## Phase 7: Theme Detection & Layout Shorthands

**Goal**: Adopt automatic dark/light detection and modernize layout props across the codebase.

### What to build

**Theme detection:**

Replace the current `detectColorScheme()` in `src/design/theme.ts` which only checks
the `COLORFGBG` env var (broken on most modern terminals) with the native opentui
`renderer.themeMode` property and `theme_mode` event:

```tsx
const renderer = useRenderer()
const [theme, setTheme] = createSignal(renderer.themeMode ?? "dark")
onMount(() => {
  renderer.on("theme_mode", (mode) => setTheme(mode))
})
```

This uses Mode 2031 terminal query (v0.1.78) which works on iTerm2, Ghostty, Kitty,
WezTerm, Windows Terminal, and most modern emulators.

**Layout shorthands:**

Audit all components and replace verbose padding/margin pairs with axis shorthands:
- `paddingLeft={2} paddingRight={2}` → `paddingX={2}`
- `marginTop={1} marginBottom={1}` → `marginY={1}`

**autoFocus renderer option:**

Configure the renderer with `autoFocus: true` to eliminate manual `.focus()` calls
where appropriate.

**Bottom title/alignment on Box:**

Adopt the `bottomTitle` and `titleAlignment` props (v0.1.97) for status information
on bordered containers.

### Acceptance criteria

- [ ] `detectColorScheme()` function removed from `src/design/theme.ts`
- [ ] `ThemeProvider` uses `renderer.themeMode` for initial theme and listens for `theme_mode` events
- [ ] Theme auto-switches when terminal dark/light mode changes (no restart required)
- [ ] Manual theme selection still overrides auto-detection
- [ ] All `paddingLeft`+`paddingRight` pairs replaced with `paddingX` where values match
- [ ] All `paddingTop`+`paddingBottom` pairs replaced with `paddingY` where values match
- [ ] All `marginLeft`+`marginRight` pairs replaced with `marginX` where values match
- [ ] All `marginTop`+`marginBottom` pairs replaced with `marginY` where values match
- [ ] Renderer created with `autoFocus: true`
- [ ] Manual `.focus()` calls removed where `autoFocus` handles it
- [ ] At least one `bottomTitle` usage added (e.g., status bar info on chat container)
- [ ] No layout regressions — spacing identical before and after shorthand conversion

---

## Phase 8: Upgrade to @opentui 0.2.x

**Goal**: Cross the breaking change boundary to access the latest platform features.

### What to build

Upgrade `@opentui/core` and `@opentui/solid` from `0.1.107` to `^0.2.12`. This
involves handling two breaking changes:

1. **Color metadata packing** (v0.2.0) — RGBA high bytes now carry metadata. Audit
   all places where we create or manipulate `RGBA` values directly (theme.ts,
   color.ts, utils.ts). The `RGBA` helper function should still work, but any
   bitwise operations on raw color values need updating.

2. **Platform abstraction** (v0.2.0+) — Bun-specific globals replaced with a platform
   layer. Audit for any direct `Bun.file`, `bun:ffi`, or Bun-specific APIs that
   opentui previously exposed. Our code uses `createCliRenderer` which should be
   unaffected, but verify.

Also adopt new 0.2.x features:
- **OSC 8 hyperlinks** — URLs in markdown output become clickable terminal hyperlinks
- **OSC notifications** — Notify the user when a long-running agent task completes
- **`useFocus`/`useBlur` hooks** — React to terminal window focus changes
- **`targetFps`/`maxFps` setters** — Dynamic frame rate adjustment for power saving

### Acceptance criteria

- [ ] `@opentui/core` and `@opentui/solid` updated to `^0.2.12`
- [ ] `solid-js` confirmed at `1.9.12`
- [ ] All `RGBA` color values verified — no corruption from metadata packing
- [ ] Build succeeds with `bun run build`
- [ ] Type checking passes
- [ ] All tests pass
- [ ] No Bun-specific API breakage from platform abstraction
- [ ] URLs in markdown responses render as clickable OSC 8 hyperlinks
- [ ] OSC notification sent when agent completes a tool call that took >5 seconds
- [ ] `useFocus` hook used to pause/resume expensive rendering when terminal loses focus
- [ ] Frame rate reduced to 15fps when terminal is unfocused (power saving)
- [ ] Manual smoke test across: iTerm2, Ghostty, Kitty (if available), basic Terminal.app

---

## Phase 9: Terminal Focus Hooks & Performance Polish

**Goal**: Leverage terminal focus events and finalize performance optimizations.

### What to build

Adopt the Solid-specific `useFocus`/`useBlur` hooks (v0.1.89) and the
`targetFps`/`maxFps` setters (v0.1.93) for intelligent resource management:

- When the terminal window loses focus, reduce rendering frequency
- When regained, restore full frame rate
- Pause streaming animations when unfocused
- Resume state indicators (spinners, progress) immediately on refocus

Additionally, audit the entire TUI for performance:
- Ensure all `<For>` loops use stable references (not recreated arrays)
- Verify memos are used for expensive derived computations
- Check that effects have minimal dependency surfaces
- Profile frame times during streaming and ensure consistent 60fps

### Acceptance criteria

- [ ] `useFocus` callback fires when terminal gains focus
- [ ] `useBlur` callback fires when terminal loses focus
- [ ] Renderer `targetFps` set to 15 when blurred, 60 when focused
- [ ] Streaming token rendering does not drop frames (measured with `time-to-first-draw`)
- [ ] No unnecessary signal re-creations in `<For>` loops
- [ ] `createMemo` used for all derived values accessed more than once
- [ ] No effects with overly broad dependency tracking
- [ ] Spinner/loading animations pause when terminal unfocused
- [ ] Memory stable during long chat sessions (no signal leaks)

---

## Phase 10: Plugins, Slots & Extensibility Foundation

**Goal**: Adopt the Plugins/Slots system for future extensibility.

### What to build

The Plugins/Slots system (v0.1.88) provides a framework-level extensibility mechanism.
Integrate it to allow:

- Custom renderable slots in the status bar (e.g., git branch, token count, model name)
- Plugin-based side panel content
- Slot-based notification area for toast messages

This is foundational work — it doesn't add user-visible features immediately but
establishes the architecture for future plugin support (MCP tool output renderers,
custom display components, etc.).

### Acceptance criteria

- [ ] Status bar uses named slots for each section (left, center, right)
- [ ] At least one slot populated via the plugin registration API
- [ ] Toast notification area managed via a slot
- [ ] Side panel content configurable via slots
- [ ] Plugin registration documented in code comments
- [ ] No performance regression from slot overhead
- [ ] Slot fallback identity caching active (v0.1.93 optimization)

---

## Phase 11: Comprehensive Testing & Documentation

**Goal**: Full test coverage for all new components and refactored systems.

### What to build

Every phase above should include tests, but this phase adds comprehensive integration
and snapshot testing to ensure long-term stability:

- Snapshot tests for every component using `testRender`
- Keyboard interaction tests: verify shortcut isolation, modal focus, navigation
- Theme switching tests: verify all components respond to theme changes
- Streaming tests: verify markdown rendering under rapid token delivery
- Resize tests: verify responsive behavior at various terminal dimensions
- Regression test suite: one test per bug fixed during this overhaul

Update the `AGENTS.md` file with TUI development guidelines reflecting the new
architecture (no more focus stack, use `<markdown>`, use focusable Box, etc.).

### Acceptance criteria

- [ ] Every component in `src/tui/components/` has at least one snapshot test
- [ ] Keyboard shortcut isolation tested: modal open → type → verify no app-level side effects
- [ ] Theme auto-detection tested with mock `renderer.themeMode`
- [ ] Streaming markdown rendering tested with incremental content updates
- [ ] Terminal resize tested at 80x24, 120x40, 40x12 (minimum viable)
- [ ] `NavigableList` tested: arrow navigation, enter selection, escape cancel, mouse click
- [ ] OSC 52 clipboard tested (mock renderer method)
- [ ] `AGENTS.md` updated with TUI architecture section
- [ ] All tests pass in CI (`bun test`)
- [ ] Zero TODO/FIXME comments remain in `src/tui/`

---

## Dependency Summary

| Phase | Depends on | Risk | Estimated Scope |
|-------|-----------|------|-----------------|
| 1 | None | Low | Lockfile + smoke test |
| 2 | Phase 1 | Low | Refactoring only, no new APIs |
| 3 | Phase 1 | Medium | New `<markdown>` element, streaming behavior |
| 4 | Phase 1 | High | Complete keyboard architecture replacement |
| 5 | Phase 4 | Low | Simple API swap (OSC 52) |
| 6 | Phase 4 | Medium | Shared component + focusable Box |
| 7 | Phase 1 | Low | Config + find-and-replace |
| 8 | Phases 1-7 | High | Breaking version boundary |
| 9 | Phase 8 | Low | Hooks + tuning |
| 10 | Phase 8 | Medium | New architecture pattern |
| 11 | All | Low | Testing + documentation |

**Parallelization:** Phases 2, 3, and 7 can be worked in parallel after Phase 1.
Phase 4 is the critical path — Phases 5 and 6 depend on it. Phase 8 is the second
major gate — Phases 9 and 10 depend on it.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| 0.2.x color packing breaks theme rendering | Phase 8 is isolated; full visual regression test before/after. Keep 0.1.107 branch as rollback. |
| `stopPropagation` doesn't fully replace focus stack | Phase 4 is the most complex. Prototype the modal isolation pattern first in a branch before committing. |
| `<markdown streaming>` has rendering glitches | Test with rapid token delivery (100+ tokens/sec). The element has been stable since v0.1.80 rebuild. |
| Removing `clipboardy` breaks non-OSC52 terminals | Check `renderer.isOsc52Supported()` and log a warning. Document which terminals lack support. |
| Performance regression from native focus | Benchmark keypress-to-render latency before and after Phase 4. Native should be faster (1 handler vs 7). |

---

## Out of Scope

The following are explicitly **not** included in this plan:

- Node.js runtime support (0.2.x enables it, but we remain Bun-only)
- Native audio features (v0.2.4) — not relevant for a coding assistant
- Custom inline highlighting callback — deferred to future search feature
- `captureSpans`/`getSpanLines` — deferred to future testing enhancements
- MCP tool output custom renderables — future work after Phase 10 slots are in place

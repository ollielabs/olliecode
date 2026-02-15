# Solid Migration Guide

Reference document for the React → Solid migration (GitHub issue #52).
This captures all investigation findings so they survive context compaction.

## Tracking Issues

- #50 — Dependency update to @opentui 0.1.79 (completed)
- #51 — New @opentui feature adoption (parked until post-migration)
- #52 — Solid migration (primary workstream)

## Build Setup

### Dependencies to add/remove

```
# Add
solid-js@1.9.9          # exact pin required by @opentui/solid peer dep
@opentui/solid@^0.1.79  # replaces @opentui/react

# Remove
@opentui/react
react
babel-plugin-react-compiler

# Keep (used by @opentui/solid's babel transform)
@babel/core
@babel/preset-typescript
@types/babel__core

# @opentui/core stays unchanged
```

### tsconfig.json changes

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  }
}
```

### bunfig.toml changes

```toml
preload = ["@opentui/solid/preload"]
```

The preload registers a Bun plugin that uses `@babel/core` + `babel-preset-solid` to
transform `.tsx`/`.jsx` files with `generate: "universal"` and `moduleName: "@opentui/solid"`.

### react-compiler.preload.ts

Delete this file. Remove from `files` array in package.json.

### Build scripts

Current `bun build --compile` won't work because it doesn't load Bun preloads.
Need a `build.ts` script using `Bun.build()` API with the Solid plugin:

```ts
import solidPlugin from "@opentui/solid/bun-plugin";

await Bun.build({
  entrypoints: ["src/index.tsx", "./node_modules/@opentui/core/parser.worker.js"],
  compile: true,
  outfile: "ollie",
  define: {
    'OTUI_TREE_SITTER_WORKER_PATH': '"/$bunfs/root/node_modules/@opentui/core/parser.worker.js"'
  },
  plugins: [solidPlugin],
});
```

Cross-compilation targets (`bun-darwin-arm64`, `bun-darwin-x64`) need verification
with the `Bun.build()` API — the `compile` option may use a different format than
the CLI `--target` flag.

## API Mappings

### Entry Point

```tsx
// React (current)
import { createRoot } from "@opentui/react";
const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<App config={config} />);

// Solid
import { render } from "@opentui/solid";
const renderer = await createCliRenderer({ exitOnCtrlC: true });
await render(() => <App config={config} />, renderer);
```

`render()` signature: `(node: () => JSX.Element, rendererOrConfig?: CliRenderer | CliRendererConfig) => Promise<void>`

The render function wraps the component tree in `RendererContext.Provider` automatically.

### Hooks from @opentui/solid

| Hook | Import | Signature | Notes |
|------|--------|-----------|-------|
| `useRenderer` | `@opentui/solid` | `() => CliRenderer` | Same as React |
| `useKeyboard` | `@opentui/solid` | `(handler, options?) => void` | Same API; callback registered once at mount via `onMount`/`onCleanup` |
| `useTerminalDimensions` | `@opentui/solid` | `() => Accessor<{width, height}>` | Returns a signal, access as `dimensions().width` |
| `onResize` | `@opentui/solid` | `(callback) => void` | Named differently from React's `useOnResize` |
| `usePaste` | `@opentui/solid` | `(handler) => void` | Solid-only, not in React |
| `useSelectionHandler` | `@opentui/solid` | `(handler) => void` | Solid-only, not in React |
| `useTimeline` | `@opentui/solid` | `(options?) => Timeline` | Same as React |

### React → Solid Pattern Mappings

| React | Solid | Notes |
|-------|-------|-------|
| `useState(init)` | `createSignal(init)` | Read via `value()` not `value` |
| `useEffect(fn, [deps])` | `createEffect(fn)` | Auto-tracks, no dep array |
| `useEffect(fn, [])` | `onMount(fn)` | Mount-only |
| `useEffect` cleanup return | `onCleanup(fn)` inside effect | Called inside, not returned |
| `useMemo(fn, [deps])` | `createMemo(fn)` | Auto-tracks, returns accessor |
| `useCallback(fn, [deps])` | Not needed | Functions stable in Solid |
| `useRef(init)` | `let variable = init` | No `.current` wrapper |
| `useContext` / `createContext` | Same names from `solid-js` | API is identical |
| `React.ReactNode` | `JSX.Element` | From `solid-js` |
| `React.Dispatch<SetStateAction<T>>` | `Setter<T>` | From `solid-js` |
| `React.RefObject<T>` | `T \| undefined` | Plain variable |
| `{cond && <X/>}` | `<Show when={cond}><X/></Show>` | From `solid-js` |
| `list.map(fn)` | `<For each={list}>{fn}</For>` | From `solid-js`; index is accessor `idx()` |
| `function Foo({ a, b })` | `function Foo(props)` | NEVER destructure props in Solid |
| `key={id}` on list items | Not needed | `<For>` uses referential identity |

### Element Naming (Solid uses underscores)

| React (kebab-case) | Solid (underscore) |
|---------------------|-------------------|
| `<ascii-font>` | `<ascii_font>` |
| `<tab-select>` | `<tab_select>` |
| `<line-number>` | `<line_number>` |

All other elements are unchanged: `box`, `text`, `textarea`, `input`, `select`,
`scrollbox`, `code`, `diff`, `markdown`, `span`, `strong`, `b`, `em`, `i`, `u`, `br`, `a`.

### Ref Handling

Refs use Solid's callback ref pattern. The reconciler calls `props.ref(node)` with
the renderable instance.

```tsx
// Direct assignment (Solid compiler transforms to callback)
let textareaRef: TextareaRenderable | undefined;
<textarea ref={textareaRef!} />

// Explicit callback
<textarea ref={(el) => { textareaRef = el }} />

// Access (no .current)
textareaRef?.focus();
textareaRef?.plainText;
textareaRef?.setText("");
```

### TextareaProps (richer than React)

```ts
type TextareaProps = {
  // ... all TextareaOptions from @opentui/core ...
  focused?: boolean;
  onSubmit?: () => void;
  onContentChange?: (value: string) => void;  // React doesn't have this
  onCursorChange?: (value: { line: number; visualColumn: number }) => void;  // React doesn't have this
  onKeyDown?: (event: KeyEvent) => void;  // React doesn't have this
  onKeyPress?: (event: KeyEvent) => void;  // WARNING: typed but NOT IMPLEMENTED (#481)
  ref?: Ref<TextareaRenderable>;
}
```

`onContentChange` may replace the `setTimeout(0)` hack in `useCommandMenu` and `useFilePicker`.

### ScrollBoxProps (typed in Solid)

```ts
type ScrollBoxProps = {
  // ... all ScrollBoxOptions ...
  focused?: boolean;
  stickyScroll?: boolean;
  stickyStart?: "bottom" | "top" | "left" | "right";
}
```

### Special Components (Solid-only)

- `Portal` — render children into a different mount point (modals, overlays)
- `Dynamic` — render arbitrary intrinsic elements dynamically

## Key Architectural Insights

### Stale closure problem is solved

`useKeyboard` registers the callback once at mount (via `onMount`). In React, this
creates stale closures requiring the ref-mirror pattern (10+ useRef instances). In Solid,
signal accessors (`status()`) always return current values when called, regardless of when
the function was created. All ref-mirror code can be eliminated.

### useKeyboard source (confirmed from index.js:56-71)

```js
var useKeyboard = (callback, options) => {
  const renderer = useRenderer();
  const keyHandler = renderer.keyInput;
  onMount(() => { keyHandler.on("keypress", callback); });
  onCleanup(() => { keyHandler.off("keypress", callback); });
};
```

### Props must not be destructured

Solid's reactivity depends on property access on the props object. Destructuring
breaks reactive tracking. Use `props.foo` everywhere instead of `{ foo }`.

For default values, use `mergeProps` from `solid-js`:
```ts
import { mergeProps } from "solid-js";
const merged = mergeProps({ mode: "build" }, props);
// access as merged.mode
```

### Children handling

In Solid, `props.children` is reactive. Don't destructure it. Pass through directly:
```tsx
<box>{props.children}</box>
```

### Batching

When multiple signals update synchronously (e.g., in the streaming handler),
Solid batches by default within synchronous code. For async boundaries, use
`batch()` from `solid-js` if needed:
```ts
import { batch } from "solid-js";
batch(() => {
  setStatus("idle");
  setStreamingContent("");
  setDisplayMessages(prev => [...prev, msg]);
});
```

## File-by-File Migration Inventory

### Complex (5 files)

1. **`src/tui/index.tsx`** — God component; 2 signals, 2 refs (→ plain vars), 1 memo,
   15+ conditional renders (→ `<Show>`), 1 list render (→ `<For>`), 2 `<ascii-font>` → `<ascii_font>`
2. **`src/tui/hooks/use-session.ts`** — 9 signals, 1 ref (→ plain var), 2 effects;
   all return types change from `React.Dispatch` → `Setter<T>`
3. **`src/tui/hooks/use-agent-submit.ts`** — 4 signals, 4 refs (→ plain vars);
   237-line async handler; streaming updates; Promise-based confirmation flow
4. **`src/tui/components/tool-message.tsx`** — 689 lines; 2 refs, 1 effect, useKeyboard;
   multiple sub-components; confirmation flow
5. **`src/tui/components/session-picker.tsx`** — 3 signals, 1 ref, 2 effects, useKeyboard,
   useTerminalDimensions; nested list with mutable `globalIndex` counter (must precompute)

### Moderate (10 files)

6. `src/design/theme.ts` — createContext/useContext (same API in Solid)
7. `src/design/ThemeProvider.tsx` — useState→createSignal, useMemo→createMemo, ReactNode→JSX.Element
8. `src/tui/hooks/use-agent-context.ts` — 4 signals, 1 effect with async IIFE
9. `src/tui/hooks/use-command-menu.ts` — 3 signals, useKeyboard; setTimeout(0) may be replaceable with onContentChange
10. `src/tui/hooks/use-keyboard-shortcuts.ts` — 2 signals, 5 refs (ALL ELIMINABLE — stale closure refs)
11. `src/tui/hooks/use-file-picker.ts` — 5 signals, useEffect([])→onMount, useKeyboard
12. `src/tui/components/theme-picker.tsx` — 2 signals, 1 effect, useKeyboard
13. `src/tui/components/file-picker.tsx` — 1 effect, useKeyboard, ReactNode[]→JSX.Element[]
14. `src/tui/components/command-menu.tsx` — 1 effect, useKeyboard
15. `src/tui/components/input-box.tsx` — 1 ref (→ plain var), 1 effect; ref forwarding changes

### Trivial (17 files)

Config: `package.json`, `tsconfig.json`, `bunfig.toml`, `react-compiler.preload.ts` (delete)
Entry: `src/index.tsx` (createRoot → render)
Types: `src/tui/types.ts` (React.RefObject → plain types)
Barrel exports: `src/design/index.ts`, `src/tui/hooks/index.ts`, `src/tui/components/index.ts`
No changes: `src/tui/utils.ts`, `src/tui/constants.ts`
Presentational (props + Show/For only): `assistant-message.tsx`, `status-bar.tsx`,
`user-message.tsx`, `side-panel.tsx`, `diff-view.tsx`, `context-stats-modal.tsx`,
`context-info-notification.tsx`, `keyboard-shortcuts-modal.tsx`, `config-modal.tsx`,
`toast-notification.tsx`, `modal.tsx`

## Implementation Phases

### Phase 1: Build infrastructure
- Swap deps in package.json
- Configure tsconfig, bunfig, preload
- Create build.ts for production builds
- Verify `bun run src/index.tsx` starts (even if crashes at runtime)
- Verify `bun run build.ts` produces a binary

### Phase 2: Foundation layer
- Migrate `src/design/theme.ts` and `ThemeProvider.tsx`
- Migrate `src/tui/types.ts`
- Migrate `src/index.tsx`

### Phase 3: Hooks (bottom-up dependency order)
- `use-session.ts` (independent)
- `use-agent-context.ts` (depends on session)
- `use-agent-submit.ts` (depends on session)
- `use-command-menu.ts` (depends on agent)
- `use-file-picker.ts` (depends on agent, commands)
- `use-keyboard-shortcuts.ts` (depends on agent, session, commands)

### Phase 4: Components (leaf-first)
- Trivial presentational components (8 files)
- `modal.tsx`, `toast-notification.tsx`
- `input-box.tsx`
- `command-menu.tsx`, `file-picker.tsx`
- `theme-picker.tsx`, `session-picker.tsx`
- `tool-message.tsx`
- `src/tui/index.tsx` (last — depends on everything)

### Phase 5: Validation
- `bun check:types`
- `bun lint`
- `bun run build.ts`
- Manual smoke test (see issue #52 checklist)

## Known Risks & Gotchas

1. **solid-js pinned to exact 1.9.9** — cannot upgrade independently
2. **onKeyPress typed but NOT IMPLEMENTED** (#481) — use onKeyDown instead
3. **Solid babel transform insert ordering** — PR #604 (draft) has open edge case
4. **No DevTools** — debug via `renderer.console` and `renderer.toggleDebugOverlay()`
5. **globalIndex mutation in session-picker render** — must precompute flat indices
6. **Build script change** — `bun build --compile` CLI doesn't support plugins;
   need `Bun.build()` API via build.ts script
7. **Cross-compilation** — verify `Bun.build({ compile: { target: "bun-darwin-arm64" } })` works

## Current State of @opentui/solid API (v0.1.79)

### Exports from @opentui/solid

Functions: `render`, `testRender`, `extend`, `getComponentCatalogue`
Hooks: `useRenderer`, `useKeyboard`, `useTerminalDimensions`, `onResize`,
       `usePaste`, `useSelectionHandler`, `useTimeline`, `useKeyHandler` (deprecated alias)
Components: `Portal`, `Dynamic`, `createDynamic`
Reconciler: `effect`, `memo`, `createComponent`, `createElement`, `createTextNode`,
            `insertNode`, `insert`, `spread`, `setProp`, `mergeProps`, `use`
Context: `RendererContext`

### Component catalogue (JSX intrinsic elements)

`box`, `text`, `input`, `select`, `textarea`, `ascii_font`, `tab_select`,
`scrollbox`, `code`, `diff`, `line_number`, `markdown`, `span`, `strong`,
`b`, `em`, `i`, `u`, `br`, `a`

### Our @opentui/core imports (unchanged by migration)

- `createCliRenderer` — app startup
- `RGBA` — color values (.fromHex(), .fromInts())
- `SyntaxStyle` — syntax highlighting (.fromStyles())
- `TextareaRenderable` — ref type
- `InputRenderable` — ref type
- `ScrollAcceleration` — scroll config type
- `addDefaultParsers` / `getTreeSitterClient` — tree-sitter setup

### Documentation

- Getting started: https://opentui.com/docs/getting-started/
- Solid bindings: https://opentui.com/docs/bindings/solid/
- Components: https://opentui.com/docs/components/
- Core concepts: https://opentui.com/docs/core-concepts/
- GitHub releases: https://github.com/anomalyco/opentui/releases

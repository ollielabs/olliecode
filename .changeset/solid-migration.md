---
"olliecode": minor
---

Migrate TUI rendering layer from React (@opentui/react) to SolidJS (@opentui/solid). All components, hooks, and build infrastructure rewritten for Solid's fine-grained reactivity model. Includes reactive theme switching via store-based ThemeProvider, correct scroll-follow in menus, and fixes for confirmation key leak, Ctrl+E during thinking, and diff preview for multi-line edits.

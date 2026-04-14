---
"olliecode": minor
---

Replaced `isModalOpen` prop threading with a keyboard focus stack system. Modals and overlays now automatically claim keyboard focus via `useFocusLayer()`, preventing key leak bugs between layers. Added `useScopedKeyboard()` as a drop-in replacement for `useKeyboard` that respects focus priority.

---
"olliecode": patch
---

Fix TUI bugs across event isolation, error resilience, scroll behavior, and side panel display.

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

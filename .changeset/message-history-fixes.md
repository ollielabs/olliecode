---
"olliecode": patch
---

Fix message history inconsistencies between in-memory and persisted state.

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

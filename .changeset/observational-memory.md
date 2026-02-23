---
"olliecode": minor
---

Add observational memory: structured observations extracted from tool calls survive compaction and are injected into the system prompt.

- Programmatic extractors for 8 tool types (edit_file, write_file, read_file, run_command, glob, grep, todo_write, task)
- SQLite-backed observation store with session scoping (migration v5)
- Observation block builder with deduplication, section ordering, and 2000-token budget
- Injected into system prompt via SystemPromptContext for both build and plan modes
- 44 tests (unit + integration) covering full extraction-to-prompt pipeline

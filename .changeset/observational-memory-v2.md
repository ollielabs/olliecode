---
"olliecode": minor
---

Replace programmatic observation extraction with Mastra-inspired Observer/Reflector memory system.

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

---
"olliecode": patch
---

Fix token counting accuracy: sidebar now displays real token counts from Ollama's prompt_eval_count instead of a character-based heuristic that overestimated by 33-60%.

- Replace heuristic sidebar estimation with real counts from prompt_eval_count/eval_count
- Parse num_ctx from /api/show parameters to detect operational context limits below the architecture max
- Compute tool schema overhead dynamically instead of using hardcoded constants
- Add debug logging comparing estimated vs real token counts after each model call

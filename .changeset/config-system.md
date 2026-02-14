---
"olliecode": minor
---

Add user-configurable settings with JSON/JSONC config files

- Support global (`~/.config/ollie/config.json`) and project-level (`ollie.json`) config files with JSON and JSONC (comments, trailing commas) support, deep merging, and layer precedence
- Add configurable model, host, temperature, autonomy level, tool permissions, agent settings, compaction, TUI theme, and custom instruction files
- Add `/config` slash command to inspect active configuration sources, resolved values, effective permissions, and validation warnings
- Autonomy levels (paranoid/cautious/balanced/autonomous) control per-tool permission baselines with explicit overrides
- Partial recovery on validation errors: invalid fields fall back to defaults while preserving valid settings
- 83 unit tests covering config parsing, merging, resolution, and source attribution

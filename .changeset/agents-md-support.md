---
"olliecode": minor
---

Add AGENTS.md support and /init command

- Automatically load project instructions from `AGENTS.md` files
  - Global: `~/.config/ollie/AGENTS.md`
  - Project: `./AGENTS.md`
- Inject instructions into system prompts for all modes (build, plan, explore)
- Add `/init` slash command to create or update AGENTS.md
  - Analyzes codebase and generates comprehensive project instructions
  - Supports optional arguments: `/init focus on testing conventions`

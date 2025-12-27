# AGENTS.md

## Build & Run Commands
- `bun install` - Install dependencies
- `bun dev` - Run with hot reload (development)
- No tests or lint configured

## Tech Stack
- **Runtime:** Bun + TypeScript (TSX)
- **Framework:** React 19 + OpenTUI (terminal UI)
- **Backend:** Ollama (local LLM via HTTP streaming)

## Code Style
- **Imports:** Named imports, external packages first, blank line between groups
- **Types:** Use `type` (not `interface`), union types for constrained values
- **Naming:** camelCase functions, PascalCase components/types, UPPER_SNAKE_CASE constants
- **Formatting:** 2-space indent, semicolons, double quotes in JSX, arrow functions

## Error Handling
- Check `res.ok` on fetch, extract error text for messages
- Use try/catch with silent `continue` for JSON parsing in streams
- Track errors via `useState<"idle" | "thinking" | "error">` status pattern

## TypeScript
- Strict mode enabled with `noUncheckedIndexedAccess: true`
- Use `void` prefix for fire-and-forget async: `void sendPrompt(prompt)`
- Prefer type inference; explicit return types optional

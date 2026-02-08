# AGENTS.md

## Build & Run Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install dependencies |
| `bun dev` | Run with hot reload (development) |
| `bun build` | Build native binary for current platform |
| `bun build:darwin-arm64` | Build for Apple Silicon Macs |
| `bun build:darwin-x64` | Build for Intel Macs |
| `bun run src/index.tsx` | Run directly without hot reload |

## Formatting & Linting

| Command | Description |
|---------|-------------|
| `bun format` | Check formatting with Biome |
| `bun format:fix` | Auto-fix formatting issues |
| `bun lint` | Check code with Biome linter |
| `bun lint:fix` | Auto-fix lint issues |
| `bun check:types` | Run TypeScript type checking |

## Code Style

### Imports
- Use named imports: `import { useState } from "react"`
- Group imports: external packages first, then blank line, then local imports
- Example:
  ```typescript
  import { useState, useCallback } from "react";
  import { Box, Text } from "@opentui/react";

  import { agent } from "../agent";
  import type { Message } from "../types";
  ```

### Types
- Use `type` instead of `interface` for type definitions
- Use union types for constrained values: `type Status = "idle" | "thinking" | "error"`
- Prefer type inference; explicit return types are optional

### Naming Conventions
- Functions/variables: `camelCase`
- Components/types: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `kebab-case` for utilities, `PascalCase` for components

### Formatting
- 2-space indentation
- Semicolons at end of statements
- Double quotes in JSX attributes: `<Box value="test" />`
- Single quotes in regular JavaScript: `const msg = "hello"`
- Use arrow functions for components and callbacks
- Biome handles most formatting automatically

### React Compiler
- This project uses React Compiler (babel-plugin-react-compiler)
- Ensure hooks have stable dependencies
- Avoid side effects in render calculations

## Error Handling

- Check `res.ok` on fetch responses; extract error text for user messages
- Use try/catch with silent `continue` for JSON parsing in streams
- Track error states via `useState<"idle" | "thinking" | "error">` pattern
- Example:
  ```typescript
  const [status, setStatus] = useState<"idle" | "thinking" | "error">("idle");

  try {
    const res = await fetch("/api/chat", { method: "POST", body: JSON.stringify({ prompt }) });
    if (!res.ok) {
      const error = await res.text();
      setStatus("error");
      return error;
    }
    // handle stream...
  } catch {
    setStatus("error");
  }
  ```

## TypeScript

- Strict mode enabled with `noUncheckedIndexedAccess: true`
- Use `void` prefix for fire-and-forget async: `void sendPrompt(prompt)`
- No unused locals/parameters warnings (disabled in tsconfig)
- Use `zod` for runtime validation of external data

## Communication Style

- Be concise, direct, and to the point
- No unnecessary preamble ("I'll help you with that...")
- No unnecessary postamble ("Let me know if you need anything else...")
- Match response detail to query complexity
- Use markdown formatting for clarity

## Scope Discipline

- Do what is asked, nothing more
- Do NOT improve, refactor, or modify unrelated code
- Do NOT add features unless explicitly requested
- Ask for clarification when requests are ambiguous

## Code Review Process

Use internal agents for code review instead of GitHub Copilot reviews.

### Pre-push review (required)
Before pushing a feature branch, run the `code-reviewer` agent against the diff. Fix any real issues it finds before pushing. This catches bugs, style violations, and logic errors while the context is fresh.

### Post-PR review (recommended for significant changes)
After creating the PR, run the `architect-reviewer` agent against the full branch diff. This catches design-level concerns: does the change fit the system architecture, are there integration risks, does it match the design doc.

### Triage rules
- Fix correctness issues (bugs, security, logic errors) immediately
- Fix style/consistency issues if they're quick
- Dismiss low-value suggestions (cosmetic, over-engineering) with a brief rationale
- Never chase infinite review loops — two review passes maximum, then merge

### Do NOT use GitHub Copilot pull request reviews
Copilot reviews are stateless, cannot be reasoned with, and produce infinite loops of diminishing-value feedback. We tried it; it doesn't work for our workflow.

## Code Quality

- Generated code must be immediately runnable
- Always completely implement code - no placeholder comments
- Add necessary imports and dependencies
- Respect existing patterns and conventions in the codebase
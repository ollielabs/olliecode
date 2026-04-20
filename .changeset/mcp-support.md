---
"olliecode": minor
---

Added MCP (Model Context Protocol) support for external tool integration. Connect local (stdio) and remote (Streamable HTTP + SSE) MCP servers via the `mcp` config field. Includes automatic tool discovery with pagination, real JSON Schema validation via `fromJSONSchema()`, three-tier safety permissions (global autoApprove, per-server autoApprove, tool annotations), auto-reconnect with exponential backoff, server stderr capture, AbortSignal forwarding, and TUI integration with status bar display, `/mcp` command modal, and toast notifications. MCP tools are registered directly into the tools array and available in both Plan (read-only tools) and Build (all tools) modes.

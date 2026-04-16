---
"olliecode": minor
---

Added `web_fetch` tool for fetching and converting web content. Supports markdown (default), text, and HTML output formats. Uses TurndownService for HTML-to-Markdown conversion and Bun's HTMLRewriter for plain text extraction. Includes content negotiation, Cloudflare bypass, configurable timeout and response size limits. Available in both Plan and Build modes.

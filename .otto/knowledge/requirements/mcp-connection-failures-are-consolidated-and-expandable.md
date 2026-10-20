---
id: "mcp-connection-failures-are-consolidated-and-expandable"
kind: "requirement"
title: "MCP connection failures are consolidated and expandable"
status: "proposed"
tags: ["mcp","chat","diagnostics","ux","timeline"]
created_at: "2026-08-25T23:21:50.512Z"
updated_at: "2026-08-25T23:21:50.512Z"
---
# MCP connection failures are consolidated and expandable

<!-- compiled_truth -->

When configured MCP servers fail at chat start, Otto must report one compact, non-fatal timeline warning with the number of unavailable connections. The exact per-server diagnostic remains available through the warning’s Details disclosure and must survive timeline persistence. It must not emit one full raw error row per failed server.

## Timeline

- time: "2026-08-25T23:21:50.512Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-25T23:21:50.512Z"
  kind: "evidence"
  summary: "User request and screenshot, 2026-08-25. Implemented in `packages/server/src/server/agent/providers/openai-compat-agent.ts`, with optional timeline error details wired through protocol, app stream state, replica cache, and `ActivityLog`. Focused protocol/provider/app tests, app and server typechecks, targeted lint, formatting, and git diff --check passed."

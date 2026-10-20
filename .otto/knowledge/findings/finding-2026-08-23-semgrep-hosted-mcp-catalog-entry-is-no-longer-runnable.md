---
id: "finding-2026-08-23-semgrep-hosted-mcp-catalog-entry-is-no-longer-runnable"
kind: "finding"
title: "Semgrep hosted MCP catalog entry is no longer runnable"
status: "proposed"
tags: ["connectors","semgrep","catalog","tooling"]
created_at: "2026-08-24T05:17:59.865Z"
updated_at: "2026-08-24T05:17:59.865Z"
---
# Semgrep hosted MCP catalog entry is no longer runnable

<!-- compiled_truth -->

The Semgrep catalog entry that advertised an unauthenticated remote MCP server is no longer runnable. On 2026-08-23, Otto's actual MCP SDK received `401 {"error":"invalid_token","error_description":"Authentication required"}` from `POST https://mcp.semgrep.ai/mcp`; the legacy `https://mcp.semgrep.ai/sse` endpoint returned 404. Semgrep's archived MCP repository now directs clients to the local `semgrep mcp` command from the main Semgrep CLI. Local scanning remains account-free, but Otto currently has no managed Semgrep CLI installation/detection flow, so it cannot honestly offer that command as a zero-setup catalog connector. The broken remote entry was removed. Reintroducing Semgrep requires a product decision and implementation for managed local-tool provisioning or an explicit prerequisite experience.

## Timeline

- time: "2026-08-24T05:17:59.865Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["connectors"]
- time: "2026-08-24T05:17:59.865Z"
  kind: "evidence"
  summary: "Reproduced with `@modelcontextprotocol/sdk` v1.30.0, the same StreamableHTTPClientTransport used by Otto, from packages/server on 2026-08-23. Semgrep's archived repository README states that its MCP server moved to the main `semgrep` repository and is now invoked as `semgrep mcp`; direct source: https://github.com/semgrep/mcp/blob/main/README.md and current source: https://github.com/semgrep/semgrep/tree/develop/cli/src/semgrep/mcp. Targeted catalog test passed (92 tests), plus lint and app typecheck."

---
id: "agent-providers-use-shared-lifecycle-contracts-with-acp-and-direct-integration"
kind: "architecture"
title: "Agent providers use shared lifecycle contracts with ACP and direct integration paths"
status: "superseded"
tags: ["architecture", "providers", "acp", "mcp", "agent-tools"]
created_at: "2026-08-08T03:27:31.136Z"
updated_at: "2026-08-08T05:16:38.752Z"
---

# Agent providers use shared lifecycle contracts with ACP and direct integration paths

<!-- compiled_truth -->

Otto supports multiple agent providers through provider adapters. ACP is the recommended integration path using the shared ACPAgentClient, while direct providers implement AgentClient and AgentSession contracts when they need full control. Otto tools live in a shared daemon-owned catalog, with MCP as an adapter rather than the internal implementation.

## Timeline

- time: "2026-08-08T03:27:31.136Z"
  kind: "created"
  summary: "Knowledge page created."
- time: "2026-08-08T05:06:24.112Z"
  kind: "evidence"
  summary: "docs/providers.md documents ACP and direct integration patterns, existing provider adapters, and the shared Otto tool catalog under packages/server/src/server/agent/tools/. README.md identifies Claude Code, Codex, Copilot, OpenCode, and Pi as supported agent systems."
  source: "Legacy Markdown evidence section"
- time: "2026-08-08T05:06:24.112Z"
  kind: "migration"
  summary: "Migrated from legacy page id ddc90a30-fe81-4580-8a16-a0327b901487 to agent-providers-use-shared-lifecycle-contracts-with-acp-and-direct-integration-p."
- time: "2026-08-08T05:14:18.311Z"
  kind: "migration"
  summary: "Migrated from legacy page id agent-providers-use-shared-lifecycle-contracts-with-acp-and-direct-integration-p to agent-providers-use-shared-lifecycle-contracts-with-acp-and-direct-integration."
- time: "2026-08-08T05:16:38.752Z"
  kind: "reversal"
  summary: "Onboarding review found this claim is already canonical in repository documentation or agent instructions and is straightforward to reconstruct; the project map links that source instead of injecting a duplicate atomic page. New status: superseded."

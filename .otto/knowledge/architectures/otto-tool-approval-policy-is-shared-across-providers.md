---
id: "otto-tool-approval-policy-is-shared-across-providers"
kind: "architecture"
title: "Otto tool approval policy is shared across providers"
status: "proposed"
tags: ["providers","permissions","mcp"]
created_at: "2026-09-12T16:11:45.287Z"
updated_at: "2026-09-12T16:11:45.287Z"
---
# Otto tool approval policy is shared across providers

<!-- compiled_truth -->

Otto separates tool availability from approval. A shared tool classification supplies daemon-owned permission decisions, MCP read-only annotations, and exact internal Otto read grants in provider adapters that support them. The selected permission mode must survive launch, resume, and legacy option overlays; explicit tool restrictions remain independent. Auto review, Don't Ask, and unrestricted bypass are different behaviors and must not be presented as equivalent. Native runtimes without a portable exact-tool preapproval API retain that limitation; metadata alone is not proof of prompt-free execution. The provider matrix and durable contract are documented in docs/providers.md.

## Timeline

- time: "2026-09-12T16:11:45.287Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["orchestration-agent-binding-and-provider-coverage"]
- time: "2026-09-12T16:11:45.287Z"
  kind: "evidence"
  summary: "Source and adapter audit on 2026-09-12. Added internal read grants for Claude, Codex, and OpenCode; shared classification now includes list_workspaces and Knowledge reads for compatible/Brain tool loops. Corrected Codex and Claude mode precedence and OpenCode Auto Accept reported/runtime mismatch with explicit policies. Targeted validation: Codex 165 tests, Claude workspace access 12, OpenCode Full Access 14, shared classification 12, runtime MCP config 4, MCP annotation 1, compatible tool gating 17, ACP permission/mode cases 10, Pi mode/question cases 2, OMP launch case 1; server typecheck, targeted lint, and diff whitespace checks passed. These are source/adapter tests, not live or installed-provider proof. No installed daemon restart or release was performed."

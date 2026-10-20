---
slug: "flow"
title: "Flow"
role: "key flows"
updated: "2026-08-08T05:16:40.493Z"
---

# Flow

## Typical agent task

```mermaid
sequenceDiagram
  participant U as User
  participant C as Otto client
  participant D as Daemon
  participant K as Project knowledge
  participant P as Provider session
  participant T as Otto tools
  participant R as Repository / services

  U->>C: Send task in a workspace
  C->>D: WebSocket request
  D->>K: Resolve project root and active catalog
  K-->>D: Six roots + confirmed page links
  D->>P: Start or resume with runtime-only catalog
  P->>K: Read relevant rich pages on demand
  P->>T: Invoke provider-neutral tools
  T->>R: Inspect or mutate within daemon guardrails
  R-->>T: Evidence and results
  T-->>P: Structured tool result
  P-->>D: Stream events, usage, final result
  D-->>C: Timeline and workspace updates
  C-->>U: Observable result
  P->>K: Propose newly established durable knowledge
```

## Important variants

- Remote clients traverse the optional encrypted relay; daemon semantics stay the same.
- Providers with native Otto tools consume the shared catalog directly. MCP-only providers receive the catalog through the daemon adapter, without a second implementation.
- Preview starts the repository's configured dev server, binds an Otto browser tab, and verifies the rendered result through daemon-enforced browser tools.
- Worktree workspaces resolve shared project knowledge to the repository project root, so branches do not fork project truth.

Sources: [architecture](../../docs/architecture.md), [chat lifecycle](../../docs/chat-lifecycle.md), [providers](../../docs/providers.md), [preview](../../docs/preview.md), and [[project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto]].

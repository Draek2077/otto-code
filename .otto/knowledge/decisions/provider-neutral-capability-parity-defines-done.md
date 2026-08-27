---
id: "provider-neutral-capability-parity-defines-done"
kind: "decision"
title: "Provider-neutral capability parity defines done"
status: "confirmed"
tags: ["mission","provider-neutral","architecture","capability-parity"]
created_at: "2026-08-08T05:16:39.765Z"
updated_at: "2026-08-27T17:59:14.349Z"
---
# Provider-neutral capability parity defines done

<!-- compiled_truth -->

A frontier-harness capability is complete only when Otto exposes it through provider-neutral contracts to hosted and local providers alike. A single-provider implementation is the proof, not the finish line.

This applies to browser-verified previews, artifacts, subagent visibility, context management, permissions, MCP, project knowledge, and future agentic tooling. Provider-specific mechanics may differ, but the user-facing capability and daemon-owned guardrails must not depend on which model provider is selected.

## Timeline

- time: "2026-08-08T05:16:39.765Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T05:16:39.765Z"
  kind: "evidence"
  summary: "AGENTS.md states the fork mission and completion criterion. README.md and docs/product.md define multi-provider freedom as a core product philosophy. The user reaffirmed that Knowledge must function as a real cross-provider project memory system rather than a provider-specific imitation."
- time: "2026-08-08T05:16:39.946Z"
  kind: "note"
  summary: "This is the product owner's explicit founding criterion in AGENTS.md and the stated scope of the current Knowledge work. New status: confirmed."
- time: "2026-08-27T17:59:14.349Z"
  kind: "evidence"
  summary: "Git-hosting review discussions now use provider-neutral thread-resolution and comment-reaction RPCs. GitHub supplies GraphQL thread and reaction mutations; Bitbucket Cloud supplies native reply-thread grouping and resolve/reopen operations. Bitbucket Cloud advertises comment reactions as unsupported because its documented Cloud API has no such endpoint. Evidence: `packages/server/src/services/{forge-service,github-service}.ts`, `packages/server/src/services/git-hosting/bitbucket-cloud-service.ts`, `docs/git-providers.md`; focused protocol, GitHub, Bitbucket, and PR-timeline suites pass along with targeted lint and server/app typechecks."
  source: "Verified implementation, 2026-08-27"
  affects: ["provider-neutral-capability-parity-defines-done"]

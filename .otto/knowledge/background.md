---
slug: "background"
title: "Background"
role: "project background"
updated: "2026-08-08T06:37:07.536Z"
---

# Background

## Why Otto exists

Otto is a self-hosted, cross-device environment for running and understanding autonomous coding agents. It grew from Paseo into a fork focused on making agent work legible: what ran, what changed, what it cost, and how the result was verified.

The governing product decision is [[provider-neutral-capability-parity-defines-done]]. The user should be able to choose a hosted frontier model, a provider CLI, or a local OpenAI-compatible model without losing Otto's IDE-grade tools.

## Goals

- One interface across desktop, mobile, web, and CLI.
- Daemon-owned orchestration that keeps agents running independently of any client.
- Observable work: timelines, subagents, token and cost accounting, diffs, artifacts, and browser-verified previews.
- User ownership: self-hosted code, credentials, project state, and no required Otto cloud account.
- Repository-owned durable project memory through [[project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto]].

## Non-goals

- Becoming an inference provider or adding markup to model pricing.
- Locking core tooling to one model vendor.
- Creating a competing project ledger, reference bibliography, or knowledge store outside Otto Knowledge.

## Canonical sources

- [Product definition](../../docs/product.md)
- [Repository mission and agent rules](../../AGENTS.md)
- [Project knowledge contract](../../docs/project-knowledge.md)
- Confirmed project and reference pages in this Knowledge store

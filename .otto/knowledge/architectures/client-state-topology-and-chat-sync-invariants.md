---
id: "client-state-topology-and-chat-sync-invariants"
kind: "architecture"
title: "Client state topology and chat-sync invariants"
status: "confirmed"
tags: ["client-state", "chat-sync", "react-query", "reducer", "invariants", "archdocs-retirement"]
created_at: "2026-08-16T13:51:30.309Z"
updated_at: "2026-08-20T23:38:02.000Z"
---

# Client state topology and chat-sync invariants

<!-- compiled_truth -->

These are the audit invariants the retired archdocs engineering guide (§1 chat synchronization, §3 UI performance) carried and which live nowhere else in `docs/`. `docs/timeline-sync.md` owns the delivery paths and `docs/client-performance.md` owns the measurement instrument; this record is the state-ownership and sync-decision layer that sits between them.

Chat synchronization — the sync loop (provider adapter → AgentManager + timeline store → Session WS → stream reducer cursor → chat surface). Live streams exist for immediacy only; `fetch_agent_timeline` is authoritative and catch-up pages to completion (a partial catch-up is a bug, not a degraded mode). Every inbound unit maps to exactly one cursor outcome: accept, drop_stale (duplicate — seq ≤ cursor end), drop_epoch (old generation — epoch mismatch), or gap (detected → paged fetch to completion). There is no fifth path. Invariants: the timeline is append-only and a new run starts a new epoch, never rewrites one; `seq` is monotonic within an epoch and the daemon assigns it, clients never invent it; row timestamps are daemon-owned canon, clients never trust local clocks for ordering or display gating; optimistic client rows (the user's own message) must be reconciled against the authoritative fetch, never double-shown.

State topology — the frontend is split so each fact has exactly one writer: DaemonClient → HostRuntimeController (connection lifecycle) → SessionContext → reducer queue (48 ms batched flush) → session-store (Zustand, the domain core) → the virtualized chat surface; and DaemonClient → push-router → React Query cache (the push-fed replica) → the git/terminal/file panes. Invariants: server data flows through the enforced two-class `serverDataPolicy` contract in `app/src/data/query.ts` — class `replica` (a named `pushEvent` is mandatory, `refetchOnMount: false`, all refetch triggers off; data changes arrive only via push-router writes or explicit invalidation such as reconnect) and class `fetch` (a finite `staleTimeMs` is mandatory and `refetchOnMount: "always"` is set by the helper, deliberately). The violation is bypassing the two helpers or hand-rolling refetch options on a query — not `refetchOnMount` itself, which is the fetch class's contract. Stream units batch through the 48 ms reducer flush; nothing writes stream state to a store per-event. The web chat list virtualizes past ~100 items (~50 recent mounted, estimated heights); the bottom-anchor controller owns scroll position and features must not fight it with their own `scrollTo` (see `docs/chat-scrolling.md`). Writers are exclusive: push-router owns query-cache facts, the reducer queue owns stream facts, stores own UI facts — a fact with two writers is a race by design.

Audit method (kept from the guide): auditing a "chat is weird" report — identify which invariant would have to be false, then instrument that decision point: duplicates ⇒ monotonicity / single-outcome, missing rows ⇒ authoritative catch-up, interleaved old runs ⇒ epoch handling, ghost user messages ⇒ optimistic reconciliation. Auditing jank — walk the state topology left to right: is the daemon coalescing (terminal doc)? is the reducer batching? is the list virtualizing? is a component over-rendering (React DevTools on the memo boundaries)? Each stage has a budget, so the walk terminates at the guilty one. Hot paths (`message.tsx`, the diff pane, the workspace screen) are memoized monoliths — measure before touching, and prefer moving code out over adding branches in.

## Timeline

- time: "2026-08-16T13:51:30.309Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["the-monorepo-separates-daemon-protocol-client-app-desktop-cli-and-supporting"]
- time: "2026-08-16T13:51:30.309Z"
  kind: "evidence"
  summary: "Ported from the retired archdocs page 06-engineering-guide §1 (chat sync) and §3 (UI performance). This content is not in docs/timeline-sync.md (delivery paths), docs/client-performance.md (measurement), or docs/chat-scrolling.md (scroll ownership) — those are the deeper sources for their own slices; this record is the state-ownership and sync-decision layer. Where this and the code disagree, code wins."

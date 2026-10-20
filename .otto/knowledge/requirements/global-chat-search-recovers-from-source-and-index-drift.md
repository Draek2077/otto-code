---
id: "global-chat-search-recovers-from-source-and-index-drift"
kind: "requirement"
title: "Global chat search recovers from source and index drift"
status: "proposed"
tags: ["search","chats","reliability","architecture"]
created_at: "2026-09-25T05:16:37.853Z"
updated_at: "2026-09-25T14:01:34.991Z"
---
# Global chat search recovers from source and index drift

<!-- compiled_truth -->

Global Search is the user-facing entry point for searching chat contents across projects. The user explicitly requires automatic recovery after chat changes and adherence to Otto's daemon, provider, store, protocol, and client ownership boundaries. Explorer Search remains scoped to its existing workspace responsibility.

## Delivery requirement

Every eligible persisted chat in the selected host/project/workspace and archive scope must be accounted for, including closed, archived, imported, and never-opened chats. Every matching retained user or assistant message must become searchable automatically when its durable source is available. A missed live event, daemon crash, interrupted import, failed indexing job, or damaged derived index must not permanently remove chat coverage. Explicitly deleted chats must remain absent.

This is a requirement and proposed implementation contract, not a claim that chat-content search or recovery has shipped. Defaults for archive filters and exact scheduling intervals remain product/implementation choices.

## Architecture and source authority

- The daemon owns one chat-search service per host. Clients use the shared protocol/client layer and render results, scope, and coverage in Global Search.
- Reuse provider-neutral normalized timeline ingestion and the existing AgentTimelineStore boundary. Provider-specific historical access belongs behind provider adapters.
- Chat identity and ownership come from existing registries. Resolve project through workspace ownership; never infer ownership from cwd. Internal retained generation runs and observed subagents retain their existing visibility/owner boundaries.
- The search index is derived, rebuildable data. It must never become the only surviving copy of conversation text.
- Before claiming complete recovery, establish durable normalized conversation retention or an equally complete, independently rebuildable source for every supported provider. Current provider history remains the documented authority until an explicitly implemented and documented retention contract changes that boundary.
- Store APIs own transactions, serialization, uniqueness, and atomic replacement. Do not scatter raw file/database coordination across UI, session handlers, or providers. JSON persistence plus a separate index must not be described as one transaction without a recoverable compound-commit protocol.
- New RPCs use Otto's dotted namespaces and backward-compatible schemas with a centralized server capability gate.

## Recovery contract

1. Persist source revision/generation and indexing completion separately. A chat is current only when the indexed revision covers the committed source revision. Appends alone are insufficient: metadata changes, in-place message updates, rewind, replacement, and deletion also advance the relevant revision.
2. Commit durable source state and recoverable indexing intent together, or make all outstanding work derivable from authoritative source revisions. A volatile queue or a logged write failure is insufficient. Advance the indexing checkpoint only with a successful index transaction.
3. Make jobs repeatable without duplicate rows. Guard commits against stale source generations. Late imports, old hydration, and retried jobs cannot overwrite a newer timeline or resurrect deleted content.
4. Index new/imported messages automatically. Batch streaming updates without losing partial output after cancellation, failure, or restart. Preserve exact completeness bookkeeping while rebuilding or catching up.
5. Rename/move updates scope and metadata; archive retains content according to the archive filter; hard deletion removes all search content and cancels/invalidate outstanding work. Rewind/history replacement publishes one coherent new generation.
6. Reconcile the authoritative registry and source manifests on startup and in a bounded periodic background sweep. Events/watchers accelerate updates but are not the correctness mechanism. Detect missing/stale rows, incomplete jobs, and index orphans. Unavailable storage or a failed enumeration is not proof of deletion.
7. Resume unfinished work after restart with bounded retries/backoff and fair scheduling. Repair an affected chat first; rebuild the full derived index automatically when missing, corrupt, or incompatible. Validate replacement generations and catch up concurrent changes before publishing them.
8. Resolve search hits against the current chat generation and timeline. Existing epoch/sequence anchors must be validated after restart or replacement; stable source identity belongs at the daemon boundary. Never navigate a stale sequence to an unrelated message.
9. Account separately for indexed, pending, failed, and unavailable coverage. Keep existing metadata search usable, but never represent it as successful body matching. Incomplete body coverage must be visible with automatic retry; do not claim a complete no-match result.
10. Keep indexing and database operations off the daemon's main event loop with bounded memory, queue pressure, concurrency, result pages, and resource budgets. Idle chats require no repeated full transcript scan.

## Historical coverage and acceptance

Lazy indexing when a chat opens can assist migration but does not satisfy all-chat coverage. Backfill must enumerate all eligible chats and read their durable history through a supported adapter contract, without prompting models or starting every agent as a side effect. Where original history is inaccessible, report the specific coverage boundary and retry when access returns; recovery cannot recreate source content that no longer exists.

Acceptance must prove:
- new, imported, closed, archived, and never-opened eligible chats are searchable after initial indexing and daemon restart;
- dropped notifications and source changes made while the daemon is stopped are detected automatically;
- interruption between source commit and index commit resumes without loss or duplicates;
- edits, rename, cross-project move, and timeline replacement update hits and navigation;
- delete or rewind racing a queued/retried job cannot restore removed content;
- missing/corrupt derived index rebuilds from independent durable data;
- source read failures are distinguished from deletions and incomplete results remain honest;
- matched-message navigation survives restart and handles a superseded match correctly;
- large backfills and concurrent queries meet measured daemon responsiveness and memory budgets.

Sequence the work as durable source and revision contract, indexing/reconciliation, shared RPC and Global Search UI, then recovery and provider-coverage verification. Prior synthetic FTS size/timing measurements cover the search database only and do not establish the cost of retaining full normalized timelines.

## Timeline

- time: "2026-09-25T05:16:37.853Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-25T05:16:37.853Z"
  kind: "evidence"
  summary: "User in this conversation explicitly selected Global Search as the UI for chat-content search, retaining the proposed indexing mechanism, and requested a self-healing system that recovers from chat changes and uses proper Otto architecture. Verified 2026-09-24: docs/architecture.md and docs/timeline-sync.md state provider history is durable authority and daemon canonical rows are runtime memory; docs/data-model.md Store Surface Rules assign atomicity to stores. packages/server/src/server/bootstrap.ts constructs RetainedTranscriptStore for internal retained runs but does not pass durableTimelineStore to AgentManager. agent-timeline-store-types.ts exposes the provider-neutral durable store interface; AgentManager's enqueueDurableTimelineAppend/Update/BulkInsert currently log caught persistence failures rather than providing a persistent repair queue. retained-transcript-store.ts defines artifact/schedule owners, not general chat retention. Existing epoch/sequence anchors require current-epoch validation. No product implementation or runtime recovery proof is claimed."
- time: "2026-09-25T06:50:53.469Z"
  kind: "evidence"
  summary: "Implemented in the working tree, not released. The user's latest instruction keeps Global Search's existing input and compact result-list presentation, without an All/Files/Chats or project-scope toolbar. Message results search across connected hosts and projects, including archived chats, and resolve current epoch/sequence anchors before navigation. Existing filename/workspace/action search is preserved. Development UI inspection confirmed message excerpts alongside Files results; the existing command-center-workspaces.spec.ts cross-project click-through case passed (34.2 seconds, isolated run .tmp/ci-diagnostic-wOGkqs). Targeted service tests (11), message projection tests (2), Pi history tests (4), native JSONL validation tests (5), navigation tests (3), multi-host/capability UI tests (3), and the targeted existing client-history correlation test passed. App/server typechecks, protocol/client generation and builds, server build, changed-file lint, and E2E coverage registration passed. Repository preflight remains blocked by the untouched existing otto-tools.ts module ceiling (6500 versus 6454); changed registry modules are within their ceilings. Physical-device native scrolling and exhaustive live-provider historical coverage were not verified.\n\nThe daemon owns a worker-thread SQLite FTS5 index and atomic checksummed normalized message-source snapshots under OTTO_HOME/chat-search. Source commits precede index transactions, and stable message keys permit incremental SQL updates. Live captures coalesce for one second; registry/source reconciliation runs at startup and after 30-second intervals, with sequential provider backfill, revision checks, 15-minute full verification age, 60-second retry/read deadlines, generation guards, and deletion tombstones. Missing/corrupt/incompatible derived indexes rebuild from retained sources; source loss/corruption and stale-job races are covered by targeted tests. JSON source persistence still replaces one whole chat snapshot. No embeddings, model prompts, or paid indexing service are involved. Offline readers exist for Claude, Codex, OpenAI-compatible/Brain, OpenCode, Pi, and OMP; other adapters retain live-captured messages and report unavailable historical coverage when no reader/source exists. Recovery cannot recreate inaccessible or deleted original text.\n\nBounded synthetic Windows measurement against the compiled production worker: 300 chats, 30 alternating user/assistant messages each (9000 total), repeated engineering prose, 3,845,700 UTF-8 text bytes. Initial backfill 2707 ms. After checkpoint/close, normalized sources 5,743,014 bytes and SQLite index 6,598,656 bytes (approximately 12.34 MB combined). Twenty alternating common two-token and no-match queries included full registry/source reconciliation: median 68.9 ms, sample p95 83.3 ms. Appending one message to a 30-message chat took 7.0 ms. Main-process event-loop-delay p99 was 22.4 ms with 10 ms sampling resolution. Temporary synthetic data was removed. This is not a production capacity/memory benchmark, and repeated vocabulary understates diverse-corpus token overhead."
  source: "This implementation; docs/chat-search.md; packages/server/src/server/chat-search; packages/app/src/command-center/chat-search.ts"
- time: "2026-09-25T14:01:34.991Z"
  kind: "evidence"
  summary: "Global Search message rows reuse normal search padding and typography, a host-scoped provider icon, and History's shared trailing Archived pill. Titles ellipsize before the pill; the preview precedes muted project/author/date details. Archived selection uses History's refresh operation before resolving the current message anchor, because restoration can change the timeline epoch. The mock provider intentionally resumes with empty history, so the browser regression verifies visible stale-match feedback, then successful navigation of a new live message across projects. The targeted browser case passed at desktop and 520px widths (23.4 seconds; isolated .tmp/ci-diagnostic-ANXXeS), including padding equality, icon/title/pill alignment, truncation, metadata order, and matched-message navigation. Six targeted hook tests cover host coverage, presentation metadata, restore ordering and failed restoration. App/server typechecks, changed-file lint, formatting, and E2E coverage registration passed. No routing change was required; the earlier Workspace unavailable screenshot was produced after test cleanup removed its fixture projects. Physical-device navigation and exhaustive real-provider archived-history coverage remain unverified. The unrelated existing otto-tools.ts size ceiling remains exceeded (6500 versus 6454)."
  source: "User's global-search UI requirements; docs/chat-search.md; command-center-workspaces.spec.ts; command-center/chat-search.test.tsx"

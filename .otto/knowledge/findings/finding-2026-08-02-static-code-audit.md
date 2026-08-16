---
id: "finding-2026-08-02-static-code-audit"
kind: "finding"
title: "Performance and efficiency audit: where Otto burns CPU, memory, and tokens a user feels"
status: "confirmed"
tags: ["finding", "performance-efficiency-audit"]
created_at: "2026-08-16T22:16:11.495Z"
updated_at: "2026-08-16T22:16:11.495Z"
---

# Performance and efficiency audit: where Otto burns CPU, memory, and tokens a user feels

<!-- compiled_truth -->

**Date:** 2026-08-02
**Question:** Across chat streaming, editor/diff, app render architecture, daemon hot paths,
provider streaming, wire/token weight, git polling, and long-session memory: what does Otto spend
that a person actually feels, and which of it is avoidable?
**Environment:** repo at `main` 29e38af6b with the working tree as of this date; Windows 11 daemon
assumptions (process spawn 30-80 ms, Defender scanning each spawn).
**Method:** static code tracing by seven parallel read passes, one per area. No runtime
measurements were taken in this pass; every claim below is tagged **traced** (the call path was
followed in code, with file:line evidence) or **inferred** (magnitude or frequency derived from the
traced structure). Token figures are chars/4 estimates. Three headline claims (F1's missing cap, F2's
per-tick cache key, F3's unfiltered watcher callback) were independently re-verified against the
source before publication. The
[measure-before-you-fix section](#measure-before-you-fix) names the single measurement that settles
each inferred figure; treat those as the follow-up runs this file expects beside it.

Prior work honored: the three 2026-07-25 the client-performance findings reports
retired timer leaks, cache growth, message-decode cost, workspace-tree retention, and navigation
refetch by measurement; none are re-litigated here. Note their soak census walked exactly ten
stores (`diagnostics/resource-report/collect-resource-metrics.ts:47-58`), so the retention findings
below were invisible to those runs, not cleared by them. Deliberate tradeoffs documented in
`docs/token-economy.md`, `docs/chat-scrolling.md`, `docs/preview.md`, and `docs/changes-view.md`
are excluded as findings.

---

## The five findings that matter most

### F1 - REGRESSION: the Otto tool-result cap was deleted by the v0.2.5 merge (traced, verified)

Commit `3b4578e68` ("honest usage accounting") added two protections to the MCP-path tool-result
serializer: a 26,000-head + 4,000-tail char truncation on every model-visible Otto tool result, and
compact `JSON.stringify` (its comment: "2-space indentation was pure token inflation replayed every
round"). The Paseo v0.2.5 merge (`5e3cc1def`) factored the serializer into a new file and **both
protections vanished**:

- `packages/server/src/server/agent/tools/otto-tool-serialization.ts:24,46` pretty-prints with
  `JSON.stringify(structuredContent, null, 2)` and contains no truncation.
- `packages/server/src/server/agent/mcp-server.ts:17-22` still carries the orphaned comment
  claiming "Hard cap on the model-visible text... Matches the MCP builtin cap (~30K)". The
  `toMcpToolResult` below it caps nothing.

Blast radius: every provider consuming Otto tools through `/mcp/agents` (Claude, Codex, OpenCode,
Copilot, ACP; `bootstrap.ts:1923`) and the OMP host-tool path. openai-compat is unaffected: it
kept its own private copy of the cap (`openai-compat-agent.ts:128-129`, compact at 1443).

Pretty-print alone inflates array-of-object results an estimated 35-55% (one default `list_agents`
call ≈ +3K tokens, resident in context for the rest of the session). The missing cap is what turns
F2-F5 below from "bounded at ~30K chars" into "unbounded".

**Fix:** restore `truncateHeadTail(26_000, 4_000)` + compact stringify in
`otto-tool-serialization.ts`. The code exists verbatim at
`git show 3b4578e68:packages/server/src/server/agent/mcp-server.ts`. ~20 lines, fork-original file,
**zero upstream merge cost**. This is the single highest value-per-line change in the audit.

### F2 - Streaming code fences re-tokenize the whole fence up to ~30x/sec on the UI thread (traced)

An open fence cannot be block-promoted (`split-markdown-blocks.ts:40-49`), so the live tail block
is the entire fence-so-far. Every 32 ms reveal tick produces a new string, and
`tokenizeToLines` caches by `` `${ext}:${code}` `` (`packages/app/src/utils/highlight-cache.ts:53`,
verified), so every tick is a cache miss running a full synchronous Lezer pass over the whole fence
(`highlighted-code-block.tsx:82-85`), plus `detectLanguage` per tick for untagged fences, plus LRU
pollution with stale prefixes. Total work per streamed fence is quadratic in fence length; the
100 KB per-call cap bounds one call, not the 30/sec repetition. This is the most likely cause of
dropped frames while a model streams code, which is the product's core workload.

**Fix (contract-safe, does not touch scroll logic):** debounce the `code` prop handed to
`HighlightedCodeBlock` to ~250 ms while the fence is still growing, exactly the pattern Mermaid
already uses (`MERMAID_RENDER_DEBOUNCE_MS`). Landing it in fork-original
`packages/app/src/components/markdown/fence.tsx` keeps upstream-shared `highlight-cache.ts` and
`highlighted-code-block.tsx` untouched. Alternative with the same home: tokenize only complete
lines and cache per line.

### F3 - The Windows/macOS working-tree watcher has no ignore filter; build churn drives full git+highlight recomputes (traced, verified)

`workspace-git-service.ts:1606-1609` registers the recursive repo-root watch with a callback that
discards `filename` entirely. The gitignored-dirs filter exists but is wired only into the Linux
per-directory path (`:1755-1786`). So on Windows, `node_modules`/`dist` churn during an
`npm install` or build fires the pipeline continuously: each 150 ms-debounced quiet gap forces a
snapshot refresh (~20-25 git spawns, bypassing the 2 s min-gap because it is forced) **plus** a
force-recomputed structured+highlighted diff, including one `git diff --no-index` spawn per
untracked file. Sustained churn offers ~25-40 spawns/sec against the global 8-slot git limiter, so
every other git operation queues behind it: the fan-spin-plus-laggy-daemon case (inferred
magnitude, traced path).

Compounding (traced): the diff pipeline re-reads and re-highlights the **full content of every
changed file** per refresh (`checkout-git.ts:2713-2730`, `diff-highlighter.ts:251-331`; the 1 MB
cap bounds diff text, not file content, so a one-line edit to this repo's own 1.5 MB
`package-lock.json` re-parses ~3 MB through Lezer on the daemon main thread per refresh), and
change detection runs **after** the expensive work: the fingerprint is `JSON.stringify` of the
fully tokenized snapshot (`checkout-diff-manager.ts:253`), so a no-op wakeup still pays everything
except the push.

**Fixes, in leverage order:** (a) hash the raw diff text before structuring/highlighting and bail
on match: converts every spurious wakeup into one git spawn plus one hash (quick win; could live in
`WorkspaceGitService.getCheckoutDiff` caching); (b) filter recursive-watch callbacks against the
ignore set the Linux path already computes (additive callback change, low conflict risk);
(c) size-gate the full-file highlight path, falling back to the existing `highlightDiffFromHunks`
above ~256 KB (quick).

### F4 - Streaming tool-input snapshots are quadratic in CPU, wire, and retained memory (traced path, inferred flush counts)

For a large streamed `Write`/`Edit`, the Claude provider re-runs `parsePartialJsonObject` (a
char-by-char parser) over the **full accumulated** argument buffer on every `input_json_delta`
(`claude/agent.ts:6710-6745`), and each ~60 ms coalescer flush **appends a new full-content
snapshot row** to the in-memory timeline store and dispatches it whole
(`agent-manager.ts:6705-6722`, `agent-timeline-store.ts:246-248`).
`limitAgentTimelineItemContent` caps shell output and plain text at 64 KB but **not**
`file_write.newContent` / `file_edit` strings (`agent-timeline-content.ts:45-65`). A 60 KB write
streamed over ~40 s ≈ 12-18 MB of wire per viewing client and the same retained in daemon memory,
for one tool call. This is also the main inflator behind daemon RSS growth (F11), and long-session
timeline pagination re-clones and re-projects all of it whenever a page contains a tool_call
(`session.ts:9887,9934`).

**Fixes:** cap `file_write`/`file_edit` content in running-status items inside
`limitAgentTimelineItemContent` (~20 lines) and throttle running-input re-emits to ~500 ms or
+4 KB growth (~15 lines). Both touch upstream-shared files but as small additive hunks.

### F5 - Every agent lifecycle event rebuilds the full agent/workspace/project catalog, once per connected client (traced path, inferred event rate)

`emitState` (~45 call sites) fires per lifecycle/permission/steer event; each fire, per session,
runs `buildDescriptorMap`, which fetches and projects **every** live agent, **every** persisted
record, all workspaces, all projects, and terminal activity, even when scoped to one workspaceId
(`workspace-directory.ts:191-201`, `agent-updates-service.ts:308-310`,
`session.ts:8191-8260,7319-7348`). The deep-equal dedupe at `session.ts:8250-8256` suppresses the
wire send, **not the rebuild**. With 3 clients, 5 running agents, and a home carrying hundreds of
archived records, this is thousands of object projections per second during activity, mostly to
conclude nothing changed.

**Fix:** scope `buildDescriptorMap` to the requested workspaceIds (agent storage already keeps an
owner index), and/or debounce `emitWorkspaceUpdateForWorkspaceId` 100-250 ms trailing. Both land in
Otto-original modules (`workspace-directory.ts`, `agent-updates-service.ts`): **no churn in shared
`session.ts`/`websocket-server.ts`**.

---

## Quick wins

Contained, low-risk, each independently shippable. Ordered by value ÷ effort within each group.

### Token economy (all fork-original files, zero upstream merge cost)

| #   | Fix                                                                                                                                                                                                           | Est. win                                                                                        | Size                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ |
| Q1  | Restore serializer cap + compact JSON (F1)                                                                                                                                                                    | Bounds every MCP tool result at ~30K chars; ~35-55% off array results even under the cap        | ~20 lines, code in git history |
| Q2  | Cap schedule run history (keep ~50) + truncate `buildRunOutput` to ~2K chars (`schedule/service.ts:868,228-243`)                                                                                              | A 90-day daily schedule currently yields an est. 45K+ tokens per `schedule_logs` call           | ~10 lines                      |
| Q3  | `.max(500)` on `get_agent_activity` `limit` + per-entry message cap in `activity-curator.ts:56-58,166-171`                                                                                                    | Blocks full-child-transcript dumps into the parent                                              | ~6 lines                       |
| Q4  | Head/tail-cap each `lastMessage` in `wait_for_agents` (`otto-tools.ts:5000-5030`) at ~4K chars                                                                                                                | A 32-way gather currently returns up to est. 40K tokens in one result                           | ~5 lines                       |
| Q5  | Default `capture_terminal` `scrollback: true` to last ~300 lines (`otto-tools.ts:3785-3823`)                                                                                                                  | Wide build output currently ≈ 37K tokens per capture                                            | ~4 lines                       |
| Q6  | Dedupe the browserId boilerplate sentence repeated across 24 browser tool descriptions; fix "a Otto" (x22)                                                                                                    | ~450-500 tokens/request with browser tools on; est. 9-10K/turn on a 20-round openai-compat turn | text-only                      |
| Q7  | Strip the bulky field from browser `structuredContent` (payload currently shipped twice, `browser-tools/tools.ts:1265-1296`); align the two 80K outlier caps (snapshot text, evaluate result) to the 30K norm | Up to ~20K tokens per affected call                                                             | ~6 lines                       |

### Client rendering

| #   | Fix                                                                                                                                                                               | Est. win                                                                                                                                       | Size / merge cost                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Q8  | Debounce streaming-fence highlight in `fence.tsx` (F2)                                                                                                                            | Removes the dominant per-tick UI-thread cost while code streams                                                                                | small; fork-original file                                        |
| Q9  | Cap the mounted-window walk-back while **following** (`web-virtualization.ts:114-116`); pin behavior while detached unchanged                                                     | Restores the 12-item virtualization cap during long single-turn agentic runs (currently the whole turn stays DOM-mounted)                      | small; shared file but already fork-modified, low practical risk |
| Q10 | Per-group listener buckets in `agent-stream/assistant-bubble-text.ts:65-88`                                                                                                       | Removes an O(mounted text) string join per flush per bubble                                                                                    | tiny; fork-original                                              |
| Q11 | Gate the 10 s preview-server poll on route focus + app visibility (`workspace-desktop-tabs-row.tsx:581-593`); add a set-equality bail in `preview-running-servers-store.ts:64-73` | ~18 RPC/min stop firing from hidden deck workspaces and minimized windows                                                                      | ~5 lines; Otto-original code                                     |
| Q12 | Shared minute-ticker for relative chat timestamps (`use-chat-timestamp.ts:18-24`)                                                                                                 | Collapses potentially hundreds of per-row 60 s intervals to one                                                                                | one small file                                                   |
| Q13 | Content-stable `changedPaths` Set in `changes-reveal.ts:77-83`                                                                                                                    | Stops every explorer row and every open file tab re-rendering per diff snapshot (feeds `file-explorer-pane.tsx:926`, `file-tab-pane.tsx:2216`) | tiny; **Otto-original file**                                     |
| Q14 | Size-gate file preview highlight+mount (`file-pane.tsx:628-633,767-778`): plain-text fallback above ~1 MB / 10K lines                                                             | Opening a big log/lockfile currently freezes the app for seconds                                                                               | ~10 lines; low conflict                                          |

### Daemon

| #   | Fix                                                                                                                                                                        | Est. win                                                                                                    | Size / merge cost                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Q15 | Raw-diff-text hash before structuring/highlighting (F3a)                                                                                                                   | Converts no-op watcher wakeups from full pipeline runs into one spawn + one hash                            | small                                |
| Q16 | Ignore-filter recursive watch callbacks on Windows/macOS (F3b)                                                                                                             | Removes the build-churn spawn storm                                                                         | medium-small, additive               |
| Q17 | `WeakMap` memo in `serializeAgentStreamEvent` (`messages.ts:9-39`; called per session at `session.ts:2140`)                                                                | N clients x 10-50 events/sec zod walks collapse to 1; biggest on 100 KB+ tool snapshots                     | small; 39-line server helper file    |
| Q18 | Guard the inbound trace stringify (`session.ts:2271-2277`) with `isLevelEnabled`, mirroring `emit()` at `:10870-10881`                                                     | A 2 MB file save stops paying a 2 MB stringify for a disabled log                                           | 3 lines; trivial hunk in shared file |
| Q19 | `getCheckoutLite` for reconciliation (identity fields only, ~5-6 spawns instead of ~17; `workspace-reconciliation-service.ts:505-517`)                                     | The 5-minute tick drops from ~425 spawns (25 cwds) to ~140                                                  | additive method                      |
| Q20 | Clear the sticky active workspace on last-client-disconnect or prolonged `appVisible: false` (`setActiveWorkspace` is never called with null; `session.ts:7020-7031`)      | Stops the 60 s self-heal (~15-22 spawns/min) and the 180 s network `git fetch` from running 24/7 unattended | small policy hook                    |
| Q21 | Delete git-operation-log buffers on workspace archive (`git-operation-log.ts:54-93`); evict retained transcripts on viewer unsubscribe (`agent-manager.ts:1286,2011-2021`) | Monotonic daemon maps stop growing                                                                          | small; fork-leaning files            |

### Client memory (all traced; none visible to the 07-25 census)

| #   | Fix                                                                                                                                                                                            | Est. win                                                                             | Size  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----- |
| Q22 | Release editor buffers on `closeWorkspaceTabWithCleanup` and bulk close (`workspace-bulk-close.ts:130-152` bypasses the only release path at `file-panel.tsx:63-79`); or cap the buffer store  | Full file text (x2 dirty, x3 conflicted) per file tab ever opened stops accumulating | small |
| Q23 | Evict `agentDetails` on chat close (`session-store.ts:1700-1718`; only deleted when an agent is removed)                                                                                       | One full Agent snapshot per archived chat opened from History stops accumulating     | small |
| Q24 | Evict `fileExplorer` listings and the other per-agent side-maps missed by both release paths (`session-store.ts:481,510,442,492,498,505`)                                                      | The heaviest is one `ExplorerDirectory` per directory ever expanded, per workspace   | small |
| Q25 | Call `resetForParent` in `cleared-subagent-tokens-store.ts:91-101` (currently test-only) when a parent chat is released; cap `context-management` `queryReports` per server (`store.ts:61-75`) | Unbounded Sets/reports on the exact hours-long orchestrator workload                 | small |

## Structural items (need a design decision)

1. **Daemon in-memory timeline stores are unbounded per agent** (`agent-timeline-store.ts:235-249`;
   released only on archive/clear). Fix direction: keep a tail window in memory and page older rows
   from the durable store, but note the durable store is **never wired in production**
   (`bootstrap.ts:1269-1292` omits it; tests only), so this needs the durable half stood up first.
   Decision: is a durable timeline store wanted, or a plain in-memory cap with re-fetch from
   provider transcripts? `agent-manager.ts` is merge-heavy; the store swap can hide behind its
   existing interface.
2. **Timeline pagination re-clones and re-projects the full row set whenever a page contains a
   tool_call** (`session.ts:9887,9934`). Needs an incremental projection or a projected index;
   ~1-2 days; upstream-shared files.
3. **Full tokenized diff snapshot re-shipped per update, tokens ~2-3x the text**
   (`checkout-diff-manager.ts:256-258`; client re-parses it all per message). Per-file revisions or
   dropping `content` where `tokens` exist are protocol-additive but touch both ends: do not start
   without the payload measurement below.
4. **Diff pane render architecture**: no memo/structural sharing on file bodies
   (`diff-pane.tsx:1001,1271,1297`), hover state re-renders the whole body (`:1224,1362-1374`),
   O(index) `getItemLayout` (`:3257-3263`). Upstream touches this file actively; prefer the
   query-layer identity-sharing fix in `use-diff-query.ts` and defer component restructuring until
   profiled.
5. **`highlightCode` allocates a per-character style array** (`packages/highlight/src/highlighter.ts:23-29`).
   A range-based rewrite is self-contained, has tests, benefits daemon diff highlighting and every
   client surface at once; low merge cost (untouched since upstream #2270). Bench first.
6. **LSP diagnostics broadcast to every client unconditionally** (`websocket-server.ts:729-752`).
   Additive interest-gating via an Otto-original registry module keeps the shared constructor
   clean.
7. **Tab close-button hover state lives at the top of the 5,201-line workspace screen**
   (`workspace-screen.tsx:3210,4248-4251,4593-4630`): every hover re-runs a ~2,400-line memo body.
   Fix is a local store, but it churns two heavy shared files; defer until one is next touched, and
   profile first.
8. **Slow-client stream coalescing**: backpressure policy exists and is sound (64 MiB cap,
   capacity-gated sends, terminal degrades gracefully), but `agent_stream` has no tier between
   "fine" and "64 MiB then close". A stale-`tool_call_update` coalescer above ~1 MiB buffered is
   the additive fix if measurement shows real-world slow clients hit it.
9. **Expanded streaming reasoning renders the full thought as one ever-growing Text per flush**
   (`types/stream.ts:509-539`, `tool-call-details.tsx:650-661`). Paragraph-split or tail-window it;
   matters most on mobile with auto-expand on.

## Clean bills (checked, not broken; do not re-audit)

- **Chat streaming architecture**: delta append is O(1) rope concat; only the tail block re-parses
  markdown; grouping/layout are WeakMap-cached on array identity; the 32 ms ticker re-renders one
  item; hidden panes freeze stream props; composer keystrokes outrank stream renders via
  `useDeferredValue`; virtualizer unmounts and measures correctly. The two holes are F2 and Q9.
- **Provider streaming**: JSONL tailing is incremental with a surviving byte offset, correct
  truncate/partial-line handling, self-stopping 700 ms pollers, watchers torn down at session
  close. Assistant text is delta-only end to end (no full-message-per-delta quadratic). The
  openai-compat SSE loop does no per-chunk re-stringify/re-validation and already sends
  `prompt_cache_key`. One cosmetic nit: a multi-byte UTF-8 char split across reads decodes as
  U+FFFD (`jsonl-tail.ts:36`); ~10-line fix, fork-original file.
- **Daemon websocket hygiene**: one parse per inbound message against a module-scope discriminated
  union; no sync fs in session handlers; per-session subscriptions all torn down in
  `Session.cleanup()`; stringify-once-per-connection fan-out; `workspace_update` deduped.
- **Git spawn machinery**: global pLimit(8), per-workspace serialization with request merging,
  facts TTLs, fingerprint-deduped emits, sticky fork-point persistence (deliberate per
  `docs/changes-view.md`), on-demand worktree listing. The problems are the _drivers_ (F3, Q19,
  Q20), not the machinery.
- **App render architecture**: session-store reads go through equality-guarded hooks; sidebar
  entries rebuild identity-preserving; effect cascades converge (reconcile bails on no-op);
  react-query push handling is surgical `setQueryData`; providers memoize values. Two narrow
  selectors worth fixing when touched (`git/use-actions.tsx:263`, `runs-screen.tsx:706-707`).
- **Client caches**: bubble-text/offset maps, height estimates, image caches, mermaid outcomes,
  file-view and context-usage stores are all capped or WeakMap-keyed; push-router subscription
  state is reconciled, not accumulated; terminal scrollback bounded at both ends; browser-tools
  logs capped per tab and torn down on destroy; preview dev-server logs capped.
- **openai-compat token hygiene is better than the documented model**: built-in tools all capped,
  old tool results pruned to 800/400 head/tail, stale base64 images dropped after the 2 most
  recent.
- **Editor typing path**: CM6 incremental parsing, rope-equality dirty check, 750 ms draft
  debounce, mount-once core. Not the problem.

## Corrections to the record

- **The `useUnistyles()` ban's stated mechanism is out of date.** Pinned v3.2.4 does proxy-based
  dependency tracking (`useProxifiedUnistyles`): a component re-renders only when a dependency it
  actually read changes, not "on every runtime change". The remaining real cost is that
  `applyAppearance`/`applyColorScheme` loop all registered theme keys, so theme-reading hook sites
  re-render at least twice per appearance event, and four sit above hot subtrees
  (`left-sidebar.tsx:159`, `split-container.tsx:691`, `agent-status-dot.tsx:24`, composer
  agent-controls). The ban is still right as policy (the hook defeats memo boundaries); the
  rationale in `docs/unistyles.md` deserves a one-line update, and a sweep of the ~120 cold call
  sites is **not** worth anyone's time.
- **`packages/server/CLAUDE.md` references `agent_timeline_rows`**, but the durable timeline store
  is not wired in production and that table does not exist in this tree; the doc example is stale.
- **`mcp-server.ts:17-22`** carries a comment describing a cap that no longer exists (F1).

## Measure before you fix

The daemon already ships the instruments: `ws_runtime_metrics` (30 s window, event-loop delay
percentiles, `websocket-server.ts:977-1036`) and `snapshotGitCommandRuntimeMetrics`. In order of
decision value:

1. **F2 (fence highlight):** wrap `tokenizeToLines` in `performance.now()` and stream a 20-50 KB
   TypeScript fence; calls/sec x ms/call. If ≥1 ms/call at ~30 calls/sec, this alone explains
   code-streaming jank; if sub-0.2 ms, downgrade it.
2. **F3 (watcher storm):** `snapshotGitCommandRuntimeMetrics` during (a) 30 min idle with 5
   workspaces, (b) an agent editing with the Changes tab open, (c) `npm install` in a watched
   workspace on Windows. Confirms spawns/min and whether Defender/coalescing already dampens (c).
3. **F5 (descriptor rebuild):** counter+timer around `buildDescriptorMap` (calls/sec, ms/call,
   records scanned) with 2 clients and a home with 500+ stored agents, during one streaming turn.
4. **F4 (tool-input snapshots):** log timeline-row bytes appended during one 60 KB streamed Write;
   confirms the 12-18 MB/client estimate.
5. **Diff snapshot payload:** `Buffer.byteLength(JSON.stringify(snapshot))` for a typical 30-file
   agent branch. Under ~500 KB, skip structural item 3 entirely; the wall-time of
   `computeCheckoutDiffSnapshot` on this repo's real working tree decides cache vs size-gate for
   F3c.
6. **Q9 (mounted window):** during a long single-turn run on web, count content-div children
   outside the virtualized block; >~40 while streaming confirms the cap is void.
7. **Daemon RSS attribution:** heap-snapshot after a synthetic 20 chats x 500 timeline items;
   attribute retained size to `InMemoryAgentTimelineStore` before committing to structural item 1.
   Also confirms whether boot hydrates all persisted agents' rows or lazily per fetch.
8. **Hover/tab-strip commits (structural items 4, 7):** React profiler; if commits are <5 ms in a
   production build, skip the churn: the merge cost is not worth it.
9. **Pretty-print inflation (F1):** byte-compare compact vs indented on one real `list_agents`
   result to replace the 35-55% estimate. (The fix is justified either way; the number is for the
   record.)
10. **Preview poll volume (Q11):** count `preview.list_config` inbound frames over 10 idle minutes
    with 3 visited workspaces.

Unverified inferences worth a look while instrumenting: whether the PR pipeline poll
(`use-pipeline.ts:75`) really stops in hidden retained tabs; whether MCP CLIs forward
`structuredContent` to the model in addition to `content` (decides how much Q7 saves); whether a
TTS group cancelled mid-speech leaks its audio buffers (`session-context.tsx:952-999`, the release
sits behind the final-chunk path).

## Timeline

- time: "2026-08-16T22:16:11.495Z"
  kind: "migration"
  summary: "Migrated from the legacy findings report without discarding its evidence."
  source: "findings/performance-efficiency-audit/2026-08-02-static-code-audit.md"

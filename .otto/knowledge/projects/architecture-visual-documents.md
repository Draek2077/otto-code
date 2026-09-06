---
id: "architecture-visual-documents"
kind: "project"
title: "Architecture visual documents"
status: "proposed"
tags: ["architecture","documentation","knowledge","artifacts","vendor","archify"]
delivery_status: "in_build"
progress_completed: 4
progress_total: 5
progress_unit: "delivery slices"
created_at: "2026-08-27T19:16:46.149Z"
updated_at: "2026-09-06T15:32:22.762Z"
---
# Architecture visual documents

<!-- compiled_truth -->

# Interactive Views

## Outcome

Otto provides durable, Knowledge-linked **Interactive Views**. Archify remains an internal vendored renderer, not a user-facing product name.

Interactive Views complement Otto Knowledge Markdown rather than replace it. A Knowledge root or article remains the canonical, evidence-backed source. Its published Interactive Views are typed, validated interactive HTML/SVG documents that communicate the same facts visually.

## View kinds

One linked article can own one or more Views. Every View has a specific renderer contract:

- **Architecture**: components, services, storage, boundaries, and primary paths.
- **Workflow**: participants, order, branches, approvals, tool calls, exceptions, and runbooks.
- **Sequence**: callers, callees, returns, timing, cache/auth fallbacks, and asynchronous traces.
- **Data Flow**: sources, transformations, stores, sensitivity, lineage, boundaries, and consumers.
- **Lifecycle**: states, events, waits, retries, cancellation, and terminal outcomes.

Creation is article-owned. The selected Knowledge article's pinned toolbar offers **Create Interactive View** when it has no associated View and **Update Interactive View** when it does. The toolbar action opens a compact menu:

1. When Otto can make an unambiguous local detection, its suggested type is the first choice. Mermaid `sequenceDiagram` and `stateDiagram` are direct evidence; otherwise only a clearly dominant terminology score is suggested.
2. The user can always choose Architecture, Workflow, Sequence, Data Flow, or Lifecycle explicitly.
3. Ambiguous source receives no automatic choice.

The selected type is persisted with the View and is passed to the daemon-owned renderer. An older host that does not advertise typed Interactive Views is gated out rather than silently producing an Architecture View.

## Reader and authoring experience

Readers reach Views from the owning Knowledge article's article/View toggle. The selected View replaces that article's canvas; a selector appears only when that article owns multiple published Views. There is no global Interactive Views list or standalone Knowledge-navigation section: readers seek the Knowledge article that explains the subject.

Authoring is a normal persisted chat tab carrying narrow Interactive View metadata and rendering an attached split surface: chat on the left, live validated preview on the right. The binding and split presentation restore with ordinary chat state after application or daemon restart. A new Create or Update action creates a fresh authoring chat and sends a visible type-specific instruction; “update” changes that instruction only, it does not attempt to resume an old chat.

The chat may update both the View and its linked Knowledge when the user asks. Only validated JSON updates refresh the preview. Publishing creates the current revision and then completes the authoring chat through the normal Archive/Delete choice. Deleting removes the unpublished View and likewise completes that chat only after the user's Archive/Delete choice. The published revision remains untouched when a new attempt is deleted or fails validation.

## Storage and safety

Canonical typed JSON, generated self-contained HTML, receipts, revision history, and explicit Knowledge references live in the resolved Project Knowledge store. Source digests mark a View stale when only its cited Knowledge source changes; Otto never silently regenerates or republishes it. The daemon owns every create, update, publish, delete, and render action. Generated HTML stays behind Otto's constrained, no-network rendering boundary.

## Compatibility and vendor policy

The renderer is vendored from [[reference-archify]] as a reviewable pinned subtree. Otto-owned server, protocol, and UI layers own storage, validation, rendering constraints, type choice, authoring, and presentation. Typed Interactive View support uses an additive, capability-gated protocol field so peers that predate it remain structurally compatible without a degraded renderer path.

## Timeline

- time: "2026-08-27T19:16:46.149Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["artifacts","project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto","reference-archify"]
- time: "2026-08-27T19:16:46.149Z"
  kind: "evidence"
  summary: "User direction and design decisions from the Archify evaluation conversation on 2026-08-27. Upstream capability and license review is recorded in [[reference-archify]]. Existing Otto baselines reviewed: [[artifacts]], [[project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto]], docs/project-knowledge.md, docs/preview.md, and docs/visualizer.md."
- time: "2026-08-29T20:01:15.978Z"
  kind: "evidence"
  summary: "The user fixed the product boundary: the feature is named **Architectural Views**; Archify is an internal vendor detail. Every operation is daemon-owned. Canonical JSON, rendered HTML, receipt, and Knowledge-reference manifest are packaged under the existing resolved Project Knowledge store, so repository-backed Knowledge and host-backed Knowledge carry their Architectural Views with them. The first verified slice vendors Archify at `9a5060566c832832fb843e457e58c8ee6bac82fd`, packages its runtime with the daemon, adds an `architectural-views.deliver` daemon RPC and capability gate, and exposes `otto architectural-view deliver` as a daemon client. The slice writes only to the resolved Knowledge store and never starts Archify's local server, OS opener, or Chrome checks."
  source: "Implementation verified 2026-08-29"
  affects: ["project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto","reference-archify"]
- time: "2026-08-29T20:01:17.178Z"
  kind: "note"
  summary: "Verified vendor baseline plus daemon-owned, Knowledge-packaged Architecture delivery and CLI boundary landed. Draft revisions, reader UI, discovery, and chat tools remain future slices."
  affects: ["architecture-visual-documents"]
- time: "2026-08-29T20:02:18.437Z"
  kind: "evidence"
  summary: "Reader experience is anchored in Manage Knowledge. Any Knowledge root or atomic Markdown article may own Architectural Views. Its pinned Knowledge toolbar offers an explicit Article / Architectural View toggle; selecting an attached view replaces the article canvas in the same Knowledge context, while the toggle returns to the article. Multiple attached views use a view selector and one current published default. Otto-native chrome owns view identity, source Knowledge links, published/draft/stale state, revision actions, and the app-level light/dark choice. The embedded renderer retains only diagram-intrinsic navigation such as pan/zoom, search, focus, tracing, and similar reader interactions. The theme choice is passed from Otto rather than treated as an authored diagram fact; exact host-to-renderer control needs proof before removing upstream controls.\n\nAuthoring must not turn a Knowledge article into a chat transcript. Starting or reopening a view creates/focuses a durable staged draft linked to its parent Knowledge article and opens an explicitly linked Architectural Views authoring chat in a companion split beside the draft preview. The chat updates only that draft; the article remains its source anchor and ordinary reader surface. Publish promotes the draft to the article's current view, while discard preserves the article/current published view and closes only the authoring binding. Exact draft-entry affordances and split/tab behavior remain a product-design discussion before implementation."
  source: "User product direction 2026-08-29"
  affects: ["artifacts","project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto"]
- time: "2026-08-29T20:14:21.157Z"
  kind: "note"
  summary: "Verified the second delivery slice: daemon list/content RPCs discover only the selected Knowledge root or record’s valid manifests, deliver daemon-sanitized CSP-protected interactive HTML, and the Manage Knowledge toolbar now owns the Article / Architectural View toggle plus multi-view selector. Targeted service/session tests, protocol/client builds, app/server typechecks, targeted lint, and server build passed. Draft authoring, revision publication, staleness, and chat tools remain open."
  affects: ["architecture-visual-documents"]
- time: "2026-08-29T22:00:56.152Z"
  kind: "note"
  summary: "Verified the durable draft/revision foundation beneath the existing reader: drafts have separate canonical JSON, last-valid sanitized HTML, receipt, base published specification hash, and explicit discard. Publishing uses optimistic concurrency, snapshots the prior published files into revision history, and rejects stale drafts for an explicit rebase. Focused service tests and targeted lint pass. This is not yet a completed authoring journey: no daemon draft RPC/CLI, bound authoring chat, draft workspace tab, lease, or app controls have landed."
  affects: ["architecture-visual-documents"]
- time: "2026-08-29T22:10:32.800Z"
  kind: "note"
  summary: "Exposed the verified staged model through daemon-owned, workspace-scoped Architectural Views draft RPCs for create, publish, and discard, plus matching daemon-client methods and `otto architectural-view draft create|publish|discard` commands. Create retains the source-path workspace guard; publish/discard remain daemon-only. Protocol/client builds, CLI typecheck, targeted lint, Architectural Views session tests, and the CLI surface test pass. A root test invocation encountered an unrelated stale .tmp/android-tablet-build CLI copy; the intended CLI-workspace test passed. Draft update, authoring chat/tab binding, leases, and app controls remain open."
  affects: ["architecture-visual-documents"]
- time: "2026-08-29T22:13:51.489Z"
  kind: "note"
  summary: "Completed the daemon-bound CLI draft lifecycle: `otto architectural-view draft create`, `update`, `publish`, and `discard` are all client calls to workspace-scoped daemon RPCs. Draft update re-renders in staged storage and preserves the last valid staged preview on failure. Protocol/client build and typecheck, CLI typecheck, targeted lint, session/service tests, and CLI surface tests pass. The authoring milestone remains in progress until these operations are bound to a durable authoring chat and draft workspace tab with leases."
  affects: ["architecture-visual-documents"]
- time: "2026-08-29T23:15:49.684Z"
  kind: "evidence"
  summary: "Extended the in-progress authoring journey with a daemon-served staged-preview RPC and a dedicated persisted Architectural View Draft tab. The tab renders the last validated staged HTML, exposes explicit publish/discard controls, and closing it detaches only. Opening authoring chat launches the standard provider-neutral composer; after the developer chooses a provider and sends, the daemon atomically binds the created agent to that draft, injects a concise draft/tool brief, and rejects another chat's access. Bound chats now receive provider-neutral read/update draft tools that operate on canonical JSON, retain the last-known-good preview on a failed render, and never mutate the published revision. Publication removes the staged draft only after the new published files commit. Focused service/session/tool/tab tests pass, along with app typecheck. Broader server/client typechecks currently encounter unrelated concurrent Workflow confirmation-token errors."
  source: "Implementation verified 2026-08-29"
  affects: ["artifacts","project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto"]
- time: "2026-08-30T00:25:38.690Z"
  kind: "evidence"
  summary: "Completed the remaining discovery, freshness, and agent-open slice. Published manifests now record a digest for each linked Knowledge root/record; listing or opening compares only those cited Markdown sources and reports `current`, `stale`, or (for older manifests without provenance) `unknown`. Otto never regenerates or republishes a view automatically. Manage Knowledge now lists Architectural Views as typed reader entries that open the dedicated published-view workspace tab, while linked article/root views retain their Article / Architectural View toggle. Agent and MCP catalogs now include `show_architectural_view`; it verifies the requested published view and emits a daemon-routed workspace intent, so the requesting chat opens the interactive tab instead of receiving HTML. Protocol/client builds, app and server typechecks, targeted lint, `git diff --check`, and 50 focused service/session/tool/tab tests passed."
  source: "Implementation verified 2026-08-29"
  affects: ["project-knowledge-context-management","artifacts"]
- time: "2026-08-30T00:25:52.788Z"
  kind: "note"
  summary: "Verified durable draft authoring, source-staleness, Knowledge discovery, published workspace tab, and agent/MCP open behavior. Proof/security/documentation delivery slice remains open."
  affects: ["architecture-visual-documents"]
- time: "2026-09-06T03:21:16.038Z"
  kind: "evidence"
  summary: "User selected an article-owned entry point for Architectural Views: Manage Knowledge does not show an empty global Architectural Views section. From a selected Knowledge root or article, its pinned toolbar now offers **Create Architectural View** when no published view exists, **Open Architectural View** when one does, and **Resume Architectural View draft** for durable staged work. Creation is daemon-owned and produces a small valid, knowledge-linked starter specification, so it needs neither a workspace JSON file nor a retained chat context. Draft discovery is a separately capability-gated, backward-compatible RPC; the UI waits for it before offering creation, preventing duplicate staged work after restart. Targeted Architectural Views service/session and workspace-tab tests, protocol/client build, server/app typechecks, targeted lint, format, and `git diff --check` passed."
  source: "Implementation verified 2026-09-05"
  affects: ["project-knowledge-context-management"]
- time: "2026-09-06T06:03:13.623Z"
  kind: "evidence"
  summary: "The authoring lifecycle has been corrected: an active Architectural View authoring surface is a **normal persisted chat tab** with an Architectural View binding and split chat/preview renderer, not a separate resumable preview-tab lifecycle. It restores with ordinary chat state across Otto/daemon restart. Archive or delete of that bound chat discards the unpublished draft; publishing or toolbar discard ends only the binding and leaves the ordinary chat available. The linked Knowledge toolbar creates/updates by focusing the one active bound chat for that view. Chat tooling may update both the staged visual and linked Knowledge when requested. Moving a bound chat to another workspace is allowed, but releases the draft in its source Knowledge store and converts the moved chat to an ordinary chat, so no visual preview travels with it. Focused tab identity/visibility/menu and Architectural Views storage tests passed; targeted lint and server typecheck passed. App typecheck is currently blocked by an unrelated in-progress type error in `packages/app/src/agent-stream/chat-outline/use-chat-outline.ts`."
  source: "User product direction and implementation verification 2026-09-06"
- time: "2026-09-06T15:32:22.762Z"
  kind: "decision"
  summary: "User renamed the product to Interactive Views, rejected global Visual discovery, and selected explicit-or-detected typed creation on 2026-09-06. Implementation now persists all five renderer contracts and gates typed creation on the daemon capability."
  source: "User product direction and verified implementation, 2026-09-06"

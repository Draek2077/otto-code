---
id: "architecture-visual-documents"
kind: "project"
title: "Architecture visual documents"
status: "proposed"
tags: ["architecture","documentation","knowledge","artifacts","vendor","archify"]
delivery_status: "charter"
progress_completed: 0
progress_total: 5
progress_unit: "delivery slices"
created_at: "2026-08-27T19:16:46.149Z"
updated_at: "2026-08-27T19:16:46.149Z"
---
# Architecture visual documents

<!-- compiled_truth -->

# Architecture visual documents

## Outcome

Otto gains durable, interactive **visual documents** for project architecture. The first use case is Architecture diagrams, with the same renderer capable of later Workflow, Sequence, Data flow, and Lifecycle documents.

A visual document is not a one-shot generated artifact and not a replacement for Project Knowledge:

- Otto Knowledge Markdown remains the canonical, evidence-backed record of architecture, decisions, requirements, and project state.
- A visual document is a versioned, Knowledge-linked communication view. It has explicit source records and source revisions, a typed diagram specification, a validated interactive HTML/SVG rendering, and a publication history.
- Readers open the current published visual. Authors create a durable staged draft, iterate conversationally beside a live preview, then publish or discard it deliberately.

The renderer is vendored from [[reference-archify]] as an exact, reviewable upstream subtree; Otto owns all product integration, storage, access control, lifecycle, and UI.

## Why this exists

Architecture facts are easier to comprehend when a reader can see boundaries, main paths, dependencies, and lifecycle in one visual surface. Markdown is still the durable source of truth, but a static diagram fence cannot provide the maintained, discoverable, interactive architectural view needed for a large project.

A diagram must not become a disconnected, model-authored claim. It stays grounded in selected Knowledge records and, when appropriate, revision-pinned code evidence. When one of those declared sources changes, Otto marks the diagram stale; it never silently regenerates or republishes it.

## Product model

```text
Knowledge page or root
  └─ Visual document
       ├─ published revision: the trusted reader default
       ├─ staged draft: durable, unpublished working revision
       ├─ typed Archify JSON specification
       ├─ verified self-contained HTML/SVG rendering
       ├─ validation and delivery receipts
       └─ declared Knowledge/code source manifest
```

### Published document

A published revision is a durable project document. It is the version opened by default from a Knowledge article, Knowledge search, or an agent request such as “show me the architectural diagram for Workflows.”

Publishing does **not** make the visual immutable. Later editing forks the current published revision into a new staged draft. Publishing a subsequent passing draft replaces the current revision and retains the prior history.

### Staged draft and authoring session

The staged draft is durable project-owned work, not chat context. It stores the diagram JSON, last valid rendered preview, base published revision, source manifest, validation state, and authoring metadata.

The temporary authoring session is a daemon-owned binding:

```text
authoring chat  ↔  staged draft  ↔  Diagram Draft preview tab
```

- Opening a draft is idempotent: Otto focuses its existing bound preview instead of creating duplicates.
- Diagram-update, validate, compare, and publish tools target the bound draft id; they cannot drift onto a different diagram.
- A draft preview uses a dedicated Diagram Draft workspace tab backed by the same constrained self-contained HTML rendering surface as Artifacts. It is **not** a Preview dev server or a generic browser tab.
- A successful update refreshes the live preview only after validation passes. An invalid update preserves the last known good preview and exposes focused diagnostics.
- Finishing an agent response does not close or discard a draft. **Publish** promotes the revision, releases the authoring session, and closes the bound preview. **Discard** explicitly removes the staged revision, releases the session, and closes the bound preview.
- Closing the preview tab alone does not discard work. The chat may reopen the bound draft.
- App or daemon restart leaves durable drafts recoverable and marks their transient session/preview as paused or detached.

A draft with no active editing session becomes **paused** rather than holding an indefinite lock. Its active lease is released, so another user can work. Publication uses the draft’s base revision and an explicit compare/rebase decision if another revision became current in the meantime. Live multi-author diagram editing is out of scope.

### Knowledge relationship and discovery

Each visual document has explicit parent Knowledge page/root references and a source manifest containing source digests. The relationship is discoverable in both directions:

- A Knowledge article exposes its associated published visuals in an **Associated visuals** section.
- Knowledge navigation and title search list visual documents as typed, searchable items.
- A dedicated diagram workspace tab presents the interactive reader.
- An agent-native open command resolves a requested Project Knowledge scope and opens the current published visual in the workspace instead of embedding HTML in chat.
- If no matching published visual exists, the agent reports that honestly and may offer to create a staged draft.

Source changes set a visible stale indicator. Refresh is an explicit authoring action that begins from the stored typed specification and only reads the selected source manifest plus the requested change; it does not require rereading the project’s entire documentation set.

## Vendor policy

- Vendor Archify in `vendor/archify/` as a pinned, squashed git subtree, retaining upstream history references, the MIT license, both upstream copyright notices, and a root `OTTO-PATCHES.md`.
- Follow the established [[reference-agent-flow]] vendor discipline: no Otto product code in `vendor/`; adapters, UI, tests, and build integration live in Otto-owned packages; vendor code is excluded from Otto formatting/linting; each carried patch is documented; upstream pulls are deliberate.
- Pin an exact upstream commit rather than tracking the current development branch. Re-evaluate changes, generated output, license inventory, and patches before every subtree update. Freezing the subtree remains a valid escape hatch.
- The initial vendor payload must not include upstream brand marks in Otto’s shipped document set. Brands/logos require explicit user intent and a separate trademark-safe policy.
- Run the renderer through a constrained Otto-owned daemon adapter. The product surface may call validation, delivery, and document comparison; it must not expose upstream commands that launch OS windows, local preview servers, or Chrome processes.
- Preserve the existing Artifacts HTML security boundary: self-contained content, Otto-owned CSP, no network access, and platform-isolated web/iframe/webview rendering.

## Delivery slices

### 1. Vendor baseline and deterministic renderer adapter

- Add the pinned Archify subtree, attribution/notice material, update instructions, and patch ledger.
- Create an Otto-owned renderer adapter that writes only inside the resolved document store, validates input/output paths, invokes supported render/validate/deliver operations with argument arrays, and stores structured receipts.
- Support Architecture mode end to end first. Preserve the shared type contract so Workflow, Sequence, Data flow, and Lifecycle can follow without another renderer integration.
- Prove normal rendering, deterministic invalid-spec diagnostics, atomic successful delivery, and retained MIT notices.

### 2. Durable visual-document storage and revision model

- Add a project-scoped document identity, published revision, staged draft revision, explicit source manifest, base revision, validation receipt, stale state, and bounded revision history.
- Store typed JSON and generated HTML separately. The JSON is the editable canonical diagram source; generated HTML is a verified derivative and never the only recoverable representation.
- Resolve ownership consistently with the Project Knowledge/Artifact ownership decision. Repository-owned visuals are versionable and reviewable; host-owned visuals disclose their daemon-host limitation. Do not infer a second ownership policy in each caller.
- Preserve published output across a failing draft render, cancellation, app restart, or daemon restart.

### 3. Draft-session lifecycle and authoring tools

- Add daemon-owned draft/session/preview binding with idempotent opening and scoped authoring operations.
- Give active chats provider-neutral tools to create a visual draft, read/update its specification, validate, compare with the published revision, publish, discard, reopen, and list related visuals.
- Keep draft contents on demand. Resumption supplies a concise source/draft brief and loads JSON/source details only when needed; it must not require retaining the original model context or injecting all project documentation.
- Implement active authoring leases, paused drafts, explicit takeover/rebase behavior, and safe handling of closed tabs and disconnected chats.

### 4. Knowledge and workspace discovery

- Surface associated visuals from their linked Knowledge article/root without writing visual state into freeform Markdown.
- Add typed visual-document discovery to Knowledge navigation and title search.
- Add published diagram and diagram-draft workspace tabs, with native toolbar actions appropriate to reader and authoring states.
- Let agents resolve natural-language requests such as “show the Workflows architecture diagram” to the current published visual; do not paste visual payloads into chat.
- Show source provenance, published revision, validation result, and stale state clearly to readers and authors.

### 5. Proof, security, and documentation

- Add focused T1 tests for document storage, revision conflict handling, path traversal, stale detection, scoped session bindings, render/validate/deliver receipt parsing, and old-client/old-daemon compatibility.
- Add controlled T2 proof that creates a diagram from selected known inputs, renders it in the Otto surface, resumes a paused draft, publishes a new revision, and proves the prior published revision survives failures.
- Test HTML isolation and navigation/network restrictions on web, Electron, and native. Ensure off-screen previews do not retain rendering work unnecessarily.
- Update product documentation, vendor/update documentation, Knowledge documentation, Artifact documentation where shared infrastructure changes, and the E2E coverage matrix.

## Acceptance criteria

1. A developer can create a project Architecture visual from selected Knowledge/code sources, inspect its provenance, and publish a validated interactive HTML/SVG document.
2. Any reader can locate the current visual from its linked Knowledge entry, Knowledge search, or a natural-language agent request, and open it in a dedicated interactive tab.
3. An author can reopen a published visual at any time, produce a persistent draft, iterate conversationally beside a last-known-good preview, close/reopen it safely, and publish or discard explicitly.
4. A draft never exists only in a chat. App restart, daemon restart, context compaction, and a completed model response do not lose it.
5. A source change marks the visual stale; no source change silently edits or republishes a diagram.
6. Concurrent work cannot silently overwrite a newer published revision. Conflict/rebase is explicit.
7. The shipped renderer is vendor-traceable, license-compliant, constrained to approved operations, and its interactive output cannot use network or host privileges.
8. New behavior is capability-gated for old hosts and uses only backward-compatible protocol additions. There is no client-side fallback that bypasses daemon-owned document state.

## Non-goals

- Replacing canonical Project Knowledge Markdown with diagrams.
- A general-purpose WYSIWYG diagram editor, arbitrary canvas drawing, or live multi-user co-editing.
- Automatic repository-wide architecture discovery or automatic regeneration when files/docs change.
- Treating an ordinary Artifact’s mutable data block as an editable diagram source.
- Reusing Preview dev-server/browser-tool lifecycle for diagrams.
- Hosted publication, cloud synchronization, external sharing, or cross-host live collaboration.
- Shipping third-party brand marks by default.

## Dependencies and open product decisions

- [[artifacts]] supplies durable self-contained HTML rendering, project ownership direction, and Artifact security experience. Diagram documents reuse these foundations but require a distinct typed/revisioned document model.
- [[project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto]] supplies canonical Knowledge storage, links, review discipline, and project/worktree ownership resolution.
- [[reference-mermaid]] remains the lightweight inline-diagram dependency. Archify visual documents complement it for durable, interactive, architecture-grade views.
- The final repository-versus-host ownership contract must be resolved together with the Artifacts ownership policy before persistent storage lands.
- The user-facing term, exact agent tool names, draft lease timing, revision-history retention, and whether a user can reveal repository-owned generated files require product/UI review before implementation freezes them.

## Timeline

- time: "2026-08-27T19:16:46.149Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["artifacts","project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto","reference-archify"]
- time: "2026-08-27T19:16:46.149Z"
  kind: "evidence"
  summary: "User direction and design decisions from the Archify evaluation conversation on 2026-08-27. Upstream capability and license review is recorded in [[reference-archify]]. Existing Otto baselines reviewed: [[artifacts]], [[project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto]], docs/project-knowledge.md, docs/preview.md, and docs/visualizer.md."

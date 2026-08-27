---
id: "project-knowledge-context-management"
kind: "project"
title: "Project Knowledge and Context Management"
status: "confirmed"
tags: ["project-knowledge","context-management","technical-review","v0.9"]
delivery_status: "in_build"
progress_completed: 1
progress_total: 5
progress_unit: "0.9 delivery slices"
created_at: "2026-08-27T00:35:29.257Z"
updated_at: "2026-08-27T02:03:39.069Z"
---
# Project Knowledge and Context Management

<!-- compiled_truth -->

# Project Knowledge and Context Management

## Outcome

Otto initializes and maintains trustworthy architectural project documentation, then lets a reviewer deliberately select and inspect the context that an agent actually receives during technical review.

## Verified baseline

### Project Knowledge

- The daemon owns canonical Markdown reads and mutations, with atomic writes, rich roots, atomic records, reason-bearing truth updates, and append-only evidence timelines in `ProjectKnowledgeService`.
- A resolver selects one store per project in a fixed order: project override, an existing repository store, then host default. Repository and host stores have the same layout; worktrees resolve to the shared project root.
- Six fixed root pages exist: Background, Architecture, Flow, Mindmap, Stack, and Roadmap. Bootstrap now replaces only the legacy ceremonial placeholder with deterministic source-linked drafts derived from the repository manifest, README, docs index/files, workspace patterns, scripts, and top-level directories. It leaves any generated evidence draft or reviewer-authored root untouched.
- Records support proposed, confirmed, and superseded review lifecycle. Roots are durable documents with no invented status lifecycle. The protocol has conditional root refinement commits by body digest and record refinement commits by update timestamp.
- The compact catalog is confirmed-record-only and full documents remain pull-on-demand. Project Knowledge root bodies are not automatically injected because they exist.
- Project Knowledge Health currently identifies stale confirmed records and likely overlap between confirmed atomic records. Link lint checks roots and confirmed current truth, never immutable timeline history.
- Open Knowledge and Context Management surfaces fetch current catalog data through the daemon, and daemon-originated mutations invalidate and republish the affected workspace’s context report. The confirmed external-change requirement still needs an end-to-end watcher/subscription proof for editor saves, pull, checkout, and deletion.

### Context Management

- Context Management has a provider-aware graph that distinguishes fixed, conditional, referenced, and unavailable context. It measures Otto-owned injected text, including the compact Project Knowledge catalog, and exposes provider visibility/confidence rather than presenting estimates as facts.
- The prompt preview is assembled on demand from the same report and does not imply that referenced files are already prompt weight. Load-mode edits apply only to the context-file forms Otto actually owns.
- Provider ownership determines visibility. Otto must keep “not visible”, “estimated”, and “exact” separate, and may not create controls for provider-native context it cannot change.

### Existing proof

- Focused service tests cover root creation/update/link lint, populated-repository evidence drafts, preservation of a reviewer root, repeat-bootstrap idempotence, optional policy handling, catalog pull-on-demand, record lifecycle, store resolution/migration, and Context Management’s Project Knowledge token contribution.
- Protocol schemas use dotted request/response names and retain optional compatibility fields for store location. The feature currently has no dedicated T1 technical-review journey and no T2 local-AI proof.

## 0.9 delivery inventory

### 1. Evidence-backed onboarding drafts

**UI and journey:** From initialization or onboarding, show the six root documents as explicit drafts with source paths and a clear next action to inspect/refine them. Do not represent generated evidence as reviewed truth.

**Daemon and storage:** Add a deterministic repository-evidence collector that works before a project has any Knowledge pages, is scoped to the resolved project root, writes through the existing atomic root path, and behaves identically for repository and host-local stores. It must never overwrite non-placeholder roots or custom `KNOWLEDGE.md` guidance.

**Bootstrap boundary:** The first slice creates useful, source-linked drafts from code and documentation evidence. Git-history synthesis and model-assisted narrative refinement follow as later delivery slices; neither is silently implied by a static collector.

**Recovery:** Missing README, package manifest, docs, or Git metadata is normal. Drafts must identify absent evidence rather than fabricate a claim. A retry must be idempotent.

**Proof:** Focused service proof now covers a populated repository, preservation of a human root, and idempotence. Sparse-repository behavior, host-store parity, the no-full-body-injection invariant, and the reachable UI journey remain required T1 coverage. Add T2 only once a model-driven technical-review side effect exists.

### 2. Repository and host-store integrity

- Preserve the resolver’s override → existing repository → host default precedence, host marker, worktree root collapse, explicit migration choice, and no silent move.
- Prove bootstrap and later refresh use the resolved store while evidence is read only from the project root.
- Surface the selected storage location and its sharing trade-off in project settings and relevant onboarding/review state.

### 3. Document review lifecycle

- Treat atomic records as proposed/confirmed/superseded and roots as durable root documents, not pseudo-records.
- Complete the reviewed refinement journey: inspect rendered document and evidence, annotate/refine, show a base-pinned diff, apply selected changes through the daemon, demote changed confirmed atomic records to proposed, conditionally update roots, and reload the open document.
- Direct raw-file writes must never become an alternate Otto mutation path. External edits remain supported as external changes and must refresh canonical views instead of being overwritten.

### 4. Context Management ownership and cost honesty

- Present fixed, conditional, referenced, and not-visible categories with provider-specific confidence.
- Let people deliberately select, withhold, or edit context only where Otto owns the input. A provider-native or unavailable item has explanation and upgrade/remediation state, not a fake toggle.
- Show the exact compact Knowledge catalog and its cost where Otto injects it; preserve pull-on-demand full page access and never claim full root/page bodies were sent unless they were.
- Keep prompt preview, reported token accounting, and agent runtime input tied to the same composition path.

### 5. Technical-review journey

A reviewer can inspect initialized evidence, open and refine the relevant root or record, deliberately choose the durable/context inputs available to the selected provider, inspect the prompt representation and cost, conduct a technical review, and create only a proposed durable conclusion. Confirmation remains an explicit human decision.

### 6. Knowledge Health and integrity

- Expand Health only with actionable, evidence-backed signals: stale review, atomic-page overlap, wiki-link integrity, missing/deleted external selections, and bootstrap evidence gaps.
- Link lint covers live roots and confirmed compiled truth; it never rewrites historical timeline evidence.
- Make deleted selections clear visibly and refresh context summary/cost after Otto mutations or observed external changes.

### 7. Compatibility, protocol, provider, and authorization

- Preserve backward-compatible wire schemas. Any new daemon capability uses `server_info.features.*`, centralized client gating, dotted request/response names, and no legacy fallback.
- No provider auth or credential scope belongs to this feature. Provider capability affects only what Context Management can truthfully observe or control.
- The daemon remains the single owner of Knowledge resolution, storage mutations, context composition, and refresh invalidation.

### 8. Documentation and proof

- Update `docs/project-knowledge.md`, `docs/context-management.md`, and the documentation index for shipped behavior only.
- Add every user journey to `projects/e2e-qa-coverage/coverage-matrix.md`. T1 proves deterministic onboarding, selection, review boundaries, error/retry, and storage behavior. T2 proves the local openai-compatible technical-review loop with observable side effects, not model prose.
- Run targeted service/protocol/app checks, link lint after Knowledge changes, and record only verified evidence in this charter.

## Plan-completeness and feature-completion standard

This charter distinguishes two questions that must never be collapsed:

1. **Is the plan complete?** Every end-user capability claim has an owner, a visible journey, a durable-data boundary, an explicit limitation or recovery path, a compatibility decision, and a named proof requirement.
2. **Is the feature complete?** Every row in the completion matrix is implemented, documented at its actual maturity, and supported by its required proof. A rendered screen, unit test, or protocol schema alone does not complete a row.

A plan is incomplete if any capability is only implied by a neighboring subsystem, if a provider/host limitation is unnamed, if an end-user document could not state whether a claim is available versus planned, or if a failure path has no owner. The feature is incomplete until every row marked **Required for 0.9** has its stated T1 proof and the technical-review loop has its T2 local-AI proof.

### End-user capability-claim taxonomy

Every user-facing document, release note, and UI label must classify a claim as one of:

| Claim class | Meaning | Documentation rule |
| --- | --- | --- |
| **Proven** | A supported journey has passed its stated automated or controlled-live proof. | State it as available and link to its recovery/limitation behavior. |
| **Implemented, not yet proven** | Code exists but the declared journey has not passed its required proof. | Do not present it as a completed product promise. Keep it in internal planning, a clearly labelled preview, or release notes only when its evidence is explicit. |
| **Provider or host limited** | Otto deliberately cannot observe or control the input for every provider/host. | State what is exact, estimated, or not visible, and why no control is offered. |
| **Planned** | The charter owns the outcome but code or proof is absent. | Do not describe it as current behavior. It may appear in a roadmap with its boundary. |
| **Out of scope** | The outcome is deliberately excluded from 0.9. | Do not imply it through adjacent terminology or screenshots. |

The future end-user guide is acceptable only when a reader can answer: what was initialized, where it lives, what an agent actually received, what is merely available to read, what the person may change, what happens on failure, and which limits belong to their provider rather than Otto.

### Completion matrix

| Capability and end-user question | Required 0.9 outcome | Failure/recovery contract | Required proof | Current state |
| --- | --- | --- | --- | --- |
| **Entry and orientation:** Where do I start, and what can I do here? | Manage Knowledge and Context Management are reachable from a workspace with loading, unavailable, empty, and retry states; onboarding exposes the six drafts and their next action. | A host without the needed capability says to update it; loading/error states retain no misleading stale result. | T1 navigation and state journey with a money shot. | Partial: existing tabs exist; onboarding journey is not proven. |
| **Bootstrap evidence:** What did Otto discover, and what did it refuse to infer? | Initialization creates six explicitly draft roots with source-linked evidence and missing-evidence disclosure. Generated material is never represented as confirmed truth. | Sparse, malformed, missing, or unreadable sources remain visible as gaps; rerun is idempotent; authored roots are preserved. | T1 service tests for populated and sparse repositories, malformed manifest, idempotence, preservation, repository/host parity, and no full-body injection. | Partial: deterministic code/docs draft collector, preservation, and repeat bootstrap are focused-tested; sparse/malformed/host/no-injection proof remains open. |
| **Storage and portability:** Where does Knowledge live and who sees it? | The UI explains repository versus host storage, default/override resolution, sharing trade-off, worktree behavior, and an intentional carry-pages choice. | A failed or declined migration preserves the source store; no silent repository deletion or duplicate source of truth. | T1 resolver/migration/UI journey, including worktree and both storage locations. | Partial: resolver and migration behavior exist; end-to-end completion proof remains open. |
| **Roots versus atomic records:** What can I review or change? | Roots are durable architectural documents; atomic pages have proposed/confirmed/superseded lifecycle, evidence, and reason-bearing truth changes. The UI makes the distinction explicit. | Concurrent changes produce a base-stale response; atomic pages retain history; roots are not falsely given record status. | T1 lifecycle and concurrent-write tests plus rendered UI proof. | Partial: storage/protocol support exists; full reviewed UI journey is not proven. |
| **External changes:** What happens when Git or an editor changes Knowledge? | Open Knowledge and Context Management views refresh their lightweight catalog/cost, update the selected document when present, and clear a deleted selection visibly. | External edit, checkout, pull, malformed file, and deletion never leave a stale document presented as canonical; recovery is refresh/retry or actionable error. | T1 daemon watcher/subscription and UI journey for edit, pull/checkout, and deletion. | Planned/unproven. |
| **Knowledge Health:** How do I know whether the record is trustworthy? | Health surfaces actionable stale-review, atomic-overlap, unresolved-link, missing-selection, and bootstrap-evidence-gap signals without presenting them as facts. | Link lint does not mutate timeline history; a deleted/repaired target refreshes the signal. | T1 deterministic health and link-integrity coverage plus UI visibility. | Partial: stale/overlap and live-link lint exist; breadth and UI/recovery proof remain open. |
| **Actual prompt input:** What did the active agent receive? | Context Management shows the compact Knowledge catalog separately from full pages, fixed/conditional/referenced categories, and the prompt preview from the same composition path. | A referenced file is never counted as loaded; full root/page bodies are never claimed as injected unless the runtime actually sent them. | T1 report/preview parity tests and visible prompt/cost journey. | Partial: composition and reporting exist; end-to-end journey is not proven. |
| **Deliberate selection:** What can I include, withhold, or edit for this task? | A person can select or withhold durable knowledge/context only where Otto owns the input, and the effect on the actual prompt is visible. | Unsupported inputs are explanation-only, never fake toggles; a stale file change requests refresh rather than applying a wrong edit. | T1 selection/withhold/recovery journey. | Planned for durable Knowledge; context-file controls are only partial proof. |
| **Cost and confidence:** How much context does this use, and how certain is Otto? | Cost shows the active model window percentage and per-category contribution. Every reading is labelled exact, estimated, or not visible by provider capability. | Failed measurement reduces confidence without hiding the category or inventing a numeric result. | T1 provider-visibility and cost-parity matrix; T2 confirms a local openai-compatible prompt loop. | Partial: provider-aware reporting exists; matrix and T2 proof remain open. |
| **Provider/host ownership:** Why is a control absent? | Context actions exist only for Otto-owned inputs. Provider-native/system/tool inputs display their actual limitation or upgrade boundary, and no auth/secret flows are introduced. | Old hosts receive one centralized upgrade state; no fallback path fans out across legacy RPCs. | Protocol compatibility test and T1 capability-gate UI journey. | Partial: ownership model exists; feature-level capability/upgrade proof remains open. |
| **Technical review:** Can I get from evidence to a deliberate durable conclusion? | The reviewer inspects evidence, chooses available context, reads prompt/cost, performs the review, creates a **proposed** conclusion, then explicitly confirms or supersedes it. | Review application is conditional; rejected/failed/refined work does not silently become active knowledge. | T1 deterministic review lifecycle and T2 local-AI side-effect journey, both with visual evidence. | Planned/unproven as an end-to-end journey. |
| **Documentation:** Does the guide describe the real product? | Documentation presents the capability taxonomy, storage choices, lifecycle, prompt-input distinction, provider limits, recovery, and proof status accurately. | No wording claims Git-history synthesis, AI-authored analysis, cross-provider control, or technical-review completion before proof. | Documentation review against this matrix and targeted user-journey screenshots. | Partial: core Project Knowledge and Context Management docs exist; end-user capability guide is not yet authored. |
| **Release proof:** Can we defend “complete”? | Every required matrix row appears in the E2E coverage matrix with T1 status; model/daemon-sensitive rows have T2 or an explicit release exception. | A missing, stale, or unmapped spec fails coverage validation; a failed T2 stays visible as incomplete rather than being converted into prose. | `npm run e2e:coverage`, targeted T1 runs, T2 run report, and release reconciliation. | Planned: current coverage matrix has only an unimplemented Manage Knowledge row and no dedicated technical-review T2 row. |

### Questions that must be answered before the plan can pass review

- What exact onboarding entry point invokes bootstrap, and can a person retry it without an agent session?
- Which source categories are safe for deterministic collection, and where does Git-history evidence belong without turning a commit log into a fabricated roadmap?
- What provenance must each generated draft show so a reviewer can distinguish a file-existence observation from an architectural conclusion?
- How are source paths and document contents handled when a host-local store is used against a repository the current client cannot open?
- What observable event invalidates Knowledge after editor saves, Git pull/checkout, and store-location migration, and how are missed watcher events reconciled?
- Which durable Knowledge units can be selected or withheld for one task without violating the pull-on-demand catalog contract?
- For each provider family, which prompt sections are exact, estimated, unavailable, or editable, and what changes at an old-host capability boundary?
- What is the smallest deterministic T2 local-AI review task whose success can be asserted from a durable side effect rather than model prose?
- Which Health findings are useful enough to surface without creating duplicate records, false certainty, or a noisy maintenance dashboard?
- What examples, screenshots, and recovery instructions let an end user understand the product without mistaking planned 0.9 work for a shipped capability?

### Assertion audit and acceptance-proof strategy

We test this feature in two deliberately separate passes.

#### Pass A: current-state assertion audit

Before implementing a remaining slice, turn every statement in **Verified baseline** and the completion matrix into a testable assertion. The audit outcome is not “works” or “does not work”; it is **Proven**, **Implemented, not yet proven**, **Contradicted**, or **Not applicable to this provider/host**. The resulting claim ledger names the production paths, test file, command, observed evidence, and maturity classification for each assertion.

| Existing assertion | Assertion test | Required observed evidence | If it fails or is absent |
| --- | --- | --- | --- |
| Repository/host resolver uses override → existing repository store → host default, with worktree root collapse. | Focused resolver and migration unit tests with repository and host temp stores. | Resolved base path, store location, marker/migration result, and preserved source pages. | Downgrade the charter claim, then repair the resolver before building UI on it. |
| Bootstrap creates useful drafts from observable evidence and preserves human work. | Focused `ProjectKnowledgeService` tests for populated, sparse, malformed, and unreadable source inputs; idempotence and preservation checks in both store locations. | The six rendered root bodies, named source facts/gaps, no overwrite, and no raw invented conclusion. | Treat the corresponding draft source as unavailable, not as a cosmetic fallback. |
| Records and roots have distinct review semantics. | Service and session tests for proposed/confirmed/superseded records, timeline reason, stale conditional mutation, and root body-digest conflict. | Persisted Markdown, response payload, status transition, and retained timeline history. | Block refinement UI acceptance; a review state that cannot survive a concurrent edit is unsafe. |
| Compact catalog is pull-on-demand and confirmed-only. | Service/context tests that load a large root/record corpus and compare brief, full read, prompt preview, and `projectKnowledgeTokens`. | Brief excludes full root/page bodies and inactive records; full text appears only after an explicit read; token count matches the injected brief. | Treat prompt/cost documentation as false and fix composition before adding selection controls. |
| Context categories and provider confidence are honest. | Deterministic provider/runtime fixtures for an Otto-owned payload and a provider-native/unavailable payload. | Exact, estimated, and not-visible classifications; no editable control for an unowned category. | Mark the provider capability limited and withhold the control rather than adding a fallback. |
| Health and link integrity are actionable and non-destructive. | Deterministic stale/overlap/link tests, including deletion and a historical timeline containing an obsolete link. | Live root/current-truth finding changes; historical timeline unchanged. | Keep the signal internal until it is accurate enough to guide a user. |
| Daemon-originated mutations refresh views and context cost. | Session tests followed by T1 UI assertions. | New catalog/version and refreshed context report after create/update/status/root mutation. | Do not claim live Context Management cost after Knowledge mutation. |
| External edits, Git changes, and deletion refresh open surfaces. | Real isolated daemon T1 test that changes canonical files outside Otto, including edit, checkout/pull-equivalent replacement, malformed file, and deletion. | Debounced update, selected-document refresh or explicit cleared state, and refreshed context summary. | Keep this row Planned; polling or a stale view is not a substitute. |
| Manage Knowledge and Context Management are usable by an end user. | Targeted Playwright T1 navigation/state test, seeded through the real daemon. | Reachable tabs, six roots, records, Health states, loading/error/retry/unavailable presentation, and a money shot per claim. | Do not describe the subsystem as a complete end-user surface. |

The audit runs narrow tests only. It does not use a full-suite run as evidence. Each completed audit writes only a stable charter evidence entry or updates the matrix state; a failed hypothesis stays in the task record unless it establishes a reusable finding.

#### Pass B: feature acceptance proof

When the missing slices are implemented, prove them through the repository’s two allowed test forms: focused unit tests with injected ports, then real browser/daemon end-to-end tests. Browser E2E uses the existing three tiers.

| Proof level | Purpose in this feature | Required scenarios |
| --- | --- | --- |
| **Focused unit/service and protocol tests** | Prove deterministic storage, source collection, lifecycle, link, context-composition, and compatibility invariants cheaply. | Resolver precedence and migration; bootstrap source/gap handling; no-overwrite/idempotence; root versus atomic semantics; stale conditional writes; catalog-only injection; token/report-preview parity; provider visibility classification; wire compatibility for optional additions. |
| **T1 mock browser E2E** | Prove the complete user-visible daemon and UI plumbing with deterministic behavior. | Create/resolve project store → initialize → inspect all six evidence drafts → see source/gap state → open prompt/cost view → select/withhold an Otto-owned input → verify changed preview/cost → review/refine → retain a proposed conclusion → explicitly confirm/supersede it. Add separate recovery journeys for unsupported host, missing/malformed evidence, store migration choice, external edit/deletion, stale review conflict, and provider-owned unavailable context. Each behaviour gets a coverage-matrix row and `moneyShot()`. |
| **T2 local-AI browser E2E** | Prove the real tool loop, not the quality of model prose. | A pinned local openai-compatible agent receives the compact catalog, explicitly reads a relevant Knowledge page through the daemon tool, and produces one deterministic durable side effect, for example a proposed atomic record with an exact title/evidence marker. Assert the record, tool-call row, prompt/report classification, and review state in the UI or canonical Markdown. Cap tool rounds and use one retry only. |
| **T3 real-provider, only if needed** | Prove a provider-specific payload/visibility claim that T2 cannot establish. | Minimal scoped provider path, asserting protocol-visible/tool side effects rather than text. It is not a gate for shared daemon behavior. |
| **Manual/native release checks** | Cover behavior that Playwright web cannot exercise. | Desktop-specific file-opening/location disclosure and any native-only storage or external-editor recovery behavior, captured under the release runbook. |

#### Release acceptance scenarios

The release is not ready until these observable stories pass:

1. **First knowledge:** a new repository with a manifest, README, docs, and workspace layout produces six draft roots whose named evidence can be inspected. A sparse or malformed repository says what is absent, and rerunning does not overwrite a person’s revision.
2. **Storage choice:** a person understands repository versus host ownership, changes location deliberately, either carries pages explicitly or leaves the source untouched, and a worktree sees the same project truth.
3. **Truth versus availability:** a large confirmed Knowledge corpus exposes only its compact catalog in the active prompt. Context Management shows the actual catalog cost; a full page becomes visible only after deliberate read.
4. **Provider honesty:** an Otto-owned context input can be changed and visibly changes the preview/cost. A provider-owned input explains that it is unavailable or not visible and offers no deceptive toggle.
5. **Review to record:** a person inspects evidence, reviews/refines a root or record through a conditional daemon commit, sees a concurrent-change conflict safely, and retains a proposed conclusion only. Explicit confirmation is a separate act.
6. **Change and recovery:** an Otto write, an external file edit, a Git replacement, and a deletion each refresh or visibly clear the appropriate Knowledge and Context surfaces without displaying stale canonical content.
7. **Technical review with a real loop:** the local agent reads relevant Knowledge on demand and creates the asserted proposed conclusion. The test proves tool invocation and durable state, never summary wording.

#### Evidence and stop rules

- Every scenario has one coverage-matrix row, its owning spec path, tier, priority, and money-shot claim before it can be marked covered.
- Unit/protocol green without T1 is implementation evidence, not end-user completion. T1 green without T2 is insufficient for the model-dependent technical-review loop.
- A source-code read, a screenshot without an assertion, a model’s prose, and an auto-captured teardown frame are not acceptance evidence.
- A provider/host limitation may close a row only when the UI describes the limitation accurately and the release ledger records why the common journey cannot run there.
- We stop an implementation slice when its declared T1/T2 claim is proven or when an observed contradiction changes the charter. We do not enlarge a slice merely because the next row is adjacent.

### Decision rule

At each review, maintain the matrix rows as **Proven**, **Implemented, not yet proven**, **Provider or host limited**, **Planned**, or **Out of scope**. We may answer “the plan is complete” only when every desired end-user claim belongs to exactly one row, every required row names its proof and recovery behavior, and the unresolved-question list contains no question that could change a product boundary. We may answer “the feature is complete” only when every required row is Proven and the release evidence is green.

## Delivery sequence

1. **Evidence-backed root bootstrap:** deterministic source inventory and useful draft roots, preserving stores and pull-on-demand semantics.
2. **Onboarding exposure and Health:** reachable UI state, bootstrap progress/failure/retry, source provenance, external-change subscription/deletion handling, and T1 journey.
3. **Reviewed document refinement:** root and atomic review/annotation/diff/apply experience with conditional daemon commits and capability gate.
4. **Deliberate Context Management:** provider-owned selection/withhold controls, truthful prompt/cost visibility, and recovery states.
5. **Technical-review proof:** T1 completion matrix plus T2 local-AI evidence, documentation, and release reconciliation.

## Explicit non-goals

- Injecting every root or page into every model request.
- Treating repository-owned and host-local Knowledge as two products.
- Granting fake Context Management controls over provider-native inputs.
- Auto-confirming generated drafts or AI conclusions.
- Replacing external file editing or Git history with a second Knowledge store.
- Broad model-authored project analysis without verifiable evidence and review.

## First implemented slice

Delivery sequence item 1 is implemented and focused-tested: deterministic code-and-documentation evidence produces initial root drafts, legacy ceremonial placeholders upgrade in place, repeat bootstrap is idempotent, and reviewer roots are preserved. The slice does not claim sparse-repository proof, host-store parity, UI exposure, external-edit subscription, Git-history synthesis, provider control, or T2 completion.

## Timeline

- time: "2026-08-27T00:35:29.257Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["reviewed-project-knowledge-refinement","e2e-qa-coverage"]
- time: "2026-08-27T00:35:29.257Z"
  kind: "evidence"
  summary: "Initial 0.9 charter created from user direction and the existing Otto implementation/Knowledge inventory on 2026-08-26. This charter is confirmed as the feature-level planning record and will be expanded with verified current-state and delivery evidence."
- time: "2026-08-27T00:35:57.268Z"
  kind: "decision"
  summary: "Avoid linking the confirmed 0.9 charter to an existing refinement charter that remains proposed; its scope is noted without treating it as confirmed dependency."
  source: "Knowledge reconciliation, 2026-08-26"
- time: "2026-08-27T01:47:15.061Z"
  kind: "decision"
  summary: "User requested the feature charter be expanded after source-level inspection and adversarial completeness review; the revised inventory separates verified baseline, delivery boundaries, omissions, dependencies, non-goals, and the first scoped implementation slice."
- time: "2026-08-27T01:53:02.570Z"
  kind: "decision"
  summary: "Implemented and focused-tested the first delivery slice: bootstrap now writes deterministic source-linked root drafts while preserving reviewer content and pull-on-demand behavior. The charter must no longer describe the old ceremonial placeholder as current behavior."
- time: "2026-08-27T01:53:37.266Z"
  kind: "note"
  summary: "Completed delivery slice 1 only: deterministic bootstrap drafts now use directly observed code/documentation evidence, upgrade the legacy ceremonial placeholder without overwriting a reviewer root, and repeat idempotently. Focused service test and targeted lint passed; UI/T1 journey, host-store parity, external-edit refresh, review UX, Context Management controls, and T2 remain open."
  affects: ["project-knowledge-context-management"]
- time: "2026-08-27T01:53:45.148Z"
  kind: "evidence"
  summary: "Verified on 2026-08-26: `npx vitest run packages/server/src/server/agent/project-knowledge/project-knowledge-service.test.ts --bail=1` passed (43 tests across 2 files), including populated repository evidence drafts, reviewer-root preservation, and repeat-bootstrap idempotence. Targeted `npm run lint -- …project-knowledge-service.ts …test.ts …types.ts` and `git diff --check` passed. Repository-wide typecheck remains blocked by unrelated in-progress Kanban `boardOwner` errors in `packages/server/src/server/session.ts` and unrelated app review-path errors; no Project Knowledge bootstrap type error remained after the current shared worktree settled."
  source: "packages/server/src/server/agent/project-knowledge/project-knowledge-service.ts; packages/server/src/server/agent/project-knowledge/project-knowledge-service.te"
- time: "2026-08-27T02:01:26.573Z"
  kind: "decision"
  summary: "User requested a defensible definition of plan completeness. The charter now maps every end-user capability claim to outcome, boundary, recovery, proof, maturity, and unresolved decision so future reviews can distinguish a complete plan from a complete feature."
- time: "2026-08-27T02:03:39.069Z"
  kind: "decision"
  summary: "User asked how current capability assertions and final feature completion will be tested. The charter now separates a reproducible claim audit from layered end-user acceptance proof, with scenarios, evidence, and stop rules."

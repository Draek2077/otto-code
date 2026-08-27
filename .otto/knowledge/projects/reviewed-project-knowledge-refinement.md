---
id: "reviewed-project-knowledge-refinement"
kind: "project"
title: "Reviewed Project Knowledge refinement"
status: "proposed"
tags: ["project-knowledge","refine","markdown","review","ui"]
delivery_status: "complete"
progress_completed: 5
progress_total: 5
progress_unit: "delivery slices"
created_at: "2026-08-26T23:59:34.477Z"
updated_at: "2026-08-27T01:55:47.883Z"
---
# Reviewed Project Knowledge refinement

<!-- compiled_truth -->

# Reviewed Project Knowledge refinement

## Outcome

A person can review an atomic Project Knowledge record as rendered Markdown, select text, attach one or more in-memory **Replace** or **Refine** annotations, and open a dedicated Refine job tab. The job produces a whole-document proposal and a base-pinned, per-hunk diff. Nothing changes until the person accepts selected hunks.

Applying the accepted result updates only the record's current understanding through a daemon-owned conditional transaction. When the record was confirmed, that same transaction returns it to proposed and records the refinement in the append-only timeline. The updated record is therefore no longer injected into normal future agent context until a human explicitly confirms it again.

## Scope

- Atomic Project Knowledge records across Knowledge, Projects, and References.
- The mutable target is the record's compiled truth/current-understanding body only.
- Evidence, metadata, timeline, title, and status controls remain outside the AI rewrite blast radius.
- Review annotations are session-local to the active Project Knowledge article. They are discarded after entering Refine, on explicit discard, or after an acknowledged leave-with-discard confirmation.
- The Project Knowledge tab and the Refine tab coexist. Applying a result refreshes the still-open Knowledge tab.
- The six Project Knowledge root pages are included. They use the same review and Refine experience, but apply their result as a conditional daemon-owned root-body update. Root pages retain their existing updated timestamp and, when the store is repository-owned, repository Git history; v1 does not invent a per-edit timeline or author record where Otto has no reliable identity source. They do not gain a new proposed/confirmed lifecycle.

## Interaction design

1. **Start review.** The Project Knowledge document toolbar enters Review mode. A compact review strip identifies the active article, shows annotation count, and exposes its one accent action, **Refine with AI**.
2. **Annotate rendered text.** Selecting readable text reveals a trigger-anchored choice with two explicit modes:
   - **Replace**: the user supplies the exact replacement. It is a direct, protected correction; the model must not rewrite it.
   - **Refine**: the user supplies an instruction describing how the selected wording or claim should improve.
3. **Make intent legible.** Replace and Refine annotations use distinct, theme-aware semantic highlight tints and matching slim edge markers. They are quiet in the reading state, clear when selected, and editable or removable from their anchored popup. Destructive red is reserved for discarding/deleting, never for an annotation kind.
4. **Review the proposal.** Refine opens a job tab titled for the article review. The existing Refine hunk review is reused: the diff remains against the original base on every regeneration, comments drive the prompt, and acceptance remains explicit.
5. **Apply safely.** A record application checks the record's pinned update timestamp, changes only the statement, appends a concise review provenance entry, and demotes confirmed to proposed. A root application conditionally replaces only the root body. Root pages have no review-status transition; their durable history is repository Git when the store is repository-owned. A stale target is not overwritten. The Knowledge tab refreshes and clearly states when a refined record requires human confirmation before future agents reuse it.

## Data and safety model

Each in-memory annotation holds its kind, selected prior text, a small surrounding quote for unambiguous matching, and its replacement or instruction. It deliberately does not persist DOM ranges or source offsets. A direct replacement is resolved and protected before generation; an ambiguous or unavailable quote blocks generation and asks the reviewer to widen or revise the selection.

The Refine prompt is composed on the daemon. It receives the article statement and review directives as data, treats the article as untrusted content, must return only the requested document, and may not invent new record fields or rewrite protected direct replacements. Current truth, evidence, metadata, and history are separately framed read-only context when useful.

No raw file write may update Project Knowledge. The Refine session's normal file accept path is not used for this origin.

## Architecture

- Introduce a generic, pure review-directive model in the Refine domain so future surfaces, including Context Management, can reuse its prompt and selection semantics without inheriting Project Knowledge UI.
- Add a capability-gated Project Knowledge refinement entry point and a new dotted request/response pair for atomic application. Do not create a fallback on older hosts.
- The daemon owns conditional mutation, record status demotion, and root-body writes. The client owns ephemeral annotation state and tab navigation.
- Existing Refine owns proposal generation, regeneration, hunk grouping, per-hunk keep/drop decisions, and the no-write-before-accept invariant.
- The Project Knowledge panel owns document rendering, Review mode, annotation interaction, and reloading after application.

## Delivery sequence

1. Establish the types, review-session reducer, quote-resolution helpers, direct-replacement protection, and focused tests.
2. Build the Project Knowledge Review mode and its polished rendered-document annotation affordances.
3. Extend the Refine job origin and prompt pipeline for Knowledge review directives, preserving the normal Refine tab's established diff experience.
4. Add the capability-gated daemon application RPCs, atomic record confirmed-to-proposed transition, conditional root-body write, provenance text, stale-write behavior, and client refresh.
5. Verify interaction, accessibility, compact layouts, theme states, stale/error states, and documentation.

## Acceptance criteria

- A reviewer can add, edit, and remove both annotation kinds without leaving the rendered article.
- Replace and Refine are visibly distinct in all supported themes and remain legible without relying on color alone.
- Replace text reaches the final proposal unchanged; Refine instructions affect the relevant text without widening the editable target beyond the statement.
- The reviewer sees and controls every hunk before application; closing the Refine tab changes nothing.
- Applying a refinement to a confirmed record atomically updates it, writes timeline provenance, and sets it to proposed.
- Applying a stale proposal never overwrites newer Knowledge.
- A proposed refined record is excluded from normal future Knowledge injection until a human explicitly confirms it.
- Root-page refinements change only the body; their updated timestamp and repository Git history remain the v1 audit trail. They do not present a record-status control.
- The originating Project Knowledge tab refreshes after a successful application and shows the resulting proposed status for records or updated state for roots.
- Focused unit, browser, daemon/protocol, and relevant E2E coverage pass; targeted lint and typecheck pass.

## Deferred

- Durable review-comment threads.
- Review annotations that survive leaving an article.
- Cross-article / multi-record refinement working sets.
- Multi-person pending revision promotion.
- Context Management review annotations. Its future reuse is enabled by the shared directive model, not included in this delivery.

## Timeline

- time: "2026-08-26T23:59:34.477Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-26T23:59:34.477Z"
  kind: "evidence"
  summary: "User product direction and decisions in chat on 2026-08-26: in-memory Replace and Refine text annotations; use Refine's accepted-diff workflow; applying a confirmed record's refinement returns it to proposed; root pages are deferred because they have no review status."
- time: "2026-08-27T00:36:55.717Z"
  kind: "decision"
  summary: "User expanded first-release scope: Project Knowledge root pages must be reviewable and refinable. Roots retain store/Git history rather than gaining a proposed/confirmed lifecycle."
  source: "User decision, 2026-08-26"
- time: "2026-08-27T00:37:01.093Z"
  kind: "evidence"
  summary: "User clarified that architectural and other Project Knowledge root pages must be included in the first release. They are permanent changes with existing store/Git history, not records that need a new proposed/confirmed lifecycle."
  source: "User decision, 2026-08-26"
- time: "2026-08-27T00:37:29.061Z"
  kind: "decision"
  summary: "Clarified root-page audit scope: v1 uses the existing updated timestamp and repository Git history for repository-owned stores, and does not create an unreliable per-edit author/timeline model."
  source: "User direction and implementation-boundary decision, 2026-08-26"
- time: "2026-08-27T01:40:56.867Z"
  kind: "note"
  summary: "Implementation authorized by the user on 2026-08-26."
  affects: ["reviewed-project-knowledge-refinement"]
- time: "2026-08-27T01:55:47.883Z"
  kind: "note"
  summary: "Implemented and verified the reviewed Project Knowledge refinement flow: capability-gated atomic apply, in-memory replace/refine directives, Refine-tab handoff, root-page stale guard, and focused tests."
  affects: ["reviewed-project-knowledge-refinement"]

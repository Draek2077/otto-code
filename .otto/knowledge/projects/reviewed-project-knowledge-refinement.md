---
id: "reviewed-project-knowledge-refinement"
kind: "project"
title: "Reviewed Project Knowledge refinement"
status: "proposed"
tags: ["project-knowledge","refine","markdown","review","ui"]
delivery_status: "partial"
progress_completed: 4
progress_total: 5
progress_unit: "milestones"
created_at: "2026-08-26T23:59:34.477Z"
updated_at: "2026-10-25T23:59:36.659Z"
---
# Reviewed Project Knowledge refinement

<!-- compiled_truth -->

# Reviewed Project Knowledge refinement

## Outcome and final product direction

Review remains inside the Project Knowledge article. The final user direction in this page's historical timeline supersedes the earlier proposal for a generic Refine job tab. A person selects rendered article text, adds in-memory **Replace** or **Refine** annotations, generates a proposal, and keeps or drops individual hunks against the original saved base. Nothing is written until an explicit, reason-bearing human application.

The mutable target is only a record's current-understanding body or one of the six root bodies. Record metadata, title, evidence, history and review controls remain outside generation authority. Applying changed confirmed truth atomically returns it to Draft through the canonical daemon operation. It stays out of normal confirmed Knowledge discovery until a human confirms it again. Roots retain their existing lifecycle and repository history; no record status or invented author identity is added.

## Otto 0.10 implementation

The reviewed restoration is integrated on `otto-0.10/phase-0`, not left in a child workspace. The article owns Review mode, source-backed rendered selection, editable annotations and model choice through the existing combined provider/model selector. Web annotations use quiet semantic highlights and markers with a trigger-anchored editor; compact/native presentations use existing sheets and source-block markers. Exact native text selection is accepted only when its source quote is uniquely resolvable. Ambiguous or transformed text is refused instead of guessing an edit location.

An installation-owned review registry retains local article-scoped drafts across route departure and return. It is bounded to sixteen reviews and is neither a canonical data cache nor durable review-comment storage. Explicit discard removes a review. Leaving the route never applies it. Hide/unmount invalidates late generation, confirmation and write acknowledgments; an unknown write outcome requires reopening saved truth before another application.

**Replace** is the exact user correction, including an explicit empty replacement for deletion. **Refine** is an instruction for its selected source range. Both kinds can be added, edited and removed without leaving the article. Annotation kind is labeled as well as tinted. Overlapping, stale or ambiguous ranges cannot generate a proposal.

The daemon's additive capability and dotted `knowledge.project.refinement.propose.request` boundary validate the canonical project binding, pinned target digest, working article and exact source scopes. The provider-neutral structured-generation service uses the chosen provider/model first and the host's normal fallback order, without persisting an internal chat. Only Refine scopes and short surrounding context enter generation. Direct replacements are protected and excluded from model authority; unknown, duplicate or missing returned scope IDs are rejected. No generation step writes Knowledge.

The complete proposed body is shown as a diff against the original saved base. Per-hunk keep/drop decisions control the result; **Refine kept result** starts another annotation round using the kept working body while retaining that original diff base. Line/word diff work is bounded. Oversized matrices or long individual lines become one explicit whole-article decision rather than truncating content or pretending to provide fine-grained hunks. CRLF and trailing-newline behavior are preserved.

**Apply kept changes** requires a reason and human confirmation, then calls the existing conditional record/root write. Peer changes reject application. Metadata, evidence, unknown fields and earlier provenance survive. A changed confirmed record is demoted and the canonical article refreshes; roots remain roots. No model or MCP tool automatically confirms a conclusion. There is no generic file-accept path for this origin.

## Verification

Implementation commits `0c98560ef`, `6e3fad26c` and `edbd2cb49` have focused backend, actual host, app-model/diff/source-owner and additive-capability evidence: 60 cases, strict fixture declarations, owning builds/typechecks and normal hooks. A real React-compiler transform exposed an incorrectly memoized external-store lookup; the selected review model is now the actual useSyncExternalStore snapshot.

At exact `edbd2cb497bd940556d9c249c59f98759cec1439`, [all 21 CI jobs passed](https://github.com/Draek2077/otto-code/actions/runs/40244667189), [all 38 app journeys passed](https://github.com/Draek2077/otto-code/actions/runs/40244666232), and [all sixteen Knowledge journeys passed](https://github.com/Draek2077/otto-code/actions/runs/40244669923). The new wide and compact rendered journeys exercise actual DOM selection, note editing, proposal generation for direct replacements, no write before application, hunk dropping, declined/accepted confirmation, shared MCP parity, preserved metadata/history, Draft demotion, and stale root blocking after an external edit. Downloaded screenshots were inspected for article gutters, constrained wide layout, theme tints and visible diff controls.

These are real browser/isolated-daemon and injected provider-boundary proofs. They do not establish a live model response, native selection/animation/device acceptance, every theme, or current-source product builds. Newer unrelated Kanban/helper revisions require their own CI evidence. The final acceptance checkpoint remains open; the feature is not marked complete by these results.

## Retained acceptance and limits

- The reviewer sees and controls every hunk; generation, route departure and discard never change saved truth.
- Direct corrections stay exact and model edits stay within approved prose scopes.
- Confirmed records become Draft on changed application and require explicit human reconfirmation.
- Stale targets never overwrite newer Knowledge; roots gain neither a status control nor invented author/timeline semantics.
- Desktop and compact UI, keyboard/accessibility, supported themes, native behavior and exact-source CI/build evidence remain part of final product acceptance.
- Durable comment threads, multi-article working sets, multi-person pending promotion and F05 Context Management are deferred. This implementation does not restore those separate features.

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
- time: "2026-08-27T02:26:53.602Z"
  kind: "note"
  summary: "The user redirected the feature away from the generic Refine tab. The atomic Knowledge write foundation remains, but the review UI and generation flow are being rebuilt as a dedicated Knowledge experience with a proper Markdown editor."
  affects: ["reviewed-project-knowledge-refinement"]
- time: "2026-08-27T02:57:43.222Z"
  kind: "note"
  summary: "Dedicated reviewed-Knowledge refinement, source-anchored annotation UI, two-pass proposal/apply flow, and Markdown authoring are implemented and pass focused verification. The final rendered interaction pass remains pending because this session has no in-app browser available."
  affects: ["reviewed-project-knowledge-refinement"]
- time: "2026-10-25T23:59:36.659Z"
  kind: "decision"
  summary: "Reconcile the authorized Otto 0.10 restoration with verified implementation and rendered acceptance on edbd2cb49. Preserve the user's final dedicated Knowledge direction from the existing timeline; retain native/live-model/final-product gates and do not confirm or mark the feature complete."
  source: "Commits 0c98560ef, 6e3fad26c, edbd2cb49; GitHub Actions 40244667189, 40244666232, 40244669923; existing user-directed dedicated Knowledge timeline."

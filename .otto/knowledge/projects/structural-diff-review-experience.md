---
id: "structural-diff-review-experience"
kind: "project"
title: "Structural diff review experience"
status: "confirmed"
tags: ["developer-experience", "diffs", "refactor", "code-review", "difftastic"]
delivery_status: "partial"
progress_completed: 2
progress_total: 6
progress_unit: "delivery slices"
created_at: "2026-08-13T00:07:23.667Z"
updated_at: "2026-08-13T06:59:37.644Z"
---

# Structural diff review experience

<!-- compiled_truth -->

# Outcome

Give Otto one exceptional, consistent diff-review experience across every user-visible diff surface.

Users can choose a classic **Line** diff or a Difftastic-style **Structural** diff as their persisted default in Settings, and switch views locally while reviewing any capable diff. This is an independent project with no dependency on Vim, Neovim, or terminal work.

## What “Structural” means

Structural is the review presentation users value in Difftastic:

- Side-by-side old and new code.
- Corresponding functions, blocks, arguments, objects, and expressions aligned even when formatting or line boundaries change.
- Meaningful syntax fragments highlighted in context rather than a wall of added and removed rows.
- Reformatting and line-wrap churn de-emphasized.
- Reliable navigation back to the source and a clear representation of moves, additions, removals, and modifications.

It does **not** simply mean invoking `difft`, adopting its ANSI colors, or changing a user's global Git configuration.

## Scope

### Phase 1 — Audit and quality bar

Inventory every user-visible diff surface:

- Changes sidebar and main Changes viewer
- File history
- Refactor/Refine hunk preview and review
- Tool and edit cards
- Any other inline diff

For each, record the source data, renderer, line mapping, syntax highlighting, layouts, folding, review actions, accessibility, platform behavior, and binary/large/invalid-diff handling.

The full Changes viewer is the current quality benchmark. Refactor/Refine must be reviewed first: it currently uses a smaller shared renderer and must be raised to review-grade parity for its supported scope or deliberately open/reuse the main viewer. Cosmetic restyling is not sufficient.

### Phase 2 — Consolidate the line-diff foundation

- Define a canonical semantic `DiffDocument` model that can represent Git patches, before/after content, agent edits, and Refactor proposals without losing source mapping.
- Build reusable renderer primitives and purpose-specific variants: full review, compact embedded, unified, split, and structural.
- Preserve the richer viewer's review-specific controls without creating separate parsing/layout logic per surface.
- Bring Refactor/Refine, tool/edit cards, and file history onto the shared foundation with targeted behavioral and visual regression coverage.

### Phase 3 — Structural-view evaluation and delivery

- Benchmark Difftastic's structural presentation and Otto candidates on representative refactors, reformatting-only edits, syntax errors, unsupported languages, Markdown, JSON/YAML, binary files, and large diffs.
- Measure correspondence alignment, meaningful change visibility, noise suppression, review speed, source navigation, failure modes, and performance.
- Design Structural as a first-class renderer over the canonical model. It may use Difftastic as an optional external backend where practical, but Otto must not treat terminal output as its app-internal model.
- Implement the selected structural engine with explicit capability/error states and rigorous fallback behavior.

### Phase 4 — User choice and rollout

- Add **Settings → Diff presentation → Default view**: Line or Structural.
- Add a local Line/Structural switch to every capable diff surface. The local choice applies to the active review only and does not overwrite the user's global preference.
- Default to Line until Structural has met its acceptance criteria; then allow users to choose Structural as their persisted default.
- Where Structural is not possible, show Line automatically with a concise reason. Never silently omit changes.

## Constraints

- Line diff remains the fast, authoritative fallback for unsupported syntax, parse errors, binary content, oversized diffs, and exact patch-level review.
- Do not mutate Git configuration, install Difftastic, or change external tools without explicit user action.
- Structural mode must preserve source navigation and must never make a patch appear to contain less change than it does.
- The same quality standards apply across Changes, file history, Refactor/Refine, and agent/tool diffs; a compact variant may reduce chrome, not accuracy.
- Preserve protocol compatibility and capability-gate any new daemon-backed functionality.

## Acceptance criteria

- A documented audit covers all user-visible diff surfaces and identifies their migration path.
- Refactor/Refine has review-grade parity with the main Changes viewer for its supported scope, backed by focused regression coverage.
- All migrated surfaces consume shared semantic diff/rendering primitives rather than isolated parsers and layouts.
- Structural view aligns meaningful syntax in side-by-side context and demonstrably reduces refactor/reformat noise on benchmark fixtures.
- Users can set Line or Structural as their default and locally switch the current diff without changing that default.
- Every unsupported/failure case safely displays the complete Line diff with an understandable reason.
- Performance and memory thresholds are defined and tested for large diffs.

## Delivery sequence

1. Audit diff surfaces, collect benchmark fixtures, and document the shared model proposal.
2. Consolidate Line diff rendering and fix Refactor/Refine parity.
3. Prototype and benchmark Structural rendering.
4. Ship the default preference, local switches, capability/fallback states, and cross-surface rollout.

## References

- [[diff-review-experience]]
- Difftastic Git integration: [official manual](https://difftastic.wilfred.me.uk/git.html)
- Difftastic capabilities and limitations: [official repository](https://github.com/Wilfred/difftastic)

## Timeline

- time: "2026-08-13T00:07:23.667Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["diff-review-experience"]
- time: "2026-08-13T00:07:23.667Z"
  kind: "evidence"
  summary: "Confirmed user direction on 2026-08-12. The request is independent of Vim/Neovim work despite the ideas arriving together. Repository inspection shows the main Changes viewer is a rich dedicated diff pane while Refactor/Refine and tool cards use a smaller shared DiffViewer. Difftastic official documentation establishes syntax-aware structural presentation, Git integration, parse-error line fallback, and large-diff performance limitations."
- time: "2026-08-13T00:15:34.717Z"
  kind: "evidence"
  summary: "Audit findings: the active Changes surface is ExplorerSidebar → GitDiffPane. It consumes the subscribed checkout diff (`subscribe_checkout_diff_request` / `checkout_diff_update`), whose daemon path is checkout-session → checkout-diff-manager → checkout-git → server diff parser/highlighter and protocol `ParsedDiffFile`; the client renders its own tree/flat file list, unified or web-desktop split rows, gutters, syntax tokens, inline review threads, line context actions, file navigation, rollback, attachments, commit selection, whitespace and wrap controls. It uses binary and too-large states, a 2,000 rendered-line cap per file, a 500-file expand-all cap, and a 1MB per-file / 2MB total raw diff budget plus structured payload budget. The embedded `DiffViewer` in components/diff-viewer.tsx is a compact flat `DiffLine[]` renderer with word segments/tokens and nested scrolling, used only by Refine hunk bodies and edit tool-call details. Refine builds `DiffLine[]` from before/after prose and groups them into keep/drop hunks; tool/edit cards parse unifiedDiff or oldString/newString and render the same compact viewer. File history uses checkout.git file-history/commit-diff/blame RPCs; it prefers daemon structured data but falls back to client parse/highlight, and its primary renderer (`revision-diff-body.tsx`) separately owns blame runs, old/new gutters, horizontal sync and formatted Markdown mode, with DiffViewer only as an unstructured fallback. Code rename is an adjacent reviewable edit plan, not a diff renderer: code-rename-panel.tsx shows file groups and line/column/newText rows from LSP preview. AI Refactor currently only opens a pre-filled agent draft; refactor-dialog.tsx previews selected source text, not a proposed diff. Existing benchmark/test anchors include app demo scenario 03-diff-review, app E2E diff-row-alignment, changes-commit, changes-rollback-file, add-changed-file-to-chat, deferred commit-diff-panel, app unit diff-layout/diff-highlighter/diff-highlight/diff-rendering/tool-call-parsers/refine-hunks tests, server diff-highlighter/checkout-diff-manager/checkout-diff-subscription/git-diff-bottleneck tests, server git-file-history and commit-file-diff tests, and the mango-storefront working-changes demo fixture. No standalone structural-diff benchmark corpus or Refine/tool-card E2E review spec was found."
  source: "Repository audit on 2026-08-12: packages/app/src/git/diff-pane.tsx; packages/app/src/components/diff-viewer.tsx; packages/app/src/git/file-history/{use-file-his"
- time: "2026-08-13T00:22:56.813Z"
  kind: "note"
  summary: "Implemented the shared renderer-facing DiffDocument foundation and a heuristic Difftastic-style structural presentation for Changes, Refine, tool/edit cards, and unstructured file-history fallback. Added persisted Line/Structural default in Settings and local switches. Targeted tests, app typecheck, and lint pass. Remaining phases are the documented benchmark/audit artifact, migration of the rich numbered history renderer and all main-Changes review chrome onto the shared model, and explicit performance benchmark thresholds; existing binary/oversized safety placeholders remain intact."
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T00:23:08.125Z"
  kind: "evidence"
  summary: "Diff-surface audit observed: `git/diff-pane.tsx` is the rich Changes renderer; `components/diff-viewer.tsx` is shared by Refine (`panels/refine-panel.tsx`), agent tool/edit cards (`components/tool-call-details.tsx`), and file-history's unstructured fallback (`git/file-history/revision-diff.tsx`); `git/file-history/revision-diff-body.tsx` remains the separate rich numbered history renderer. Implemented `utils/diff-document.ts` as the shared renderer-facing model and structural row builder, added default preference and review-local selection, and validated with targeted Vitest (11 tests), app typecheck, and targeted lint."
  source: "Repository implementation and focused validation on 2026-08-12."
- time: "2026-08-13T00:24:13.573Z"
  kind: "evidence"
  summary: "The rich structured file-history renderer now also exposes a local Line/Structural switch. Structural file history uses the same DiffDocument-backed compact structural renderer; Line retains the existing numbered, blame-aware renderer. This preserves current source/history behavior in the authoritative Line fallback."
  source: "Repository implementation and focused validation on 2026-08-12."
- time: "2026-08-13T00:27:39.324Z"
  kind: "evidence"
  summary: "Current working-tree cross-check: the active direct DiffViewer consumers are the Refine hunk renderer (packages/app/src/panels/refine-panel.tsx), tool edit detail cards (packages/app/src/components/tool-call-details.tsx), File History's raw/fallback branch (packages/app/src/git/file-history/revision-diff.tsx), and the structural branch of the main GitDiffPane (packages/app/src/git/diff-pane.tsx). A working-tree DiffDocument/diff-presentation implementation exists but is uncommitted and partial: the structural branch currently routes through the compact viewer, so the main Changes pane's richer review gutters/actions are not yet carried by structural rows. File History's structured primary RevisionDiffBody remains a separate renderer. No dedicated Refine/tool-card review E2E or standalone structural fixture corpus was found; current coverage is concentrated in diff-row-alignment, Changes commit/rollback, parser/layout/highlighter tests, the mango storefront demo, and daemon history/diff tests."
  source: "Repository cross-check, 2026-08-12"
  affects: ["implementation-state"]
- time: "2026-08-13T00:32:02.899Z"
  kind: "evidence"
  summary: "A migration-ready plan was prepared: make `DiffDocument` a typed, per-file canonical semantic model with source identity, normalized hunks/lines, old/new locations, stable review targets, render capability state, and explicit fallback reason codes; adapt `ParsedDiffFile`, compact Refine lines, normalized agent edits, and History structured/raw data into it. Consolidate React Native line/structural primitives under a shared renderer while retaining Changes, History, Refine, and tool-card domain wrappers. Complete the migration in slices: canonical Line model and Changes parity; History/Refine/tool consumers; fixture corpus and benchmark-gated parser-backed structural engine; then user preference/local override rollout and E2E. Existing uncommitted heuristic Structural mode and `ChangesPreferences.presentation` are treated as a partial implementation to reconcile, not as acceptance of the architectural contract."
  source: "Code-level delivery plan derived from the 2026-08-12 audit"
- time: "2026-08-13T01:21:19.646Z"
  kind: "evidence"
  summary: "Recovered results agree that the first implementation is insufficient to complete the charter. The verified audit identifies five active review paths: Changes, compact DiffViewer consumers, Refine, tool/edit cards, and File History. A final plan judge rejected the canonical model because typed renderer capability and explicit fallback states are not embedded in DiffDocument. Audit review also found that an early inventory missed the active Changes Structural branch, so all source mappings must be re-audited against the working tree before final rollout. Benchmark corpus, explicit performance thresholds, unified source mapping, and full review-grade Changes parity remain required."
  source: "Recovered sub-agent audit, planning, and judging results on 2026-08-12."
- time: "2026-08-13T01:28:12.970Z"
  kind: "evidence"
  summary: "Authoritative re-audit of the prototype: five active review paths are confirmed. Changes is ExplorerSidebar → GitDiffPane, fed by the live checkout diff subscription and ParsedDiffFile; its Line renderer owns hunk coordinates, gutters, syntax tokens, review targets, inline comments, source navigation, rollback, attachments, and commit selection. The prototype Structural branch flattens each ParsedDiffFile to type/content and routes through DiffViewer, so it drops hunk/line mapping, tokens, review targets, comments, context-menu navigation, and the split/unified layout contract; StructuralDiff is not vertically or horizontally scrollable and always wraps cells. File History is fed by checkoutGitFileCommitDiff plus blame and has a separate RevisionDiffBody with previous-revision labels and blame-aware gutters; the structured Structural branch bypasses those behaviors, and the raw/unstructured fallback's header toggle is not wired to the fallback DiffViewer's presentation prop. Refine remains a client buildLineDiff/groupDiffHunks proposal against pinned base text; its hunk-level keep/drop controls remain outside the renderer and have no source line coordinates. Tool edit cards parse unifiedDiff or oldString/newString and client-highlight a compact DiffLine[]; they have no line identity or review actions, while write/read cards are not diffs. The only persisted setting is @otto:changes-preferences.presentation, default line; local overrides are per GitDiffPane, RevisionDiff, or individual compact DiffViewer instance, not one shared review state. Structural availability is only a hardcoded extension allowlist plus a 2,000 flattened-line cap; there is no parser capability state, parse-error state, binary signal in compact inputs, or benchmark threshold. Settings/toggle/fallback copy is hardcoded English in the prototype. Focused app tests pass (6 files, 46 tests), app typecheck and targeted oxlint pass. Existing fixtures are language/parser constants (TS, Rust, C, Java, Objective-C, Go, PHP, YAML, XML, unsupported/new/deleted/multi-hunk and >256 KiB highlighting), Refine round-trip/hunk fixtures, temp Git history/commit-diff repos covering rename/create/delete/merge/non-touching commits, app E2E diff-row-alignment/changes-commit/rollback/add-changed-file-to-chat, the deferred skipped commit-diff-panel, and the mango-storefront demo scenario. No standalone structural corpus, structural benchmark/performance threshold, or Refine/tool-card review E2E exists."
  source: "Worktree re-audit on 2026-08-12: packages/app/src/{utils/diff-document.ts,components/diff-viewer.tsx,git/diff-pane.tsx,git/file-history/revision-diff.tsx,git/fi"
  affects: ["implementation-state","diff-review-experience"]
- time: "2026-08-13T01:32:00.086Z"
  kind: "evidence"
  summary: "Current-worktree re-audit after the prototype changes (2026-08-12): the prototype is present but remains partial. Direct DiffViewer consumers are the structural branch of Changes (packages/app/src/git/diff-pane.tsx), structured and fallback File History (packages/app/src/git/file-history/revision-diff.tsx), Refine hunk bodies (packages/app/src/panels/refine-panel.tsx), and agent edit cards (packages/app/src/components/tool-call-details.tsx). The editor AI Refactor surface is packages/app/src/editor/refactor-dialog.tsx plus use-ai-refactor.tsx; it previews selected source and opens a prefilled draft, not a proposed diff. Code Rename remains a line-oriented LSP edit plan, not a diff renderer.\n\nVerified prototype limits: utils/diff-document.ts models only a flat DiffLine[] plus filePath/source; structural alignment is a greedy line-shape heuristic, capped at 2,000 lines and gated by a duplicated extension set. It has no hunk coordinates, old/new line numbers, stable review targets, source identity, typed capability/fallback state, or parser/invalid/binary/truncated status. Main Changes and File History toCompactDiffLines() drop tokens and source metadata before compact rendering. Main Changes structural mode therefore loses gutters, source mapping, line review targets, inline review/comment/context actions, and related row behavior; File History structural mode loses line/blame mapping. File History's unstructured fallback invokes DiffViewer without an explicit presentation or fallback reason, so a global Structural preference can make the fallback structural and its header toggle can diverge from the embedded toggle. Refine and tool cards expose independent local toggles through the shared component. The source preference is persisted globally, while the active Changes and History controls are local overrides.\n\nAuthoritative existing mapping remains utils/diff-layout.ts and review/surface.tsx: ParsedDiffFile hunk coordinates are expanded into old/new numbered cells and ReviewableDiffTarget keys of filePath:side:lineNumber; Changes review actions consume those targets. Server/protocol ParsedDiffFile still contains hunk coordinates, line type/content/tokens, file status, and file-level counts, but no per-line stable target or structural representation. Server checkout data is subscription-backed and structured via checkout-diff-manager.ts -> checkout-git.ts -> parseAndHighlightDiff; history uses checkout session get_file_commit_diff and falls back to raw diff when structuring fails.\n\nCurrent focused verification: app targeted run across 7 files passed 67 tests; server/protocol targeted run across 5 files passed 67 tests; app workspace typecheck passed; targeted app lint passed. The structural utility itself has only two tests. Existing app E2E anchors remain diff-row-alignment.spec.ts, changes-commit.spec.ts, changes-rollback-file.spec.ts, add-changed-file-to-chat.spec.ts, and commit-diff-panel.spec.ts; none asserts the structural path, settings choice, fallback reasons, or structural review parity. Demo scenario 03-diff-review.demo.ts uses mango-storefront working-changes fixtures, resets the preference to the line view, and only demonstrates classic line review/list/tree behavior. No standalone structural corpus or benchmark harness was found.\n\nMigration target confirmed by this audit: one typed per-file semantic DiffDocument must adapt the existing ParsedDiffFile/diff-layout mapping and before-after/proposal/agent-edit inputs. It must retain hunks, old/new coordinates, tokens/fragments, stable review targets, source/revision identity, file status, and typed structural capability/fallback reason codes. Shared line and structural render primitives should consume that model; Changes, History, Refine, and tool cards retain domain-owned subscriptions/actions/review/blame/keep-drop/edit lifecycle. Structural must never silently discard mapping or render an unstructured fallback; unsupported, parse-error, binary, too-large, truncated, or missing-source documents must explicitly render the complete Line view with a reason. Keep protocol changes backward-compatible and keep default Line/local overrides until fixture and performance acceptance is complete. Required fixtures include multi-hunk, add/delete/new/removed, rename/move, reorder, formatting-only, duplicate similar blocks, Markdown/JSON/YAML, unsupported language, malformed/parse-error, binary, truncated, >2,000-line, CRLF/non-ASCII cases; mango-storefront is integration/demo data, not the benchmark corpus."
  source: "2026-08-12 current-worktree re-audit; source paths and targeted tests listed in evidence"
  affects: ["diff-review-experience","e2e-qa-coverage"]
- time: "2026-08-13T01:53:31.985Z"
  kind: "evidence"
  summary: "Added an isolated Settings → Diff presentation preview for visual evaluation only. It samples Difftastic-inspired Line and Side-by-side presentations across a tiny token edit, formatting-only churn, and reordering. It does not change live diff rendering or approve the proposed migration."
  source: "Implementation update, 2026-08-13"
- time: "2026-08-13T02:11:37.435Z"
  kind: "evidence"
  summary: "Expanded the Appearance → Syntax visual-only lab. The same selected scenario can now be viewed in Classic (old unified red/green) or Difftastic-inspired mode, with Compact Line and Side-by-side subviews. Added a Review mix scenario containing a function rename, type annotation, computed-value replacement, and relocated validation. This is a decision aid only, not production rendering."
  source: "Visual-design iteration, 2026-08-13"
- time: "2026-08-13T02:44:33.829Z"
  kind: "evidence"
  summary: "Established the fast structural-diff corpus loop: `npm run test:structural-diff` runs a pure Vitest source-pair harness with no Electron, daemon, browser, or Difftastic executable. Added a provenance and MIT-license-preserving, master-commit-pinned seed subset from Difftastic (`simple` JavaScript and JSON pairs) plus an Otto wrapped-call formatting fixture. The harness reports paired changes, shared visible context, and unmatched additions/removals; the initial 3 fixtures run in about 470ms. Documented the corpus contract in docs/testing.md. Removed formatting-only prose from the visual lab’s Difftastic line preview."
  source: "Implementation and focused verification, 2026-08-13"
  affects: ["diff-review-experience","difftastic-informed-native-diff-design"]
- time: "2026-08-13T03:05:40.303Z"
  kind: "evidence"
  summary: "Expanded the visual-only Appearance → Syntax diff lab so Difftastic Line mode exposes the approved two treatments for compact token replacements: the default purple new-token presentation and an explicit old→new presentation with the old token red and struck through plus the new token green. Side-by-side continues to show the explicit before/after form. Added a presentation-neutral StructuralDiffBlock planner to the fast source-pair harness with conservative `replacement`, `formatting`, `addition`, `removal`, `shared`, and exact-line `move` kinds. Expanded the pinned corpus to eight cases: Difftastic import and JSON pairs plus local wrapped-call, token rename, whitespace-only, addition, removal, and reorder pairs. `npm run test:structural-diff` (8 tests, ~472 ms), focused diff-document Vitest (3 tests), targeted app lint, and app typecheck passed. This is a verified inner-loop baseline, not completion of the parser-backed migration or cross-surface review parity."
  source: "Verified implementation and focused test run, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:09:49.996Z"
  kind: "evidence"
  summary: "The compact live Structural renderer now consumes StructuralDiffBlock rather than independently rendering greedy pair rows. It renders shared context once, pairs replacements, preserves one-sided additions/removals, uses the neutral formatting background for whitespace-only blocks, and renders conservative exact moves in the theme’s third (purple) foreground instead of red/green. This keeps every raw line visible, including formatting blocks whose before/after line counts differ. Focused structural corpus and diff-document tests plus targeted lint passed. App typecheck currently reaches unrelated pre-existing errors in `src/agent-stream/view.tsx` (missing `resolveWorkspaceFilePaths`) and `src/assistant-file-links/link.tsx` (missing required `InlinePathTarget.raw`); no failure names a changed diff file."
  source: "Verified implementation and focused test run, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:14:44.514Z"
  kind: "evidence"
  summary: "Structural eligibility no longer uses a duplicated extension allowlist. It is derived from `@otto-code/highlight`'s parser registry, and a unit test enumerates every registered syntax-parser extension to prevent drift. DiffDocument now optionally retains complete before/after source snapshots; when supplied, the Structural availability check walks the Lezer tree and returns typed `invalid-source` fallback state for parser errors. The fast corpus now includes a malformed TypeScript source pair and asserts that safe fallback. `npm run test:structural-diff` passed 9 tests (~608 ms); focused diff-document tests passed 6; targeted lint and app typecheck passed."
  source: "Verified implementation and focused test run, 2026-08-12"
  affects: ["diff-review-experience","language-support-grows-with-structural-diff"]
- time: "2026-08-13T03:15:11.644Z"
  kind: "note"
  summary: "Implemented the semantic Structural planner, live compact renderer consumption, visual replacement alternatives, parser-registry eligibility, typed malformed-source fallback, and fast corpus. Parser-backed alignment with complete source adapters and review-grade cross-surface parity remain."
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T03:20:17.496Z"
  kind: "evidence"
  summary: "Wired the persisted formatting-only preference into the live compact Structural renderer: semantic formatting blocks are filtered only when the user disables them; additions, removals, replacements, and moves remain. Added the existing mixed review scenario as a corpus fixture, bringing the fast suite to 10 cases. The Appearance → Syntax lab now defaults to a real per-block `Mixed` preview: inline compact rename, one-sided addition, purple moved line, and explicit side-by-side replacement in the same review. `npm run test:structural-diff` passed 10 tests (~557 ms), targeted lint passed, and app typecheck passed."
  source: "Verified implementation and focused test run, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:24:01.738Z"
  kind: "evidence"
  summary: "Corrected the mixed review demo after user review: a token rename preserves the unchanged `format` prefix, rendering only `Price`/`Amount` as purple new-token or red-struck-old plus green-new. `validateCurrency(amount)` is unchanged in the review-mix fixture and now renders as ordinary shared context in Compact, Mixed, and Side-by-side presentations. The review description no longer calls it reordered."
  source: "User-reviewed visual correction, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:27:20.923Z"
  kind: "evidence"
  summary: "Closed the corpus-to-demo gap found during visual review. Added pure inline replacement fragments that preserve literal shared prefix/suffix and mark only minimal removed/added spans. The Appearance lab now renders these fragments rather than manually splitting identifiers. Unit coverage asserts `formatPrice` → `formatAmount` as shared `format`, removed `Price`, added `Amount`, plus lossless reconstruction for replacement fragments. The mixed-review corpus fixture additionally asserts `validateCurrency(amount)` remains a shared semantic line and records the expected rename fragments. Structural corpus (10), inline fragment unit tests (2), targeted lint, and app typecheck pass."
  source: "Verified implementation and focused test run, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:28:58.544Z"
  kind: "evidence"
  summary: "User confirmed that a pure addition/removal must not render as a fake two-column comparison. Mixed preview and the live compact Structural renderer now render one-sided additions/removals as a single full-width row; side-by-side is reserved for an actual before/after counterpart. Focused structural corpus, inline-fragment/diff-document tests, targeted lint, and app typecheck passed."
  source: "User-reviewed visual correction, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:34:09.634Z"
  kind: "evidence"
  summary: "Replaced the hand-authored Settings diff illustration with a real fixture viewer. Each selectable complete source pair is passed through the production `buildLineDiff`, `DiffDocument` availability check, and `DiffViewer`; the lab controls now choose actual Line or Structural rendering. DiffViewer accepts optional complete before/after snapshots so source-pair callers use parser-safe eligibility. This supersedes the earlier visual-only mock as the direction for future diff demonstrations: demos must render actual engine output, not manually authored rows. Structural corpus (10), focused unit tests, targeted lint, and app typecheck passed."
  source: "User-approved product direction and verified implementation, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:41:55.769Z"
  kind: "evidence"
  summary: "Implemented two device-local Structural diff preferences as real renderer inputs: Compact replacements persists New token versus Old → new and drives inline replacement rendering; Formatting-only changes persists whether neutral formatting blocks render at all. Added the missing AppSettings update-routing allowlist entries, storage migration coverage, production-segment fragment coverage, the 10-fixture structural corpus, targeted settings/unit tests (122 assertions), lint, and app typecheck all pass."
  source: "User-approved product preference and focused verification, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:45:47.401Z"
  kind: "evidence"
  summary: "Corrected a Structural renderer alignment defect: compact inline replacements had bypassed the normal diff-marker gutter, so their code began one prefix column left of +, −, and shared rows. They now reserve the blank context-marker column; lint and app typecheck pass."
  source: "User visual review and focused renderer verification, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:50:02.259Z"
  kind: "evidence"
  summary: "Added real old/new source coordinates to the common DiffLine model and a two-column line-number gutter to the shared DiffViewer. Source-pair, unified-patch, Changes Structural, and History Structural inputs now retain those coordinates; removals show old only, additions new only, and shared/replacement rows show both. Parser/renderer fixtures (19 tests), lint, and app typecheck pass."
  source: "User review decision and focused verification, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:53:53.391Z"
  kind: "evidence"
  summary: "Corrected the first real line-number-gutter defects in Structural preview: terminal newlines no longer become phantom numbered rows; +/− now use a dedicated fixed marker column rather than sharing the code text; and added/removed-side coordinates use status colors. Updated two corpus expectations that had accidentally encoded the phantom final blank row; all 10 structural fixtures and focused parser/highlight tests pass."
  source: "User visual review and focused regression verification, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:54:52.197Z"
  kind: "evidence"
  summary: "Aligned shared DiffViewer row density with the established compact diff surface: code, marker, and line-number text now use the theme's 22px diff line height and ordinary code rows have no vertical padding. Hunk/header rows retain their separate treatment. Lint and app typecheck pass."
  source: "User visual review and focused renderer verification, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T03:59:41.226Z"
  kind: "evidence"
  summary: "Corrected Structural change-block ordering. The planner previously emitted all paired replacements before unmatched deletions, which could place a removed declaration after a following replacement. It now emits aligned rows in source order. Added a Review mix regression asserting added declaration, shared validation, removed declaration, then return replacement order; 11 corpus fixtures, lint, and app typecheck pass."
  source: "User visual review and focused corpus verification, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T04:03:51.525Z"
  kind: "evidence"
  summary: "Made the two-column DiffViewer gutter compact and content-aware. Each real diff now computes the largest old/new coordinate, uses that shared digit width for both columns, and separates them by one small gap. Short diffs no longer reserve four-digit columns; longer files widen both columns together so code alignment remains stable. Added width-scaling coverage; 12 focused tests, lint, and app typecheck pass."
  source: "User visual-review requirement and focused verification, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T04:09:51.243Z"
  kind: "evidence"
  summary: "Review gutters are a shared interaction architecture, not display-only line numbers. Preserve the existing hunk headers, intensity/rail treatment, hover comment affordance, inline comment composer, persisted comment card, and comment clear/edit actions. In a side-by-side Structural row, use one canonical outer gutter with independently targetable old and new coordinate lanes, not a second gutter per code cell. A comment records the chosen side and source coordinate, then is inserted once beneath the visual row spanning the whole diff surface. Structural migration is not ready for a live review surface until DiffDocument carries those review targets and hunk boundaries."
  source: "User review-workflow design direction, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T04:16:05.407Z"
  kind: "evidence"
  summary: "Corrected compact Structural replacement semantics: purple now denotes only a true old-to-new token replacement. A pure addition adjacent to a rename, such as a new `: string` type annotation, is retained as a green addition while `Price` → `Amount` remains purple in New token mode. Added a focused mixed rename/type-annotation fragment regression; 15 focused fragment/corpus tests, lint, and app typecheck pass."
  source: "User visual-review correction and focused regression verification, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T04:22:27.650Z"
  kind: "evidence"
  summary: "Added shared DiffDocument hunk framing. Source-pair inputs derive an honest `@@ -oldStart,oldCount +newStart,newCount @@` header from their real coordinates; protocol ParsedDiffFile adaptation retains native hunk boundaries and old/new review targets. DiffViewer now renders location banners in Line and Structural modes and a continuous divider after the two-lane gutter. Focused document/corpus tests (19), lint, and app typecheck pass."
  source: "User review framing requirement and focused verification, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T04:26:42.649Z"
  kind: "evidence"
  summary: "Confirmed compact paired-coordinate gutter behavior: each old/new number lane sizes from the largest visible line-number digit count (one digit for short fragments, growing only as needed), with 4px outer padding on both sides of the shared gutter and a 6px inter-lane gap. The two lanes remain stable across the fragment."
  source: "User-reviewed diff viewer refinement"
  affects: ["diff-review-experience"]
- time: "2026-08-13T04:29:17.792Z"
  kind: "evidence"
  summary: "The shared two-coordinate gutter now reserves a 24px seam after its divider rail. This keeps the hover comment '+' affordance clear of the code while preserving the same geometry for hunk banners and every diff row."
  source: "User-reviewed diff gutter refinement"
  affects: ["diff-review-experience"]
- time: "2026-08-13T05:49:12.270Z"
  kind: "evidence"
  summary: "Expanded the fast Structural inner loop. `npm run test:structural-diff --workspace=@otto-code/app` now runs the semantic document tests, curated source-pair corpus, and a 40-extension language matrix in under one second. The matrix exhaustively matches the syntax parser registry and verifies each extension has a complete parse-safe source pair, lossless visible-line reconstruction, and no planner line drops. The Appearance diff viewer now consumes a shared catalog of eight real complete-source scenarios (small edit, formatting, reorder, mixed review, imports, JSON object edit, function rewrite, Markdown). Added guarded planner correspondences for import replacements and same-level Markdown heading replacements; existing Difftastic fixture expectations remain green. Focused result: 3 test files / 70 tests passed; targeted lint and app typecheck passed."
  source: "Verified implementation and focused unit run, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T05:57:31.982Z"
  kind: "evidence"
  summary: "Expanded the version-pinned Difftastic source corpus with comments-inside-call, contiguous duplicate insertion, Python block indentation, hyphenated JSON token, and nested HTML content cases. The corpus remains semantic rather than terminal-render based. The new cases drove conservative correspondence rules for same import structure, same-level Markdown headings, matching markup tags, and changed line/block comments. The Appearance lab gained real HTML and comment scenarios from complete source pairs. `npm run test:structural-diff --workspace=@otto-code/app` passes 79 assertions in about one second; targeted lint and app typecheck pass. Copied upstream source is now treated as immutable provenance data and excluded from formatter invocations."
  source: "Verified upstream-fixture expansion and focused unit run, 2026-08-12"
  affects: ["diff-review-experience"]
- time: "2026-08-13T06:01:44.323Z"
  kind: "evidence"
  summary: "Added a duplicate-line reorder corpus case and a nested JavaScript Difftastic case to the real source-pair lab. More importantly, corrected a safety defect: Structural formatting suppression is now restricted away from indentation- and whitespace-sensitive extensions (Python, YAML, Markdown, and shell variants). A Python indentation change is asserted as a visible replacement and survives the user’s hide-formatting preference. Focused Structural loop now passes 83 assertions in about one second; targeted lint and app typecheck pass."
  source: "Verified language-safety regression and focused unit run, 2026-08-13"
  affects: ["diff-review-experience"]
- time: "2026-08-13T06:07:50.921Z"
  kind: "evidence"
  summary: "Three read-only audits converged on the next delivery boundary. The highest-value corpus additions are Difftastic `javascript_1/2.js`, `nested_slider_1/2.rs`, `trailing_commas_1/2.js`, CSS reorder, JSX wrapper edits, YAML flow/block edits, and JSON removals, ranked by review semantics rather than terminal rendering. The first live-surface migration must be Changes only: its current Structural branch flattens ParsedDiffFile before DiffViewer and thereby loses hunk identity, tokens, review targets, comment/thread behavior, source navigation, and scroll ownership. Safest slice is a shared ReviewDiffBody fed by createDiffDocumentFromParsedFile, retaining the existing Line body as fallback, one canonical targetable gutter, and full-width thread insertion. Parser-guided planning should start with a pure source index over existing getParserForFile parsers and monotonic dynamic-programming pairing constrained by compatible old/new AST context. Parser evidence only refines candidate alignment when complete snapshots are valid; it never suppresses lines, invents moves, or substitutes for the exact-patch fallback. Stream parsers remain parse-safe but not semantic proof."
  source: "Independent corpus, surface, and parser-alignment audits, 2026-08-13"
  affects: ["diff-review-experience"]
- time: "2026-08-13T06:26:17.363Z"
  kind: "evidence"
  summary: "Verified 2026-08-13: Changes Structural rendering now passes the canonical DiffDocument created from the daemon-parsed file into DiffViewer, rather than flattening it through a compact line adapter. This preserves hunk boundaries, syntax tokens, old/new coordinates, and review-target metadata at the renderer boundary. Targeted app lint and typecheck passed; the fast structural corpus suite passed (86 tests). Review interactions themselves are not yet wired through the shared renderer."
  source: "implementation"
  affects: ["changes-structural-rendering"]
- time: "2026-08-13T06:42:40.721Z"
  kind: "evidence"
  summary: "Verified 2026-08-13: the live Changes diff path now retains size-bounded complete before/after snapshots that the daemon already reads for full-file syntax highlighting. They flow as optional backward-compatible ParsedDiffFile fields into DiffDocument; changed files without both snapshots explicitly use Line rather than claiming Structural. The structural planner now uses Lezer named-node line context as a conservative tie-breaker and monotonic dynamic-programming alignment to prevent crossed replacement pairs. Focused daemon/highlighter and checkout source tests pass; fast structural corpus is 89 tests green; app lint/typecheck pass. Server-wide typecheck/build are presently blocked by unrelated terminal-manager `presentation` type errors."
  source: "implementation"
  affects: ["changes-structural-rendering","diff-protocol"]
- time: "2026-08-13T06:55:59.289Z"
  kind: "evidence"
  summary: "Verified 2026-08-13: shared Structural gutter now receives the existing InlineReviewActions controller and renders the existing inline comment/editor thread below the anchored Structural row, so review actions are no longer no-ops. File History now passes the canonical DiffDocument instead of compacting parsed hunks; its revision-diff server path obtains bounded previous/current blob snapshots (including rename-aware previous paths) and forwards them into parsed structural payloads. Root/deleted/oversized revisions remain explicit Line fallback. Review surface test, fast structural corpus (89), file-history unit suite (19), app lint/typecheck all pass."
  source: "implementation"
  affects: ["changes-structural-review","file-history-structural-review"]
- time: "2026-08-13T06:59:37.644Z"
  kind: "evidence"
  summary: "Verified 2026-08-13: Refine proposals now retain their pinned base and generated proposal snapshots and pass a canonical DiffDocument into the shared viewer, enabling real parser-safe Structural review rather than hunk reconstruction. Changes and File History explicitly preserve their established legacy Line bodies whenever Structural is unavailable, avoiding a visually different generic fallback. App lint/typecheck pass; fast structural corpus remains 89 green. Refine set test passed; existing refine-hunks trailing-newline property failed independently and was not changed as part of diff work."
  source: "implementation"
  affects: ["refine-structural-review","fallback-parity"]

# Paseo 0.6.1 integration: agent tasks and execution prompts

Prepared 2026-09-05. Status: the user subsequently authorized integrating everything into main, pushing, running CI, and removing project worktrees and obsolete local/remote branches. Agent 00's historical baseline remains pinned. Release identity beyond v0.9.0 remains unresolved; this cleanup is not a release.

## Live coordinator execution record

The user's latest instruction explicitly supersedes the earlier main/push/CI approval boundary: everything is to be integrated into main and all project worktree workspaces removed. Agent 00's preparation-only statements below and prior candidate-only handoffs are historical. Release operations and Agent 07's architectural proposals remain outside this execution scope.

**Closeout status:** all scoped code is committed and pushed into main. Otto lists only the project's main `local_checkout` workspace, with **zero worktree workspaces**. Git lists only the main checkout and only the local `main` branch. The four merged security branches were deleted from origin; unrelated open Dependabot PR branches remain. All seven managed workspaces and the older detached Android build worktree were deregistered. No new agents were launched during closeout and no duplicate completion messages were acknowledged.

Physical deletion is incomplete for three deregistered directory roots: `C:/Users/phili/.otto/worktrees/0pkiflkb/paseo-061-01-plugin`, `C:/Users/phili/.otto/worktrees/0pkiflkb/paseo-061-04-browser`, and main `.tmp/android-tablet-build`. Only dependency junction remnants were observed there after removal. Otto reported EBUSY for the first two; Git reported success for Android but retained its dependency junction. Automatic approval review rejected both recursive and narrower nonrecursive junction-removal attempts with `blocked by policy`. Those remnants, and the previously blocked three OS Temp fixtures recorded in Agent03's report, are not claimed as deleted. Recovery archives are intentionally retained in main `.tmp/paseo-061-closeout/`.

**CI status at closeout:** run 33994341709 is running and is **not green**. Observed completed failures are the module-size ceiling check (seven modules exceed the recorded ceilings), app-test dependency optimization (`TurboModuleRegistry` is not exported by `react-native-web`), and Playwright shard 4's ffmpeg download before test execution. Completed successes include format, typecheck, SDK, relay, Android-native, Windows desktop and CLI shard 1. Exact job logs are retained at `.tmp/paseo-061-closeout/ci-{lint,app,browser-setup}.log`. This is a partial matrix observation; the linked run supplies its eventual result. Closeout does not silently raise ceilings, expand into unrelated refactors, or claim all previously dispositioned CI cases were repaired. The final documentation-only commit skips another CI dispatch because the running matrix already tests the unchanged merged code.

**Cleanup evidence:** before removal, 2,530 worker evidence files were copied into main `.tmp/paseo-061-closeout/worker-evidence.zip` and every archived file's SHA-256 was verified against `.tmp/paseo-061-closeout/evidence-manifest.json`. The archive uses each former worktree basename followed by its `.tmp`-relative path, preserving the reports referenced below. Runtime homes, dependency directories and disposable caches are excluded. `.tmp/paseo-061-closeout/pre-cleanup-branches.bundle` preserves complete local branch history and passes `git bundle verify`. The older detached Android build's uncommitted patch is retained beside that bundle; its sidebar helper/test bytes already match main, and its Metro change is a temporary worktree dependency-link adjustment. Main's pending composer delivery-action changes were committed as `bfad4542d` after eight focused tests and lint/format/typecheck hooks passed.

**Integrated into main:** `30b7de505db9996a88becb9f5c49a5e12e574b4a`, pushed to origin. This normal, conflict-free merge combines the reviewed candidate `4218b6a355c677333061bf483f641ba74a951011` (tree `b5572abb7b0cfbb39a46e85a62c6081d932a376b`) with the user's newer main commits through `a73a9aaade020da17d99c6c73a699a016874e6fa` and composer commit `bfad4542d`. Baseline R remains the historical normal two-parent merge `a7dce099b82cbec56ce27ab4c9b94e38c0f7619a`, tree `c7cfae82878134466ccc249bd98aa68fdd5b1449`. The combined main tree passed server builds, npm formatting, whole-repository lint and typecheck hooks, and the eight-obligation integration guard. [CI run 33994341709](https://github.com/Draek2077/otto-code/actions/runs/33994341709) tests the exact merged code commit. The following candidate proof records retain their original SHA scope.

| Scope                                | Source commit                              | Integrated commit                          | Verified result                                                                                                                                       |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 09 provider steering                 | `a09a8d963c3a053e96de3eaf74790c2a579837d2` | Same                                       | Actual manager-through-wrapper red/green regression and five wrapper cases; required checks/hooks                                                     |
| 01 plugin mounts                     | `81c4110627b38a0a209924af9cd56b5cf902e4e1` | `2463ecd1c8a511192fbf9b4ed6389e9d4187c234` | Catalog, commands, both sidebars; ten focused tests; full browser cleanup later passed under 04                                                       |
| 03 server and CI setup               | `cfa0991ec42ca3ef9f35be28a9e948f517da8e64` | `98b161cb676b9b57b62d19910812bb38ac12b4ab` | Windows watcher abort reproduced/repaired; bounded Windows/Linux tests and OpenCode installs; independent Graph/setup tasks retained                  |
| 02 skill upgrade                     | `40712fd9cc8d1b604f38e145ee085395a697218f` | `c9ad3aa5796593be4a3fb6e198fb0fc94300bf56` | 31 focused tests; actual attached and cold Electron migration, persistence and reload fixtures                                                        |
| 04 compact header and preview notice | `8f841ce5799d994778c6814cb13451f220cd75c4` | `2c264692110d40e9afd16cf71a7dce09c8d5858a` | Seven SourceView unit cases, strengthened exact-one plain case and compact browser case; Preview acceptance closed below                              |
| 06 integration guard                 | `10b46f5c89bd9e940f4666f64104c5d1c2895c1f` | `75b27dd9807159a435d82f87345555dbcafb5394` | 26 focused tests; historical trees fail eight obligations, repaired tree passes; real pre-merge snapshot retained                                     |
| 04 placement and bridge continuation | `5c8aedb2e76b5da4b4262a9ad6f1e0c79bd1eba3` | `63a920ba090436fe410dcc48018f1b4b0ea500cd` | Full plugin case 1/1 (51 seconds), new placement case 1/1 (19.6 seconds), actual corrected Electron bridge passed with preserved WebContents identity |
| 04 explicit Preview regression       | `f83a827a2b6f9a421d27c1e27f7c666e4345eb7a` | `480dc7ca0a6c2804eae31300e5bfa356e43b3007` | Three named Preview cases passed, including ASCII oversized fixture                                                                                   |
| 04 Preview return state              | `c45e4cc62f751b622aa22317d80e8bfcf2fa286d` | `9f9a28a3ccf09d5718801281e8466b8809c4f33d` | Three strengthened cases passed (70.8 seconds test time); returning to Main does not reselect Preview                                                 |

**Heavy-check lease:** released. Agent07 completed the final rehearsal with exit 0 and verified cleanup; the coordinator is closing documentation and Knowledge evidence. Agent04 explicitly released its final lease after checks, hooks and verified process/port cleanup. All three continuation commits integrated unchanged without conflicts; independent Agent07 source reviews accepted the final committed bytes. CI guard wiring is committed as `4218b6a355c677333061bf483f641ba74a951011` in `.github/workflows/ci.yml` and `scripts/ci-workflow.test.mjs`. Combined server/audio builds, npm format, seven workflow tests, whole-repository lint/typecheck and commit hooks passed. The candidate is clean.

The actual placement probe established that `ExplorerSidebarDock` supplied `host: explorer`, while `buildDesktopPaneContentModel` dropped the optional host and resolved a new file into Explorer. The bounded fix forwards the existing host; the new browser proof opens a new file in Main, moves it through the actual menu to Explorer, then reopens it without duplicating or relocating it. No competing placement algorithm was added.

The original large-file assertions conflated Otto's default editable CodeEditor with the read-only SourceView. Agent02's read-only review establishes that the restored notice is reachable through the public Preview mode; no missing file-read handoff was found. The three corrected named tests now select Preview explicitly and assert that surface's content, read-only behavior, bounded DOM, notice and tab return. The oversized fixture contains ASCII text rather than NUL bytes. All three strengthened cases passed; the return leg clicks only the Main tab, with no mode reselection. This does not impose upstream's separate editable cutoff on Otto's editor. Earlier missing-selector and daemon-listen failures remain recorded as failures, not reclassified as passes.

Evidence and remaining work:

- Agent01: plugin worktree `.tmp/agent-01/report.md`; Agent02: skill worktree `.tmp/agent-02/handoff.md`, real fixture manifests, `browser-bridge-advice.md` and `file-content-loading-review.md`. Successful migration fixtures identify exact working blobs, managed identities and isolated homes; they are not runtime proof of the later combined SHA.
- Agent03: server worktree `.tmp/agent-03/report.md`. Three test-created OS Temp directories remain because automatic approval review rejected deletion as `blocked by policy`; no workaround or retry is authorized. Exact paths/provenance are in that report. Independent Graph routing/planning/scheduling/human-gate and old-daemon installation investigations have complete follow-up prompts.
- Agent04: main `.tmp/agent-04/unique-case-inventory.md` and `unique-cases.json` disposition 160 unique old-CI non-passes. Browser worktree `.tmp/agent-04/` holds actual compact, plugin, placement, preview and Electron evidence. Old CI is `3759502db`; it is not candidate CI. Stale rewind storage/settings/workspace fixtures and other independent causes remain explicit tasks. The legacy coverage matrix is preserved; new regression documentation is in `docs/testing.md`.
- Agent05: candidate `.tmp/agent-05/report.md` records 28 bounded integration contracts and independent repair reviews. Real-provider sessions and full wire/platform compatibility remain unrun. Retained provider-only UI, inactive upstream helpers and the Otto editor replacement are deliberate exclusions, not importer-count defects.
- Agent06: guard worktree `.tmp/agent-06/report.md` and `real-baseline.json`. Deterministic owner/mount violations are distinct from generic orphan candidates. Final combined-SHA guard passed all eight obligations over 13 parsed modules. Actual pre-merge snapshot comparison exits 1 for four reviewed generic findings: retained unused tab-overflow helper, relocated browser-store index/state and superseded desktop editor target owner. It retains 280 unresolved-import candidates without interpreting them as defects. The restored notice is no longer flagged. The unchanged green 26-test suite was not replayed locally.
- Agent07: main `.tmp/agent-07/report.md`, `rehearse.py`, `follow-up-prompts.md` and independent source reviews. Historical initial/0.9.0/B counts reproduced as normalized 181/797, 187/821 and 191/828; raw paths 325, 332 and 337. R remains 191/828 and 337. Final candidate `4218b6a355c677333061bf483f641ba74a951011` reproduces the same 191 files/828 hunks and 337 raw paths; output has `complete: true`, with the clean cwd and index hash preserved. Selected seam hunk contents are unchanged, not merely their totals. Results are at main `.tmp/agent-07/final-candidate/results.json`. Three bounded architectural investigations remain unexecuted. The separate `.tmp/agent-07/browser-residual-dispatch-prompts.md` provides 25 bounded residual prompts and maps all 160 old-CI case IDs to a prompt or an existing owner; these are dispositions and future tasks, not 160 current defects or an additional implementation assignment.
- Agent08: all scoped commits integrated unchanged; combined builds/checks and CI commit completed. On final SHA, deterministic guard, ancestry from B/pinned origin/Paseo, About 0.6.1, compiled Hub value-import exclusion and sole Draekz commit identities passed. Evidence is candidate `.tmp/coordinator/final-{integrations,importers,source-checks}.json` and final check/commit logs. Final fixed-target rehearsal also passed with unchanged measured cost. The existing historical Knowledge finding now has verified final-candidate evidence appended through Otto; review status remains proposed. Only explicit push/CI authorization and the resulting exact-SHA external matrix remain before a broader sign-off. No release sign-off or full-matrix success is implied.

The earlier chronological coordinator journal is retained temporarily at main `.tmp/coordinator/execution-journal-before-consolidation.md`; this current record supersedes its old leases and pending statuses.

This is the user-requested operational handoff for reviewing and repairing the Paseo 0.6.1 integration into Otto. It is not a release approval. The coordinator maintains this file; workers return their findings instead of editing one shared ledger concurrently.

## Outcome

Produce a verified integration candidate, repair confirmed merge regressions without losing Otto capabilities, and measure whether proposed architectural changes actually reduce future merge cost. A successful compile is necessary but insufficient: registrations, migrations, provider behavior, and platform-specific surfaces must work through their real entry points.

## Evidence and scope

Read [the complete review](.otto/knowledge/findings/finding-2026-09-05-paseo-v061-integration-review.md). It is a **draft finding**, not an approved refactor design. Read it through Otto Knowledge with `includeInactive: true` when the tool is available. Review status must remain proposed unless the user explicitly confirms it.

| Reference                              | Pinned commit                              |
| -------------------------------------- | ------------------------------------------ |
| Previous upstream, Paseo 0.4.0         | `b44bb63cf4ce089ab5750b9fc621ed52827b2820` |
| Otto immediately before the merge      | `b6735559a98d0143d0127814696f35a091860845` |
| Paseo 0.6.1                            | `20d7efc46a316f5a274b9943a5c43b0322269825` |
| Initial integration merge              | `4b279544f967f58b39df1aaf30bd1e722e8fceb9` |
| Otto v0.9.0                            | `7e9921df7d534780b0c00afc19584553a6148c9a` |
| Reviewed local HEAD                    | `7457ca46ec3f4fe0ae329d9f1bcd945954423525` |
| Related remote-main CI candidate       | `3759502dbbb125da2ec98fcf08d325a5d49a55ea` |
| Fixed future-upstream rehearsal target | `78b285059f6ebd0b257c98bd191df4626721270a` |

The user described releases 0.9.0–0.9.2. At review time the local package, changelog, and local/remote tags identified only 0.9.0, followed by untagged fixes. Local and remote main had diverged by two local-only and six remote-only commits. Do not invent release identities or assume the remote tree contains the local repairs. Agent 00 establishes the candidate all work will use.

Verified observations at reviewed HEAD:

- `PluginCommandCenterActions` exists but has no runtime mount. The existing plugin workspace browser test also fails to find its global command.
- `LegacyAgentSkillsMigration` exists but has no runtime mount. Old desktop custom selections remain in `skill-selection.json`; the new daemon selection defaults to all. Startup maintenance can expand an existing partial installation before a migration imports its selection.
- Lint, whole-repository typecheck, nine wire-compatibility tests, and five selected AgentManager steer/replacement/submission-identity tests passed. No full local suite was run.
- [CI run 33924801496](https://github.com/Draek2077/otto-code/actions/runs/33924801496) belongs to the related remote-main commit, **not** the reviewed local HEAD. It contains both actual test failures and infrastructure/setup failures. It is evidence to investigate, not a verdict on every current file.
- After ordered branding and line-ending normalization, differing shared package source/test modules increased from 1,301 before the merge to 1,371 at reviewed HEAD. This count is not a count of defects.
- Against the same fixed future-upstream target, normalized same-path source/test rehearsals produced 181 files / 797 conflict hunks at the initial merge, 187 / 821 at v0.9.0, and 191 / 828 at reviewed HEAD. Raw whole-tree rehearsals produced 325, 332, and 337 conflicted paths respectively. These are different measurements; do not mix them.

## Shared execution contract

Every prompt below instructs its agent to read this section. A prompt is ready to copy into an agent whose workspace contains this document. The coordinator must supply its completed dispatch block alongside the prompt.

1. Read root `AGENTS.md`, applicable nested `AGENTS.md`, `docs/README.md`, the task-specific documents, and the confirmed Knowledge page `upstream-mergeability-through-otto-owned-seams` before broad edits. Read upstream code at the pinned SHA, not an ambiguous Otto/upstream tag name.
2. Treat the assigned candidate SHA as immutable evidence. Record `git status`, actual HEAD, and any intervening changes. Never reset, discard, overwrite, or silently incorporate unrelated work. Preserve the review finding and other users' uncommitted changes.
3. Implementers work in separate worktrees when running concurrently. Use the Otto skill and verify tool contracts before creating worktrees. Only the coordinator combines changes. Do not spawn further agents from these assignments; report additional work as a bounded task request.
4. Preserve Paseo mechanisms. Keep Otto functionality in additive modules and narrow integration points. Do not delete upstream-owned modules to reduce conflicts; retain deliberate exclusions with explicit reasons. Keep Hub excluded. Do not strip Otto functionality to get upstream tests green.
5. Protocol parsing remains backward-compatible in both directions. New fields are optional; normalize after validation. New functionality is capability-gated in one place. Preserve existing wire names and persisted identities. Read `docs/protocol-validation.md`, `docs/protocol-compatibility.md`, and `docs/rpc-namespacing.md` before wire changes.
6. App behavior must use the platform and layout gates prescribed in `packages/app/AGENTS.md`. Read `docs/expo-router.md` before root-layout/routing changes. Read `docs/unistyles.md`, `docs/hover.md`, and `docs/design.md` before styling changes; read `docs/glossary.md` before UI copy changes.
7. Never restart the installed daemon on port 6868. Dev uses port 6788 and checkout-local `OTTO_HOME`. Never interpret a timeout as permission to restart. Read `docs/preview.md` before using preview/browser verification and prefer the running workspace-scoped server. Do not introduce a parallel browser stack.
8. Never run the full local test suite. Read `docs/testing.md`; run only the specific relevant changed test file, using `npx vitest run <file> --bail=1`, optionally narrowing by test name. For browser work, inspect the repository Playwright contract and run a single named spec with bounded workers. Coordinate heavy checks so agents do not freeze the same machine. Do not add provider-auth checks to tests.
9. Run repository npm lint and typecheck scripts after code changes. Build the owning workspace declaration stack before diagnosing cross-package type errors. Run formatting through npm scripts; run `npm run format` before any authorized commit. Do not manually patch formatting or weaken tests to silence failures.
10. Scratch scripts, captures, and logs belong in `.tmp/<task-id>/`. Use isolated test homes and fixtures. Never experiment on a user's installed skill directories, live daemon config, workspace data, or provider sessions. Keep needed handoff evidence until the coordinator has captured the durable result.
11. Do not commit, push, merge into shared main, deploy, publish, tag, or release solely on this document's authority. Those actions require the dispatch block's explicit authorization or an existing user instruction. Reversible local investigation and scoped edits are the assigned work. If commits are authorized, author and committer are `Draekz <draekz@gmail.com>`, without AI attribution.
12. Workers report verified outcomes and uncertainties. The coordinator reconciles durable findings/project status through Otto Knowledge at the end, without confirming proposals automatically. Do not create competing progress documents or edit Knowledge Markdown directly.

### Dispatch block: coordinator fills this before each launch

```text
Task ID:
Agent name/profile:
Candidate base SHA:
Assigned worktree absolute path and branch:
Dependency results and exact commits/patches available:
Assigned file ownership and known concurrent work:
Allowed test slot / dev server ownership:
Commit/push/CI-dispatch authorization, if any:
Required result destination: return a final report to the coordinator
```

An omitted field is not an invented value or implied permission. If essential dispatch information is missing, establish it through read-only inspection, then request only the information that cannot be determined. Continue independent analysis while waiting.

## Assignments and sequencing

Agent labels denote separate assignments, not predetermined models or existing agent IDs. If later launching through Otto, the coordinator discovers available agent profiles and matches their roles/guidance rather than hardcoding a model.

| Agent | Assignment                                                           | Depends on                                           | Ownership / parallelism                                          | Status                                                                                                                           |
| ----- | -------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 00    | Candidate baseline and coordination                                  | None                                                 | This handoff and candidate identity; no repair work              | Complete: plan only                                                                                                              |
| 01    | Restore plugin Command Center integration                            | 00                                                   | Plugin registration and its app mount; first root-layout edit    | Integrated; full plugin browser path passed under 04                                                                             |
| 02    | Preserve desktop skill selection across upgrade                      | 00; 01 integrated before overlapping app edits       | Skill migration/startup; second root-layout edit                 | Complete and integrated; attached/cold Electron passed                                                                           |
| 03    | Triage and repair server/CI failures                                 | 00                                                   | Server test failures and CI setup; excludes Agent 02 ownership   | Complete and integrated; independent residual tasks explicit                                                                     |
| 04    | Triage and repair browser/Electron failures                          | 00; consume 01/02 results before overlapping repairs | App/browser/Electron behavior; no competing plugin/skill fixes   | Complete and integrated; compact/plugin/placement/Preview and Windows Electron proof passed; independent residual tasks retained |
| 05    | Audit remaining integration and provider/protocol boundaries         | 00                                                   | Read-only audit; returns new task prompts                        | Complete; bounded repair reviews accepted                                                                                        |
| 06    | Add a regression guard for missing integration entry points          | 05 inventory; final 01/02 shape                      | Guard scripts, guard tests, merge playbook                       | Complete and integrated; all eight final-SHA obligations pass                                                                    |
| 07    | Reproduce mergeability measurements and prescribe bounded follow-ups | 00; refresh after 01–06                              | Read-only architecture analysis and explicit future-task prompts | Complete; final candidate unchanged at 191 files/828 hunks and 337 raw paths                                                     |
| 08    | Integrate results and verify the exact candidate                     | Completed required repairs and audit dispositions    | Combined candidate, final evidence, Knowledge reconciliation     | Local integration and combined checks complete; exact-SHA CI awaits approval                                                     |
| 09    | Preserve steering through provider profiles                          | 05 confirmed defect                                  | Provider wrapper and focused manager/wrapper tests               | Complete and integrated                                                                                                          |

Initial parallel work can include 01, 03, 05, and 07's analysis, subject to available slots and one heavy test slot. Agent 02 may analyze while 01 edits, but their shared root-layout changes must be integrated in order. Agent 04 may classify CI failures early; it must wait for the relevant owner's result before changing overlapping code. Agents 03 and 04 route CI workflow edits through 03. Agent 06 starts from the verified entry-point inventory, not an assumed list. Agent 08 integrates existing work only; it does not quietly become the owner of an unbounded repair backlog.

## Agent 00: establish the candidate and dispatch contract

### Coordinator baseline record, 2026-09-05

This supplement preserves the original Evidence and scope references above. It does not reinterpret the prior audit as a review of a newer tree.

**Selected source candidate B: reviewed-local-head `7457ca46ec3f4fe0ae329d9f1bcd945954423525`.** This is an immutable investigation baseline, not an identified 0.9.2 release or a verified release candidate. The checkout currently points to `b77d4bb5b637abd2547893d83cebcb2c8dd835c6`; workers must supply B explicitly instead of accepting the worktree tool's default upstream starting ref.

**Prepared reconciliation R:** combine B with pinned origin/main `3759502dbbb125da2ec98fcf08d325a5d49a55ea`. The exact rehearsed result is Git **tree** `c7cfae82878134466ccc249bd98aa68fdd5b1449`. R's **commit SHA is UNASSIGNED**: no integration commit, branch, or worktree was created. This tree is reproducible evidence, not a commit that can be dispatched as an agent's HEAD. Initial repair workers start only after the coordinator materializes and records R under separately authorized execution. Read-only 05 and historical 07 can use B directly.

**Unresolved release question sent to the user:** Which exact tag, commit SHA, or release URL identifies the intended Otto 0.9.1/0.9.2? If there is no separate release ref, keep this review explicitly scoped to B. No response is assumed. This question blocks release-specific attribution, not the B/common-ancestor analysis or preparation below.

#### Before/after ref inventory

Read local refs and queried live remotes using `git ls-remote`; they agreed, so **no fetch was needed or performed**. No branch checkout, ref update, staging, commit, tag, merge into main, push, CI dispatch, or release command was performed. Values below are commit SHAs except where explicitly labeled tag objects. Before and after are identical.

Complete local ref inventory checks at `2026-09-05T15:45:17.236Z` and `2026-09-05T15:52:03.640Z` each contained 643 refs. The UTF-8 output of `git for-each-ref --format="%(refname) %(objectname) %(*objectname)"` had SHA-256 `77a5efe9411e3a0e3f492c1f9144a65a7aae65c7ed36c985d016db113a1a4f92` both times. Live origin/upstream queries were repeated at the end and returned the same scoped refs below.

| Ref or evidence                                           | Before                                     | After  |
| --------------------------------------------------------- | ------------------------------------------ | ------ |
| HEAD, refs/heads/main                                     | `b77d4bb5b637abd2547893d83cebcb2c8dd835c6` | Same   |
| refs/remotes/origin/main; live origin refs/heads/main     | `3759502dbbb125da2ec98fcf08d325a5d49a55ea` | Same   |
| refs/remotes/upstream/main; live upstream refs/heads/main | `78b285059f6ebd0b257c98bd191df4626721270a` | Same   |
| Otto refs/tags/v0.9.0, local and live origin, peeled      | `7e9921df7d534780b0c00afc19584553a6148c9a` | Same   |
| Otto v0.9.0 tag object                                    | `36d1fd2aa91f994515da06a4af2518302776ff7e` | Same   |
| Local and live origin refs/tags/v0.9.1 / v0.9.2           | Absent                                     | Absent |
| refs/upstream-tags/v0.6.1; live upstream v0.6.1, peeled   | `20d7efc46a316f5a274b9943a5c43b0322269825` | Same   |
| Paseo v0.6.1 tag object                                   | `3904190836e4d82577849f3ca053c36ef65f9e65` | Same   |
| Local Otto refs/tags/v0.6.1, peeled; NOT Paseo            | `9db2c849747ce3c5767d78cb4016d7541352aaa6` | Same   |
| Local Otto v0.6.1 tag object                              | `42d797a61e587096cf56905296bc70295598efd9` | Same   |

The upstream fetch configuration already maps `+refs/tags/*:refs/upstream-tags/*` separately from upstream branches. Do not use bare `v0.6.1`. The integration merge `4b279544f967f58b39df1aaf30bd1e722e8fceb9` has first parent `b6735559a98d0143d0127814696f35a091860845` and second parent **actual Paseo** `20d7efc46a316f5a274b9943a5c43b0322269825`. B's merge base with the fixed future-upstream target is that same Paseo commit.

Root package.json and all 13 declared Otto workspace manifests report 0.9.0 at B, current local main, and pinned origin/main. Paseo's root and 11 workspace manifests report 0.6.1 at its peeled commit. B's changelog begins `0.9.0 - 2026-09-03`; its About constants say `Paseo` / `0.6.1`. The live GitHub release list identifies v0.9.0 published at `2026-09-04T04:04:14Z`, followed by 0.8.x releases, with no 0.9.1/0.9.2 in the latest 15 entries. Package versions and untagged commits do not establish a later release identity.

Existing worktrees, all left in place:

- `C:/Users/phili/Projects/otto-code`: main at `b77d4bb5b637abd2547893d83cebcb2c8dd835c6`.
- `C:/Users/phili/.otto/worktrees/0pkiflkb/codeql-timeout`: security/codeql-nonshipped-corpus at `edd33f56f83f1673ba55f7b080de89558a7c6d10`.
- `C:/Users/phili/Projects/otto-code/.tmp/android-tablet-build`: detached at `2f240be17f19cb9eeea8fd62cfdb30d0e426a0b2`.

#### Included changes and required reconciliation

The sole common ancestor of B/current local main and origin/main is `9cd59076e38a2821803e21dc0fdb01286ea8de82`. B is two commits ahead and six behind origin/main; current local main is four ahead and six behind. First-parent traversal verifies 36 follow-up commits between the integration merge and B, or 37 including the merge. B includes the v0.9.0 cut, subsequent lockfile/Nix repair `19b45a0492dcb0edd911cb500c45a0ce6a05c73e`, CodeQL triage merge `3a021aa24214812dc8889624e8438146be5d5a00`, Android Hermes build ordering `9fabfc29667d07a732c2a240705fa2c716b0b32d`, CI-tier repairs `00e2e8472ad7b361215e41efff76643437a35e8b`, and CodeQL timeout merge `9cd59076e38a2821803e21dc0fdb01286ea8de82` shared with origin/main.

| Local-only commit, parent order            | In B / planned R | Scope established from commit diff                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `c830d484eb8ebab76bf3dcd7a78c6dff9a4b5806` | Yes / Yes        | Interface and capability convergence across 146 files, including compact toolbar/status geometry, appearance/context handling, project Knowledge, provider image output, agent capabilities, and desktop packaging. This is the broad local delta in the original audit. |
| `7457ca46ec3f4fe0ae329d9f1bcd945954423525` | Yes / Yes        | Changes checkbox selection and bulk rollback through additive file-header/context-menu integration, plus two-file browser coverage.                                                                                                                                      |
| `79c7cb9c127d56f1ee94e6ddc2f6611c3896236c` | No / No          | Later Changes default-view preference. Preserved on current main; outside the selected historical baseline.                                                                                                                                                              |
| `b77d4bb5b637abd2547893d83cebcb2c8dd835c6` | No / No          | Later Preview toolbar management and browser automation changes. Preserved on current main; outside the selected historical baseline.                                                                                                                                    |

All six remote-only commits must be retained by R, including their merge ancestry. **B contains none of these six**; a read of B is not evidence that the remote fixes are present.

| Remote-only commit, ancestry order         | Effect                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3a980b2e43b4032ada149fa0b6dfa0cf84bc9e13` | Agent MCP limiter: 120 requests per 60 seconds keyed by socket peer, before authorization/session construction; bootstrap wiring, limiter module and test. |
| `903f8618db037a67dffea2acdc49fc26d24b1d35` | PR #38 merge, parents `9cd59076e38a2821803e21dc0fdb01286ea8de82` and `3a980b2e43b4032ada149fa0b6dfa0cf84bc9e13`.                                           |
| `6da551d241819b310204f43b7204159dcae8869a` | Removes backtracking regular expressions from user-derived todo-reminder cleanup and spoken-input unwrapping; includes regression cases.                   |
| `67c8a8eb771829f74583662085a31138eec6c591` | PR #39 merge, parents `903f8618db037a67dffea2acdc49fc26d24b1d35` and `6da551d241819b310204f43b7204159dcae8869a`.                                           |
| `edd33f56f83f1673ba55f7b080de89558a7c6d10` | CodeQL ignores nonshipped daemon E2E and Archify generator corpus. Scan configuration, not a runtime security fix.                                         |
| `3759502dbbb125da2ec98fcf08d325a5d49a55ea` | PR #40 merge, parents `67c8a8eb771829f74583662085a31138eec6c591` and `edd33f56f83f1673ba55f7b080de89558a7c6d10`.                                           |

With Git `2.54.0.windows.1`, these exact commands each returned exit 0, one tree SHA, and **zero conflicted paths**:

```text
git merge-tree --write-tree --name-only 7457ca46ec3f4fe0ae329d9f1bcd945954423525 3759502dbbb125da2ec98fcf08d325a5d49a55ea
=> c7cfae82878134466ccc249bd98aa68fdd5b1449
git merge-tree --write-tree --name-only b77d4bb5b637abd2547893d83cebcb2c8dd835c6 3759502dbbb125da2ec98fcf08d325a5d49a55ea
=> 3707fa8909f6ae44bd1cb29dfeae53d0e685a489
```

These commands write Git objects only. Local-only and remote-only deltas have **no overlapping paths** relative to the common ancestor, for either rehearsal. The remote delta is exactly eight files: `.github/codeql-config.yml`; `packages/server/src/server/bootstrap.ts`, `request-rate-limiter.ts`, `request-rate-limiter.test.ts`, `voice-config.ts`, `session.voice-mcp-config.test.ts`, `agent/todo-reminders.ts`, and `agent/todo-reminders.test.ts`. There are no current textual conflicts to resolve. Semantic checks remain required, particularly preserving MCP limiter wiring when 02 changes bootstrap startup. Agent 03 owns CI/CodeQL configuration and must retain the remote exclusions.

Prepared execution sequence, **not executed**:

1. Recheck worktree status and refs. Keep the snapshot B pinned if main moves. Discover profiles and load the Otto skill/tool contracts only once execution/worktree creation is authorized. Worktree defaults may choose origin/main and omit both reviewed local commits, so verify the requested B and actual HEAD explicitly.
2. In a new isolated coordinator workspace based on B, reconcile pinned origin/main as a normal two-parent merge, preserving both branches' ancestry. Do not cherry-pick both the implementation commits and their merge commits. Before feature edits, require the resulting tree to equal `c7cfae82878134466ccc249bd98aa68fdd5b1449`. Record the actual R commit only when commits are authorized. Until then, R remains an uncommitted, explicitly identified integration result and implementer dispatch remains pending.
3. Dispatch 01 and 03 from R; 05 and historical 07 can already analyze B. Integrate 01 into the coordinator candidate, then supply that exact result to 02. No concurrent root-layout edits. 02 owns skill-related bootstrap ordering; 03 supplies any unrelated bootstrap request through 00/02.
4. Give 04 the integrated R + 01 + 02 result before any overlapping app edits. 04 may classify old CI logs earlier. 03 alone edits CI workflows, including requests from 04 or 06. Any 03/04 fixes affecting files still owned elsewhere require a specific coordinator ownership transfer.
5. Supply 06 with 05's verified inventory and final 01/02 wiring. Integrate bounded 03/04 repairs and 06's guard; 07 refreshes on this exact candidate against the original fixed target. 08 records every commit/patch and disposition and verifies the combined result.
6. The two post-audit local commits remain preserved on main and are not silently included. If the intended scope is later clarified as current-local-head, use the second rehearsed tree, carry `79c7cb9c127d56f1ee94e6ddc2f6611c3896236c` then `b77d4bb5b637abd2547893d83cebcb2c8dd835c6`, repin all dependent dispatches, and have 04 consume their Changes/Preview behavior before diagnosing residual failures. Neither rehearsal imports today's uncommitted work.

#### User work preserved

At inspection, the index had no staged changes. The following tracked files were modified independently of this assignment; they are excluded from B and R and must not be copied, reset, stashed, formatted, committed, or repaired by these workers:

```text
.otto/knowledge/index.md
docs/suggested-tasks.md
packages/app/src/composer/draft/input-draft.live.test.tsx
packages/app/src/composer/draft/input-draft.ts
packages/app/src/composer/index.tsx
packages/app/src/composer/input/input.tsx
packages/app/src/panels/agent-panel.tsx
packages/app/src/suggested-tasks/compact-card.tsx
packages/app/src/suggested-tasks/overlay.tsx
packages/app/src/suggested-tasks/start-controls.tsx
packages/app/src/suggested-tasks/use-suggested-task-actions.ts
packages/client/src/daemon-client.ts
packages/protocol/src/messages.ts
packages/protocol/src/suggested-tasks.ts
packages/server/src/server/session.test.ts
packages/server/src/server/session.ts
packages/server/src/server/websocket-server.ts
```

Untracked user work also existed:

```text
.otto/knowledge/findings/finding-2026-09-05-paseo-v061-integration-review.md
.otto/knowledge/requirements/suggested-task-panel-shares-inline-provider-model-selection.md
PASEO-061-AGENT-TASKS.md
packages/app/src/suggested-tasks/launch-card.tsx
```

Only this handoff's coordinator information is changed by 00. The draft finding is read through Otto Knowledge and left proposed, with its original content and timeline preserved. No durable architectural truth changed in this coordination task, so there is no Knowledge write. Since the handoff and finding are untracked, new worktrees will not inherit them: the coordinator must deliver read-only copies with the dispatch, while keeping the authoritative ledger here. Workers return reports; they do not edit either copy as a competing ledger.

Concurrent edits continued during inspection: `packages/app/src/suggested-tasks/compact-card.tsx` and the untracked `launch-card.tsx` changed, and two additional tracked files became dirty: `packages/app/src/components/combined-model-selector.tsx` and `packages/app/src/components/ui/split-button.tsx`. They are also excluded and preserved. Apart from this handoff, those were the differences seen by the file-hash comparison; the coordinator did not edit them. The draft finding's before/after SHA-256 is `1536db49e02ee0d37639b4f7557a8cc689679f4cbcbf00bd93bc7a1ad2186fa5`. The index and all refs remained unchanged. Recheck the worktree before any later dispatch because the user is still working.

The final inventory at `2026-09-05T15:54:45.048Z` again verified unchanged HEAD, all refs and index. It also observed further user changes in the already-listed `docs/suggested-tasks.md` and `packages/app/src/composer/index.tsx`, plus newly dirty tracked `packages/app/src/attachments/service.test.ts`, `packages/app/src/attachments/service.ts`, and `packages/app/src/composer/actions.test.ts`. These are included in the preservation boundary as well. This is a timed snapshot of ongoing user work, not a freeze on subsequent edits.

#### Test slot and dispatch readiness

**H1 is the single heavy-check slot**, controlled by 00 and later transferred to 08. No leases are currently granted to workers. Builds, npm typecheck/lint, Vitest, browser/Electron runs, and 07's full merge-cost rehearsal use H1 sequentially. Proposed priority: 01, 03, 02, 04, 06, 07 refresh, 08; 07 historical measurement may borrow an idle slot through the coordinator. Slot order never bypasses dependencies. Read-only source/log inspection can proceed concurrently after execution is authorized. Every lease records task, worktree, actual revision/patch manifest, command, start, completion and result in the coordinator report. No worker starts heavy checks merely because another appears idle.

Dev-server owners and ports are **UNASSIGNED**. Use the existing workspace-bound Preview contract and documented isolated homes; test fixtures allocate dynamic ports. No worker inherits control of the shared checkout dev server or installed daemon. Root-layout ownership is 01, then 02, then 04 only after consumption. Workflow ownership is 03 throughout. Docs/testing.md coverage updates are serialized by the coordinator if more than one worker needs them. No worker owns this ledger.

All branch/path fields below are deliberately UNASSIGNED because no worktrees were created; suggested branch names are proposals, not existing refs. The coordinator must fill actual paths and verify HEAD before launch. Agent labels are assignments, not selected identities. Execution, commits, pushes and CI dispatch remain unauthorized. These blocks are prepared for dispatch completion, not permission to launch now.

```text
Task ID: 01
Agent name/profile: UNASSIGNED; discover after execution authorization
Candidate base SHA: 7457ca46ec3f4fe0ae329d9f1bcd945954423525 (B)
Execution base SHA: UNASSIGNED; requires materialized R, tree c7cfae82878134466ccc249bd98aa68fdd5b1449
Assigned worktree absolute path and branch: UNASSIGNED; separate worktree required; proposed branch review/paseo-061-01-plugin
Dependency results and exact commits/patches available: 00 complete; R reconciliation planned, no commit/patch delivered
Assigned file ownership and known concurrent work: packages/app/src/plugins/command-center/{registration.tsx,contributions.ts}; packages/app/src/app/_layout.tsx first edit; packages/app/e2e/browser/plugin-workspace-panels.spec.ts. 02 waits for root delta; 04 consumes it.
Allowed test slot / dev server ownership: H1 lease required, priority 1; server UNASSIGNED
Commit/push/CI-dispatch authorization, if any: none; execution not yet authorized
Required result destination: final report to coordinator, including exact root-layout patch and runtime proof
```

```text
Task ID: 02
Agent name/profile: UNASSIGNED; discover after execution authorization
Candidate base SHA: 7457ca46ec3f4fe0ae329d9f1bcd945954423525 (B)
Execution base SHA: UNASSIGNED; R plus integrated 01; coordinator must pin it
Assigned worktree absolute path and branch: UNASSIGNED; separate worktree required; proposed branch review/paseo-061-02-skills
Dependency results and exact commits/patches available: 00 complete; R and 01 results UNASSIGNED
Assigned file ownership and known concurrent work: packages/app/src/agent-skills/legacy-migration.tsx; packages/app/src/desktop/daemon/desktop-daemon.ts; packages/app/src/app/_layout.tsx second edit; packages/desktop/src/integrations/legacy-skill-selection.ts; packages/desktop/src/daemon/daemon-manager.ts; packages/server/src/server/orchestration-skills/ and skill-related bootstrap.ts ordering; focused adjacent upgrade tests. Preserve R limiter. 03 routes bootstrap overlap through coordinator; 04 waits for final root delta.
Allowed test slot / dev server ownership: H1 lease required, priority 3; isolated upgrade fixture owner 02 once leased; server UNASSIGNED
Commit/push/CI-dispatch authorization, if any: none; execution not yet authorized
Required result destination: final report to coordinator, including ordered startup proof and all cross-owner patches
```

```text
Task ID: 03
Agent name/profile: UNASSIGNED; discover after execution authorization
Candidate base SHA: 7457ca46ec3f4fe0ae329d9f1bcd945954423525 (B)
Execution base SHA: UNASSIGNED; requires materialized R, tree c7cfae82878134466ccc249bd98aa68fdd5b1449
Assigned worktree absolute path and branch: UNASSIGNED; separate worktree required; proposed branch review/paseo-061-03-server-ci
Dependency results and exact commits/patches available: 00 complete; R pending; starting CI evidence 33924801496 at 3759502dbbb125da2ec98fcf08d325a5d49a55ea, not B
Assigned file ownership and known concurrent work: .github/workflows/ci.yml and all workflow requests from 04/06; .github/codeql-config.yml preservation; packages/server/src/server/artifact/artifact-store-resolver.test.ts; packages/server/src/utils/worktree.posix.test.ts; packages/server/src/server/workflow/workflow-service.test.ts; related implementation edits only after verified diagnosis and ownership assignment. Excludes 02 skill/startup ownership and user session/protocol work. No other workflow writer.
Allowed test slot / dev server ownership: H1 lease required, priority 2; server UNASSIGNED
Commit/push/CI-dispatch authorization, if any: none; execution not yet authorized; remote CI logs read-only
Required result destination: final report to coordinator with disposition for every named failure and requested external CI checks
```

```text
Task ID: 04
Agent name/profile: UNASSIGNED; discover after execution authorization
Candidate base SHA: 7457ca46ec3f4fe0ae329d9f1bcd945954423525 (B)
Execution base SHA: UNASSIGNED; R plus integrated 01 and 02; exact SHA/patch manifest required before repairs
Assigned worktree absolute path and branch: UNASSIGNED; separate worktree required; proposed branch review/paseo-061-04-browser
Dependency results and exact commits/patches available: historical CI 33924801496 at 3759502dbbb125da2ec98fcf08d325a5d49a55ea; 01/02 results UNASSIGNED. May classify logs on B before dependent source edits.
Assigned file ownership and known concurrent work: packages/app/e2e/browser/ failure inventory and packages/desktop/scripts/browser-tab-bridge.e2e.mjs; residual app/sidebar/workspace/Electron repair files UNASSIGNED until triage proves a cause. Root _layout.tsx only after 01 then 02 consumption and explicit ownership transfer; no competing plugin/skill repairs; all workflow changes via 03; user-work paths excluded.
Allowed test slot / dev server ownership: H1 lease required, priority 4; server UNASSIGNED; one named spec and bounded workers
Commit/push/CI-dispatch authorization, if any: none; execution not yet authorized
Required result destination: final report to coordinator with unique-case dispositions, captures, patches, and independent follow-up tasks
```

```text
Task ID: 05
Agent name/profile: UNASSIGNED; discover after execution authorization
Candidate base SHA: 7457ca46ec3f4fe0ae329d9f1bcd945954423525 (B); ready for read-only audit once execution is authorized
Assigned worktree absolute path and branch: UNASSIGNED; proposed isolated read-only worktree review/paseo-061-05-audit, or Git-object reads at B; never inspect dirty main as B
Dependency results and exact commits/patches available: 00 baseline; pre-merge b6735559a98d0143d0127814696f35a091860845; old upstream b44bb63cf4ce089ab5750b9fc621ed52827b2820; Paseo 20d7efc46a316f5a274b9943a5c43b0322269825; merge 4b279544f967f58b39df1aaf30bd1e722e8fceb9; R inventory above. Reverify findings on integrated candidate when supplied.
Assigned file ownership and known concurrent work: read-only integration/provider/protocol audit; scratch only .tmp/agent-05/ in assigned worktree; no source, workflow or ledger edits
Allowed test slot / dev server ownership: source reads need no H1; runtime checks require H1 lease; server UNASSIGNED
Commit/push/CI-dispatch authorization, if any: none; execution not yet authorized
Required result destination: final report to coordinator plus verified entry-point inventory for 06
```

```text
Task ID: 06
Agent name/profile: UNASSIGNED; discover after execution authorization
Candidate base SHA: 7457ca46ec3f4fe0ae329d9f1bcd945954423525 (B, original broken tree)
Execution base SHA: UNASSIGNED; integrated R + final 01/02 wiring and 05 inventory required
Assigned worktree absolute path and branch: UNASSIGNED; separate worktree required; proposed branch review/paseo-061-06-guard
Dependency results and exact commits/patches available: original refs in 00; 05 inventory and repaired candidate UNASSIGNED
Assigned file ownership and known concurrent work: scripts/merge-orphan-guard.mjs and focused guard tooling/tests; docs/upstream-merges.md. Read scripts/upstream-status.mjs and scripts/rebrand-upstream.pl; request ownership before changing shared scripts. CI wiring exclusively through 03; docs/README.md only if a new durable page is justified.
Allowed test slot / dev server ownership: H1 lease required, priority 5; no dev server assigned
Commit/push/CI-dispatch authorization, if any: none; execution not yet authorized
Required result destination: final report to coordinator with broken/repaired ref commands, outputs and documented limitations
```

```text
Task ID: 07
Agent name/profile: UNASSIGNED; discover after execution authorization
Candidate base SHA: 7457ca46ec3f4fe0ae329d9f1bcd945954423525 (B); historical read-only work ready once execution is authorized
Refresh base SHA: UNASSIGNED until integrated 01-06 results are pinned
Assigned worktree absolute path and branch: UNASSIGNED; proposed isolated read-only worktree review/paseo-061-07-mergeability, or Git-object reads; scratch only .tmp/agent-07/
Dependency results and exact commits/patches available: initial 4b279544f967f58b39df1aaf30bd1e722e8fceb9; release 7e9921df7d534780b0c00afc19584553a6148c9a; B; fixed target 78b285059f6ebd0b257c98bd191df4626721270a; normalized base 20d7efc46a316f5a274b9943a5c43b0322269825. Repaired candidate UNASSIGNED.
Assigned file ownership and known concurrent work: read-only architecture/merge measurements and scratch reproducers; no source/docs/workflow/ledger edits; no implementation of proposed follow-ups
Allowed test slot / dev server ownership: full rehearsals require H1 lease, historical work can borrow idle slot; refresh priority 6; server not needed
Commit/push/CI-dispatch authorization, if any: none; execution not yet authorized
Required result destination: final report and retained reproducer evidence to coordinator; at most three bounded future-task prompts
```

```text
Task ID: 08
Agent name/profile: UNASSIGNED; discover after execution authorization
Candidate base SHA: 7457ca46ec3f4fe0ae329d9f1bcd945954423525 (B)
Final integration SHA: UNASSIGNED; R tree c7cfae82878134466ccc249bd98aa68fdd5b1449 is only the pre-repair reconciliation reference
Assigned worktree absolute path and branch: UNASSIGNED; separate coordinator candidate worktree required; proposed branch review/paseo-061-candidate
Dependency results and exact commits/patches available: 00 complete; R commit and 01-07 result manifests UNASSIGNED; all confirmed findings need dispositions
Assigned file ownership and known concurrent work: combine assigned results only, no broad repair ownership; root edits in 01 then 02 order and 04 only after consumption; workflows remain 03-owned. Ledger and Knowledge reconciliation transfer to 08 only when 00 explicitly yields ownership, never concurrent writers.
Allowed test slot / dev server ownership: H1 priority 7; coordinator lease ownership transfers from 00 to 08; server UNASSIGNED
Commit/push/CI-dispatch authorization, if any: none; execution not yet authorized. Must obtain explicit applicable authorization before materializing commits, push or dispatch; no release authorization.
Required result destination: final integrated-candidate report to user/coordinator with source manifest, exact checks, unresolved release identity and coverage limits
```

Verification record, working directory `C:/Users/phili/Projects/otto-code`, HEAD `b77d4bb5b637abd2547893d83cebcb2c8dd835c6` plus the concurrent user changes listed above:

- Ref/history/package inspection and both `git merge-tree` rehearsals completed with the exact results above. No runtime or release sign-off follows from a clean tree merge.
- `npm run format:files -- PASEO-061-AGENT-TASKS.md`: passed. Only this file was targeted.
- `npm run lint`: passed, zero warnings/errors across 5,668 files.
- `npm run typecheck`: exit 1. App errors in concurrent untracked `packages/app/src/suggested-tasks/launch-card.tsx`: line 66, TS2339, trigger state lacks `focused`; line 121, TS2322, `CombinedModelSelectorProps` lacks `customTriggerStyle`. These are local app component types, not a cross-workspace declaration failure. No repair or test weakening was attempted. Other reported workspace typechecks completed without diagnostics. Protocol pretypecheck regenerated its validator through the existing npm script; no tracked validator diff resulted.
- Full local suites, browser/Electron/native runtime checks, release checks, candidate CI and worker launches were not run. The dirty-checkout lint/typecheck results do not certify B or R and may change as the user's source work continues.
- H1 coordinator checks are finished; no worker lease or dev-server ownership is active. Release identity beyond v0.9.0 is still unanswered. 05's read-only audit and 07's historical analysis are fully specified at B; repair dispatches await authorized execution and the actual R/dependency commits.

### Ready-to-run prompt

```text
You are Agent 00, the coordinator for the Paseo 0.6.1 integration review. Work in the Otto repository containing PASEO-061-AGENT-TASKS.md. Read its Evidence and scope, Shared execution contract, and Assignments and sequencing sections first. Your task is baseline identification and a concrete dispatch plan, not source repair or a release.

The prior audit reviewed local HEAD 7457ca46ec3f4fe0ae329d9f1bcd945954423525. The user named 0.9.0–0.9.2, but only v0.9.0 was identifiable. Local and remote main then differed by two local-only and six remote-only commits. Do not label a candidate 0.9.2 without a matching release reference or user clarification.

Read docs/upstream-merges.md, docs/development.md, docs/release.md, the draft integration finding linked in the handoff, and the confirmed upstream seam decision through Otto Knowledge. Inspect the worktree, release tags, package versions, first-parent history, merge parents, and current remote refs. Fetch refs only when needed; do not change the checked-out branch or working tree merely to inspect them. Resolve the actual Paseo v0.6.1 commit, never an ambiguous v0.6.1 tag.

Produce the exact source candidate and explain which reviewed local changes and remote security fixes it contains. Where branches require reconciliation, enumerate the required commits and conflicts and prepare the integration sequence; do not silently merge shared main. If release identity remains unknowable, request the missing ref while continuing the common-ancestor analysis. A reviewed-local-head candidate may be named as such, with the unresolved release identity explicit.

Identify current uncommitted user work, including the prior finding and this handoff, and preserve it. Populate the dispatch fields for each subsequent assignment: base SHA, separate worktree/branch if appropriate, dependencies, file ownership, and a single coordinated heavy-test slot. Root _layout.tsx is edited by 01 then 02; Agent 04 must consume those changes before overlapping edits. CI workflow changes belong to 03. No worker edits this ledger concurrently.

Do not launch agents unless the user has separately instructed execution. This assignment can complete by preparing ready-to-run dispatch blocks. Do not choose agent identities from example model names; discover profiles if launch is actually authorized.

Completion requires an unambiguous baseline, a before/after ref inventory, the precise unresolved release question if any, and dispatch blocks with real values or explicitly unassigned fields. Update this handoff's coordinator-owned baseline/dispatch information without replacing the original audit references. Return what is ready to run and what still depends on an answer. No source fixes, release tags, or deployment.
```

## Agent 01: restore plugin Command Center actions

### Ready-to-run prompt

```text
You are Agent 01, implementing the plugin Command Center repair on the candidate supplied in your dispatch block. Read PASEO-061-AGENT-TASKS.md and obey its Shared execution contract. Your scope is one confirmed integration regression, not a plugin redesign.

At reviewed HEAD 7457ca46e, packages/app/src/plugins/command-center/registration.tsx exports PluginCommandCenterActions, the sole runtime consumer of buildPluginCommandCenterContributions. No app source imports or mounts it. packages/app/src/app/_layout.tsx mounts CommandCenterRootActions and CommandCenterWorkspaceActions near line 720 but omits the plugin contributor. Related CI run 33924801496 fails plugin-workspace-panels.spec.ts at the assertion for the Plugin global action button. Reverify on your assigned candidate; if already fixed, validate the fix instead of duplicating it.

Read docs/plugins.md, docs/expo-router.md, docs/testing.md, packages/app/AGENTS.md, and the confirmed upstream seam decision. Compare the v0.6.1 upstream root composition at 20d7efc46a316f5a274b9943a5c43b0322269825 with Otto's current composition. Follow the existing registration component, CommandCenterProvider, installed-plugin registry, host selection, and workspace/agent context contracts.

Mount the existing contributor at the correct lifecycle boundary with the providers it consumes. Preserve stable registration cleanup, host/workspace selection, disabled/removed plugin behavior, and existing root/workspace contributions. Do not copy its actions into a second registry, bypass context checks, or add a second route mechanism. Keep the upstream-owned root edit as small as possible.

Primary files: packages/app/src/plugins/command-center/registration.tsx; packages/app/src/app/_layout.tsx; packages/app/src/plugins/command-center/contributions.ts; packages/app/e2e/browser/plugin-workspace-panels.spec.ts. Inspect actual imports before changing other files. Agent 02 owns skill migration; report your root-layout delta so it can integrate afterward.

Use the existing real browser/daemon test fixture to prove a configured plugin command appears, runs against the selected host, opens its registered target, disappears on disable/removal, and respects workspace/agent context. Retain the existing wide/compact and unavailable-state assertions where applicable. A helper unit test or string search for a mount is not sufficient runtime proof. Update a spec only when its expectation is independently shown to be obsolete; do not hide a failed command assertion. Add the coverage-matrix entry if you add a spec, following docs/testing.md.

Run the focused spec under the documented preview/test contract with a bounded worker count, plus relevant changed unit files, npm lint, and typecheck. Report the exact command, candidate SHA, number of exercised cases, and any unavailable platform coverage. Finish with changed files, the mount/provider rationale, verification, and the precise root-layout patch Agent 02 must inherit. Do not commit or push unless separately authorized in the dispatch block.
```

## Agent 02: preserve skill-selection intent during desktop upgrade

### Ready-to-run prompt

```text
You are Agent 02, repairing desktop skill-selection migration and its startup ordering. Read PASEO-061-AGENT-TASKS.md and its Shared execution contract. Use the assigned candidate with Agent 01's root-layout change integrated before you edit that file. You own skill migration, its daemon-startup coordination if required, and focused upgrade tests.

At pre-merge Otto b6735559a98d0143d0127814696f35a091860845, desktop custom selections were stored under Electron userData/skill-selection.json by integrations/skills/selection-store.ts. Current ownership is daemon config. packages/app/src/agent-skills/legacy-migration.tsx exports LegacyAgentSkillsMigration and migrateLegacyAgentSkillsSelection, but the component had no runtime mount at audited HEAD 7457ca46e. The desktop legacy read/delete IPC handlers still exist. The daemon defaults an unset selection to {mode:'all'} and calls orchestrationSkills.autoUpdate() during bootstrap. Merely mounting the migration after the daemon starts may leave the original startup race intact.

Read docs/development.md, docs/configuration.md, docs/data-model.md, docs/expo-router.md, docs/testing.md, and the upstream seam decision. Read applicable desktop/server/app instructions. Inspect packages/desktop/src/integrations/legacy-skill-selection.ts, packages/desktop/src/daemon/daemon-manager.ts, packages/app/src/agent-skills/legacy-migration.tsx, packages/app/src/desktop/daemon/desktop-daemon.ts, packages/server/src/server/orchestration-skills/, and bootstrap.ts. Compare upstream 0.6.1, but verify ordering independently.

First trace the full upgrade sequence: which process can read Electron userData, when daemon maintenance starts, when the local managed host connects, when selection import occurs, and when its source may be deleted. Select the smallest existing-boundary solution that makes the persisted intent available before automatic maintenance can expand a partial selection. Do not make a daemon reach into an arbitrary user's Electron directory or trust any remote host as the migration destination.

Required behavior: import a valid legacy custom selection only when the managed local daemon has no explicit selection; preserve explicit daemon configuration; distinguish custom-empty from missing; preserve all-mode behavior; do not delete the legacy source before a durable successful outcome; retry recoverable failures safely; make repeated startup/import idempotent; never apply the local desktop selection to another host. Preserve existing parsing compatibility if coordination needs a protocol addition. State the existing malformed-file behavior and retain it unless a change is necessary and justified.

Reproduce the dangerous ordering in isolated fixtures before fixing it: seed a custom selection and a partial installed skill set, delay connection/import, and show which maintenance operation would add excluded skills. Then prove the corrected actual startup/IPC/migration path cannot do so. Also cover explicit daemon selection, empty custom selection, no legacy file, failed import, restart/retry, and a connected nonlocal host. Unit tests of the migration helper alone do not meet acceptance. Reuse the desktop/daemon test harness with temporary homes, never real installed skill directories or the installed daemon.

Coordinate any bootstrap overlap with Agent 03 and root-layout overlap with Agent 01/04. Run only focused changed test files and bounded upgrade checks, then npm lint/typecheck after rebuilding owning declarations if needed. Return the startup sequence before/after, proof of persistence and ordering, exact tests, remaining limitations, and all cross-owner file changes. Do not broaden into skill-catalog redesign, confirmed Knowledge changes, or publishing.
```

## Agent 03: triage server failures and CI setup

### Ready-to-run prompt

```text
You are Agent 03, responsible for bounded server and CI-setup repairs after the Paseo 0.6.1 integration. Read PASEO-061-AGENT-TASKS.md and obey its Shared execution contract. Use the coordinator's candidate SHA; do not treat related remote CI as an exact run of that candidate.

Read docs/testing.md, docs/ad-hoc-daemon-testing.md, docs/development.md, docs/upstream-merges.md, and subsystem documentation for each diagnosed failure. Related remote-main run 33924801496 at 3759502db contains these starting observations: Linux artifact-store-resolver.test.ts expects a relative C:/repos spelling where the implementation produces a resolved absolute path; Linux worktree.posix.test.ts expects rejection for a non-origin base but receives a valid result; Windows workflow-service.test.ts fails with ENOTEMPTY during cleanup, with four unhandled worker-exit errors elsewhere; one CLI shard and one browser shard fail during provider-CLI installation with ETARGET. These are observations, not five confirmed production bugs.

Read the actual job logs, preserve failure signatures in your scratch directory, and map each to its current source revision. Inspect the test's intended contract, merge history, and production path before changing an assertion or implementation. Produce a disposition for every named failure: product regression, stale/wrong expectation, test lifecycle defect, external setup failure, already fixed, or unresolved with evidence. Do not call a cleanup failure a failed workflow cancellation without tracing it.

Fix only root causes you verify. Use platform-correct isolated paths for the artifact fixture if the implementation contract confirms that expectation. Determine the non-origin worktree/base behavior from docs and Git history rather than automatically replacing rejects with resolves. Trace background writes and test shutdown for ENOTEMPTY; do not mask races with arbitrary sleeps. Investigate worker exits using the existing diagnostics before altering timeouts, workers, or process termination. Resolve CLI install determinism within the established CI setup contract; do not add provider-auth checks, broad skips, or blanket continue-on-error.

You own .github/workflows/ci.yml changes required by this triage; Agent 04 sends any workflow requests through you. Agent 02 owns skill startup and its tests. Obtain coordination before overlapping changes. Do not run the server workspace suite locally. Reproduce one relevant file/case at a time, use CI for the full matrix only when dispatch authorization allows it, and preserve useful failing evidence when the current platform cannot reproduce Linux/Windows-specific behavior.

Completion requires a disposition for each named failure, bounded fixes and regression proof for verified owned defects, unchanged coverage for unrelated cases, lint/typecheck results, and an explicit list of unresolved CI items. Return the exact commit/patch base, files, test commands, and which CI jobs must verify the result. Broader failures become separately specified task requests, not silent scope expansion. No shared-main merge, push, or release without separate authorization.
```

## Agent 04: triage browser and Electron integration failures

### Ready-to-run prompt

```text
You are Agent 04, investigating browser and Electron failures around the Paseo 0.6.1 integration. Read PASEO-061-AGENT-TASKS.md and its Shared execution contract. Your first deliverable is an evidence-backed failure inventory; fix only verified causes inside your ownership. Do not rerun the full browser matrix locally.

Read docs/testing.md, docs/preview.md, docs/browser-capture-harness.md, docs/expo-router.md, docs/explorer-sidebar.md, and packages/app/AGENTS.md. Use the existing Otto preview/browser tools and documented Electron harness. Prefer the running workspace-scoped dev server, with the dev home/port isolation intact. Read styling and scrolling docs before touching those behaviors.

Starting evidence is remote-main CI run 33924801496 at 3759502db. One browser shard failed at provider installation; the other seven ran tests and failed. Failures span Settings/navigation, workspace/sidebar state, editor, composer, and plugin cases. The Linux Electron browser-tab bridge timed out waiting for a seeded sidebar workspace at browser-tab-bridge.e2e.mjs:292, before browser assertions executed. This does not establish a browser IPC bug. Agent 01 owns missing plugin command registration. Agent 02 owns skill migration. Consume their integrated patches before diagnosing residual failures in those paths.

Download/read available failed-test logs and relevant screenshots/traces. Build a unique-case inventory with test name, job and revision, first failing action/assertion, observed UI state, likely shared setup dependency, and current-candidate status. Separate failures during setup from failures after the feature is exercised. Group by demonstrated root cause; a shared timeout text alone does not prove a shared cause. Route installation/workflow problems to Agent 03.

Reproduce representative failures through the real user path, using one named spec at a time and a bounded worker count. Prioritize app startup, host/workspace hydration, route restore, pane/tab placement, and error visibility before cosmetic assertions. For Electron, verify seeded host/workspace identity, hydration, filters, and navigation before changing the browser bridge. Preserve compact/wide behavior, native fallback, user-selected tab placement, and reader-owned scroll position. Do not restore an old competing Explorer implementation or weaken tests to make a new UI pass.

Implement minimal verified fixes in owned files, with behavioral regression coverage and the coverage-matrix update when adding specs. Do not edit root _layout.tsx concurrently with 01/02. If the workload contains independent remaining causes beyond a bounded repair, return one ready-to-run task prompt per cause with file ownership, reproduction, expected behavior, and acceptance; do not claim the browser tier is fixed.

Completion requires disposition of every downloaded unique failure, proof for each repaired cause, screenshots/trace evidence where it establishes behavior, focused tests plus npm lint/typecheck, and explicit platform/CI coverage still required. A passing unit test is not Electron or native proof. Return the exact candidate/patch and which cases Agent 08 must verify in CI. No release or broad local test run.
```

## Agent 05: audit integration entry points and provider/protocol behavior

### Ready-to-run prompt

```text
You are Agent 05, a read-only integration auditor. Read PASEO-061-AGENT-TASKS.md and its Shared execution contract. Your assignment is to discover remaining merge defects and prepare exact repair tasks, not to refactor or compete with Agents 01–04.

The review at 7457ca46e found new upstream components whose implementations and helper tests survived but whose application mounts did not: PluginCommandCenterActions and LegacyAgentSkillsMigration. An existing guard counts importers of Otto-only modules, which does not cover new upstream entry points and cannot establish that an imported React component actually mounts. Audit the full merge boundary using pre-merge b6735559a, upstream base b44bb63cf, target 20d7efc46, and merge 4b279544f, then verify each observation against the assigned current candidate.

Read docs/upstream-merges.md, docs/architecture.md, docs/timeline-sync.md, docs/chat-lifecycle.md, docs/subagent-accounting.md, docs/providers.md, docs/protocol-validation.md, docs/protocol-compatibility.md, docs/rpc-namespacing.md, and the confirmed upstream seam decision. Read area-specific mandatory docs before runtime investigation. Knowledge charters can be stale; compare them with current docs and code.

Build a bounded integration inventory from added/changed upstream providers, registrations, migration callers, IPC handlers, RPC dispatch/capability gates, and extracted functions. For each entry identify producer, transport/registration, real caller or mount, owning platform/host/provider, tests that exercise the entry point, and deliberate-exclusion evidence. Detect the paired failure modes: a new implementation with no live entry point, and an upstream extraction whose original inline logic still executes as well. Retained inert upstream modules are not automatically defects.

Prioritize agent turn start/interrupt/steer/queue/rewind, timeline reconnect/gap/optimistic reconciliation, observed/provider subagent projection and duplicate suppression, and newly added protocol fields. Identify supported provider families from the current provider registry; include local OpenAI-compatible/Brain behavior as well as hosted providers. Distinguish missing provider capability from a merge regression. Do not invent credentials, start user's live agents, or add auth checks to tests. Use isolated fixtures and existing focused tests when appropriate; mark unexercised real-provider paths explicitly.

For wire changes, compare old/new schemas and actual senders/receivers, including capability negotiation. Do not claim full compatibility from the nine already-passing wire tests. For context/providers and IPC, trace runtime ownership, not only exported-symbol/import counts. Revalidate the previously noticed large-file notice, tab-overflow module, and desktop editor replacement without assuming an unused file means lost functionality.

Return an inventory for Agent 06, a severity-ranked findings list with candidate SHA, source locations, trigger, expected/actual behavior, before/after provenance, proof, and confidence. Return a complete future-agent repair prompt for each new confirmed independent defect, specifying scope, dependencies, verification, and completion criteria. Separate hypotheses, intentional exclusions, already-fixed cases, and pre-existing architecture debt. Do not modify application code, confirm Knowledge, or claim a release sign-off.
```

## Agent 06: guard against missing merge integrations

### Ready-to-run prompt

```text
You are Agent 06, implementing a narrowly scoped merge-regression guard after receiving Agent 05's verified integration inventory and the final shape of Agents 01/02's repairs. Read PASEO-061-AGENT-TASKS.md and its Shared execution contract. You own guard tooling/tests and the corresponding merge-playbook instructions, not feature repairs.

Read docs/upstream-merges.md, docs/testing.md, scripts/merge-orphan-guard.mjs, scripts/upstream-status.mjs, scripts/rebrand-upstream.pl, and Agent 05's inventory. The existing guard snapshots live importers of Otto-only files before a merge and checks them afterward. Preserve that useful behavior. Its blind spots include new upstream registrations/migrations and the difference between importing a component and mounting it.

Design the smallest maintainable extension that detects the verified plugin-command and skill-migration omissions in the original merge/candidate trees, while accepting their repaired wiring. Use explicit reference inputs and a small evidence-backed integration contract where generic static analysis cannot establish runtime ownership. Do not build a purported universal React call-graph analyzer or report mere import count as proof. Keep machine-detected candidates distinct from verified invariant failures; only deterministic violations should become a failing gate.

Required properties: comparison works against supplied Git refs without checking them out; upstream tag names cannot collide with Otto release tags; branding/path changes and upstream renames are handled or explicitly reported as unsupported; deliberate exclusions such as Hub and deferred plugin themes are recorded with reasons; syntax/parse errors or a missing pre-merge baseline do not yield a false green; the reviewed post-merge state is not silently captured as a pre-merge baseline; output identifies the missing edge and the expected owner. Preserve current guard invocations or document an explicit compatible extension.

Test on small synthetic repository/source fixtures: live registration retained, real mount removed while import/helper tests remain, legitimate entry-point relocation, upstream rename, deliberate inert module, new upstream integration missing its mount, and invalid/missing baseline. Also demonstrate detection against the pinned broken tree and acceptance against the repaired candidate. A test that only searches for one exact JSX string is insufficient for equivalent valid wiring.

Update docs/upstream-merges.md with exact commands, when baseline capture occurs, exclusions, and limitations. If creating a new durable docs page, add it to docs/README.md. Coordinate CI workflow wiring with Agent 03; do not alter the workflow concurrently or introduce a gate that fails valid retained exclusions.

Run focused guard tests, the documented historical/candidate checks, npm lint/typecheck, and formatting via npm. Return supported guarantees, deliberate limits, exact before/after output, commands for Agent 08 and the next upstream merge, and maintenance ownership. No production code refactor and no claim that a static guard replaces behavioral smoke tests.
```

## Agent 07: measure merge cost and prescribe architectural follow-ups

### Ready-to-run prompt

```text
You are Agent 07, performing mergeability analysis and writing bounded future-agent prompts. Read PASEO-061-AGENT-TASKS.md and its Shared execution contract. This is a read-only architecture assignment: do not implement a subagent rewrite, extract large modules speculatively, or merge newer upstream code.

Read docs/upstream-merges.md, docs/architecture.md, docs/explorer-sidebar.md, docs/subagent-accounting.md, the confirmed upstream-mergeability-through-otto-owned-seams Knowledge decision, and the current upstream-subagent-convergence record. Read the latter critically against current code and the amended subagent decision in docs/upstream-merges.md: the retained provider row/panel is intentional, and not all old charter assertions describe today's implementation.

The fixed experiment compares initial merge 4b279544f, Otto v0.9.0 7e9921df7, and reviewed HEAD 7457ca46e against the SAME upstream target 78b285059f6ebd0b257c98bd191df4626721270a, with Paseo v0.6.1 20d7efc46 as the normalized three-way base. Do not substitute current upstream/main or interpret that target as a release recommendation.

Reproduce raw git merge-tree conflicted-path counts without touching the index/worktree. Reproduce normalized comparisons of matching TypeScript/JavaScript paths under packages/, including tests/declarations, with ordered scripts/rebrand-upstream.pl substitutions and CRLF normalization. Keep source-only same-path merge-file counts separate from whole-tree counts. State handling of renames, additions/deletions, binary content, generated files, and formatting. Check Git merge-file error semantics; errors are not clean merges. Record tool versions and exact ref SHAs. Retain reproducer scripts in .tmp/agent-07 until the coordinator captures evidence.

Expected historical results to verify, not hardcode: normalized conflicts 181 files/797 hunks at initial merge, 187/821 at 0.9.0, 191/828 at reviewed HEAD; raw conflicts 325/332/337. If results differ, explain the method difference or correct the measurement with evidence. Repeat on the repaired candidate after Agents 01–06 finish, preserving the same comparison target.

Rank a small set of costly shared seams by measured overlapping hunks and functional ownership, including AgentManager, Session, DaemonClient, workspace-screen/pane-host integration, and Claude/provider subagent ingestion. A file's size alone is not a refactor justification. Identify what upstream should own and which exact Otto behaviors need an adapter, policy module, or projection. Account for all providers, nested identity, stop control, accounting, persistence, old wire clients, and intentional provider-only rows where relevant. Preserve upstream ancestry and adopted pane mechanisms.

Return at most three prioritized, independently executable refactor proposals. Each proposal must include a complete agent prompt: measured problem, source and upstream references, exact owned files, boundary/interface to introduce or use, preserved behavior, migration/wire constraints, dependencies, non-goals, behavioral tests, the fixed rehearsal to rerun, and an explicit acceptance threshold. If a precise design or behavior proof is missing, make the task an investigation with a concrete output rather than pretending implementation is fully prescribed. No task may succeed by dropping Otto features, deleting retained upstream files, or merely moving text until counters decrease.

Conclude whether the repaired candidate measurably improves, worsens, or leaves merge cost unchanged, with limitations. Send reproducer evidence and proposal prompts to the coordinator for inclusion in this handoff. These proposals are not automatically authorized for execution by this analysis assignment.
```

## Agent 08: integrate and independently verify the candidate

### Ready-to-run prompt

```text
You are Agent 08, integrating completed work and verifying the exact resulting candidate. Read PASEO-061-AGENT-TASKS.md and its Shared execution contract. Start only with Agent 00's baseline/ownership record and the exact patches or commits and result reports from Agents 01–07. Audit findings must have dispositions; unresolved confirmed defects cannot disappear into a summary.

Read docs/development.md, docs/testing.md, docs/upstream-merges.md, docs/protocol-compatibility.md, docs/release.md, and the current draft integration finding through Otto Knowledge. Inspect the worktree and all branch bases. Preserve unrelated changes. Combine only the assigned work in an isolated candidate workspace when authorized; do not reset/rebase shared main or assume a worker branch includes another worker's changes.

Integrate in dependency order: baseline reconciliation; plugin mount; skill migration/startup ordering; bounded server and browser fixes; verified guard. Resolve shared root-layout/bootstrap/workflow edits semantically, checking provider nesting, migration sequencing, and preserved Otto controls. Do not blindly choose one side. Record the exact source commit for each integrated result. Check for dropped registrations or duplicated extracted logic after integration.

Independently review the two confirmed defect repairs through their complete paths. Confirm plugin action discovery/execution/cleanup for the selected host and context. Confirm a legacy custom skill selection controls maintenance before excluded skills can be installed, preserves explicit daemon configuration, and cannot migrate to a remote host. Review Agent 05's protocol/provider inventory and every additional confirmed defect's disposition. Run Agent 06's guard and consume Agent 07's fixed-target measurements.

Run npm lint, typecheck with current owning declarations, and formatting according to repo rules. Do not rerun a worker's unchanged passing suite merely for ceremony; rerun focused tests where integration/conflict resolution changed behavior or a coverage gap remains. Never run the full suite locally. For full verification, use a CI run belonging to the exact candidate SHA only when push/dispatch is explicitly authorized. If not authorized, prepare the concrete candidate and say which external action remains; do not call it verified across the matrix. Inspect executed jobs and test results, not just a green workflow badge or setup success.

The acceptance matrix includes server Linux/Windows, app units, SDK/protocol and relay, named browser user paths, real Electron integration, and applicable Android/native checks. Explain what each passing job actually exercised. A native test job is not an installed-mobile smoke test, and browser tests are not real-provider proof. Classify skips, cancellations, installation errors, stale assertions, runtime failures, and unavailable environments separately. Verify Paseo ancestry, correct About base identity, and Hub exclusion after build.

Return remaining blockers as explicit tasks to their owners, with reproduction and required proof. Do not secretly implement broad architecture proposals from Agent 07. Candidate sign-off requires no undisposed high-severity integration defect, the agreed checks passing on the exact SHA, and explicit disclosure of remaining coverage limits. This assignment does not authorize a release, version bump, tag, npm publication, or deployment.

As coordinator, update this handoff's statuses and evidence, and reconcile the existing draft Knowledge finding rather than create a parallel audit ledger. Record what changed, exact candidate SHA, test/CI links, measured future-merge cost, and unresolved work with reasons. Keep Knowledge review status proposed unless the user explicitly confirms it. Return a concise outcome with the candidate location, source changes, verification, remaining risks, and the next concrete action.
```

## Required worker result format

Every worker returns the following fields. If a field does not apply, explain briefly. Do not fill unrun checks with expected results.

```text
Task ID / agent:
Assignment status: complete | partial | blocked
Base SHA and resulting SHA or patch location:
Files changed and cross-owner edits:
Observed problem and reproduction:
What changed, or what the analysis established:
Behavior and upstream/compatibility constraints preserved:
Verification: exact command, working directory, result/count, revision
Runtime evidence: test case, CI job/run, capture or log location
Checks not run and why:
Remaining findings: severity, evidence, owner, next action
Mergeability evidence where applicable:
Ready-to-run prompt for any newly identified independent task:
Integration instructions for the coordinator:
```

## Completion checklist for the coordinator

- [x] Exact candidate/release scope established; unresolved 0.9.1/0.9.2 naming disclosed. Agent 00 pins reviewed-local-head B; later release attribution remains pending.
- [x] Plugin Command Center repair verified through the app. Agent04's corrected full named spec passed in 51 seconds, including wide/host/compact behavior, disable/re-enable and final removed-command absence. The first resumed run exposed an already-open-sidebar test-flow error; an explicit close after re-enable repaired that fixture. Its follow-up test is integrated through `63a920ba0`. Evidence: browser worktree `.tmp/agent-04/plugin-workspace-panels-run-2/`.
- [x] Skill-selection upgrade repair verified including startup maintenance ordering. Agent02: 31 focused tests and actual attached/cold Electron fixtures passed, with exact source manifests and temporal limits in its handoff.
- [x] Named server/setup failures dispositioned with proof; confirmed owned defects repaired. Agent03's independent Graph/setup investigations remain explicit tasks, not claimed passes.
- [x] Browser/Electron failures dispositioned; assigned compact, placement, Preview, plugin cleanup and Windows Electron paths passed. Additional independent causes have explicit tasks; Linux CI and native coverage remain unrun.
- [x] Entry-point, provider, and protocol audit complete with explicit coverage limits. Agent05 inventory and independent repair reviews accepted; real-provider and full compatibility matrix remain unrun.
- [x] Guard detects the original omissions and accepts valid repaired wiring. Agent06 historical negatives, committed repaired positive, and 26 focused tests passed; exact final combined SHA also passes all eight obligations under Agent08.
- [x] Fixed-target comparison refreshed on `4218b6a355c677333061bf483f641ba74a951011`: 191 normalized conflicted files / 828 hunks, 337 raw conflicted paths, unchanged from R. Exit 0, complete output and preserved index/worktree verified.
- [x] Architectural follow-ups are separately prescribed and remain unexecuted unless assigned. Three bounded investigation prompts are at `.tmp/agent-07/follow-up-prompts.md`; final measurements confirm unchanged seam costs; prompts retain separate investigation scope.
- [x] Combined local candidate validated at `4218b6a355c677333061bf483f641ba74a951011`; builds, format, seven changed CI tests, lint/typecheck/hooks and final deterministic guard passed. Full exact-SHA CI remains unrun pending explicit approval, and individual runtime fixtures retain their own source revisions.
- [x] Existing historical Knowledge finding reconciled through Otto with verified candidate/repair/check/rehearsal evidence; review status remains proposed.
- [x] Final local handoff records the clean candidate, individual evidence revisions, unresolved independent tasks and coverage limits. Next action requires Agent08 authorization: push `review/paseo-061-candidate` and dispatch `ci.yml` on that branch. No release approval is implied.

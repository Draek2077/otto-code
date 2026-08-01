# Paseo v0.2.5 merge: the decisions that matter

Point-in-time record for the merge landed as `f395655b5` on `merge/paseo-v0.2.5`. Written to be
handed to a reviewer, so it states not just what was decided but **what would prove each decision
wrong**. Durable facts fold into [docs/upstream-merges.md](../../docs/upstream-merges.md) when this
project is drained; the remaining tail lives in [projects/README.md](../README.md).

> **Corrections applied 2026-08-01.** Four claims below were wrong and have been
> fixed in place: the `buildWorkspaceTabPersistenceKey` re-export is a shim
> (now tagged `COMPAT(workspaceTabsStoreReexport)`); `hostingProvider` and
> `forge` cannot collapse; the `DEFERRED(paseoDiffTab)` marker did not exist and
> now does. Two more, recorded here because they have no row to fix:
>
> - `checkout-session.ts` claimed `listCheckoutCommits` "takes the base ref as a
>   parameter". It does not — it calls `resolveBaseRefForCwd` itself. The
>   behaviour the comment describes is real; the mechanism is not. Comment fixed.
> - The verification state below reads "targeted suites green". `models.test.ts`
>   was not among them and was failing 19 of 40: it was hand-merged with
>   upstream's version while the manifest kept ours, so it imported three symbols
>   that do not exist. `npm run typecheck` cannot see this — the server typecheck
>   project excludes test files — so a green typecheck says nothing about whether
>   the test suites even compile. Restored and green at 27.

## The governing rule

The fork has one merge rule, and every call below was made against it:

> Follow Paseo wherever they reorganised or added something **and you can point at what took over the
> job**. Keep ours only where they dropped a capability we still have. **Inconvenience is never a
> valid reason to decline Paseo architecture.**

The failure mode this rule guards against is not "we lost a feature" (loud, caught by tests). It is
"we kept our version of something Paseo rewrote, the build stayed green, and the next merge is
harder." Both halves need auditing, and the second half is the quiet one.

## Merge mechanics

| Thing                                  | Value                                                       |
| -------------------------------------- | ----------------------------------------------------------- |
| merge-base                             | `c05e337cde9c88d3c86dc82d9e8bc26b336603b3`                  |
| ours (pre-merge fork HEAD)             | `f4ea7c6f775a16b749cbdf36641a2b2da1fd5771`                  |
| theirs (`MERGE_HEAD`, upstream v0.2.5) | `8d143abc43e2b257c4fc2f77606bb11734ba3da4`                  |
| merge commit                           | `f395655b591b31d8a6417e2a0a7d8d0565265045`                  |
| worktree                               | `.claude/worktrees/merge-v025`, branch `merge/paseo-v0.2.5` |

**Rebrand normalization is mandatory before any three-way merge.** Upstream is `Paseo`/`@getpaseo`;
we are `Otto`/`@otto-code`. Run `perl -CSD scripts/rebrand-upstream.pl <file>` over the **base and
theirs** sides before `git merge-file`. Without it zero files merge cleanly; with it, 33 did. Any
reviewer re-deriving a diff must do the same or every hunk will look like a conflict.

Scale: 1,323 upstream-changed files present in the tree; 1,244 files touched by the merge commit;
121,661 insertions / 18,610 deletions.

## Adopted from upstream (ours retired)

Each of these replaced an Otto construct. The "took over the job" column is the load-bearing claim.

| Upstream construct                                            | What it replaced in Otto                           | What took over the job                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ForgeService`, `ForgeAuthState`                              | `githubFeaturesEnabled` boolean                    | The boolean could not distinguish `unauthenticated` from `cli_missing` / `no_remote` / `error`; the enum drives the onboarding callout                                                                                                     |
| `ForgeSpecificStatusFacts` (tagged open envelope)             | sibling `github` / `hosting` status blocks         | One `forge`-tagged envelope; per-adapter facts modules (`github-facts.ts`, `bitbucket-facts.ts`, …)                                                                                                                                        |
| `forge_change_request` / `forge_issue` attachments            | `hosting_pr` / `hosting_issue`                     | **Required, not cosmetic** — the merged daemon's `prompt-attachments.ts` handles `forge_*` and legacy `github_*` but **no longer `hosting_*`**. Keeping ours would have dropped PR attachments silently on submit                          |
| `MergeCapability` + `deriveMergeCapability`                   | `pullRequestGithub` / `pullRequestHosting` pair    | Provider-neutral merge affordances; synthesizes the github arm from legacy facts for old daemons                                                                                                                                           |
| `ForgeSearchItem` (`kind: "issue" \| "change_request"`)       | `GitHubSearchItem` (`"issue" \| "pr"`)             | `change_request` is the provider-neutral noun (GitLab calls them merge requests)                                                                                                                                                           |
| `useForgeSearchQuery`                                         | `useGithubSearchQuery` + `useHostingSearchFeature` | Their `supportsForgeSearch` gate is the capability check, and their hook falls back to the legacy GitHub RPC itself                                                                                                                        |
| host-window-scoped browser registry                           | eager registration by `browserId` alone            | Browsers now bind to `(hostWebContentsId, browserId)` and register at **attach time**, when the guest's `webContentsId` first exists                                                                                                       |
| single `projects` map                                         | `emptyProjects` bucket + `EmptyProjectDescriptor`  | One bucket; `hasActiveWorkspaces` no longer decides membership                                                                                                                                                                             |
| `clientMessageId` optimistic handoff                          | `backfillUserMessageAttachments`                   | `buildUserMessageItem(…, optimistic)` and `handoffCreatedAgentUserMessageToStream` carry images/attachments across the optimistic→canonical swap                                                                                           |
| `navigateToWorkspace(input)`                                  | `navigateToWorkspace(serverId, workspaceId)`       | Object form gained optional `target` / `pin`                                                                                                                                                                                               |
| `buildWorkspaceTabPersistenceKey` in `@/workspace-tabs/model` | same, re-exported from the layout store            | **Correction: this IS a shim.** `stores/workspace-tabs-store/state.ts` re-exports it so the call sites that still import from the store keep working. Tagged `COMPAT(workspaceTabsStoreReexport)`; repointing those imports is the cleanup |
| `${row.kind}_subagent_${id}` presentation key                 | `subagent_${id}`                                   | Otto rows and provider rows can share an id; the prefix stops them colliding                                                                                                                                                               |
| unseen workspaces sort **before** the saved order             | appended after                                     | Deliberate upstream UX change; Otto's test asserting the old order was updated, not the source                                                                                                                                             |

**Three bugs surfaced by adopting rather than keeping.** Worth calling out because a green build did
not catch them:

1. `lucide-react-native` and `@replit/codemirror-vim` were dropped from the manifests while the ~20
   files importing them landed. Runtime break, not a type error.
2. The `hosting_*` attachment void above.
3. `main.ts` handled `otto:browser:register-workspace-browser` while `preload.ts` already invoked
   `otto:browser:register-attached`. Browser registration was broken at runtime, not just in types.

## Kept ours (upstream has no successor)

| Otto capability                                                                                                                                          | Why it stayed                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------- |
| base-ref resolution (`resolveBaseRef*`)                                                                                                                  | Their `listCheckoutCommits` takes `baseRef` as a **parameter**, so their commit list runs against our resolved base. We get their feature with our semantics                                                                                                                                                                                                                                                                                 |
| two-carrier project rename (`applyProjectDescriptor`)                                                                                                    | Rewritten onto their single `projects` map. `upsertProject` alone moves only the project record; the name also rides denormalized on every workspace descriptor                                                                                                                                                                                                                                                                              |
| active-workspace refresh policy (`workspace-git-service.ts`)                                                                                             | Only the focused workspace polls. Ported onto their restructured timer model, not pasted back. `WorkspaceGitSnapshotMeta.prStatusOnly` came with it: without the tag a post-commit status rebuild ships a stale `aheadOfOrigin` and mutes Push                                                                                                                                                                                               |
| `confirmClose` on `PanelRegistration`                                                                                                                    | Job tabs (rename, refine, artifact) hold work closing would discard; upstream's registry has no close hook                                                                                                                                                                                                                                                                                                                                   |
| nine Otto tab kinds                                                                                                                                      | `artifact`, `gitLog`, `visualizer`, `fileHistory`, `codeReferences`, `codeRename`, `refine`, `contextManagement`, `orchestrationGraph` — added to **their** new `workspace-tabs/model.ts` union                                                                                                                                                                                                                                              |
| focus mode                                                                                                                                               | Rewired onto their scoped `workspace.focus.toggle` action. They routed `view.toggle.focus` there but registered no handler, so the shortcut would have been silently dead                                                                                                                                                                                                                                                                    |
| Chatter personality ladder                                                                                                                               | They rebuilt `input-draft.ts` on the draft store and dropped the personality block entirely; grafted back onto their structure                                                                                                                                                                                                                                                                                                               |
| Bitbucket `/pull-requests/N` URL grammar                                                                                                                 | Their `pr-hint` regex covers `pull                                                                                                                                                                                                                                                                                                                                                                                                           | pulls | merge_requests` but not Bitbucket's spelling |
| `setTrayAttention`, `signalReady`, `description` on `GitAction`, `PANE_TOOLBAR_HEIGHT`, `navigateToPreparedWorkspaceTab`, `findCheckoutHintPrAttachment` | Otto-only, no upstream equivalent; each restored onto upstream's module layout                                                                                                                                                                                                                                                                                                                                                               |
| `hostingProvider` / `hostingCapabilities` **alongside** their `forge`                                                                                    | 28 call sites consume the narrowed provider id for icons and capabilities. Deliberate keep-both. **Correction: they cannot collapse.** `bootstrap.ts:1201-1204` registers Bitbucket into the forge registry under the forge id `github`, which "keeps its historical name — it is the provider-routing facade". So `forge` reads `"github"` for a Bitbucket workspace and only `hosting.provider` carries the truth. They disagree by design |

## Deleted as superseded — audit these first

These are the highest-risk calls, because deleting Otto code is irreversible in review terms and the
"took over the job" claim is the only thing standing behind each one.

- **`FileContextAttachment`** was deleted, then **restored**: the usage check excluded the declaring
  file, and `WorkspaceComposerAttachment` still referenced it. It is back. Mentioned because it shows
  the failure mode.
- **`buildWorkspaceCheckout`, `resolveWorkspaceForImportedAgent`** — Paseo's `runInImportWorkspace`
  demonstrably took over. Verify no import path lost behaviour.
- **`skipIfUserMessageExists`** — upstream removed it and replaced the mechanism with
  `handoffCreatedAgentUserMessageToStream`. Only a test referenced it.
- **`backfillUserMessageAttachments`** — see the table above.
- **Otto's eager browser registration + `clearPartition` on tab close** — browsers now share one
  profile partition and clearing it is a deliberate settings action (`clearProfile`).
- **`foregroundExtraMuted`** — Otto's themes stop at `foregroundMuted` and each tint would need its
  own value, so two call sites in `file-pane/bar.tsx` were mapped down to `foregroundMuted` with a
  comment. This is a **visual regression against upstream's intent**, consciously taken.
- **`visibilityCatchUpStatus`** is hard-coded `"ready"` in `agent-panel.tsx`. Upstream gates the
  ready state on per-agent catch-up; the app does not surface that signal yet. Behaviour matches
  today's, but it is a stub and should be named as one.

## Parked, with reasons

1. **Paseo's diff tab** (`working_diff` / `commit_diff`). Their `diff-panel.tsx` needs a restructured
   `@/git/diff-pane` exporting `SharedDiffView` / `DiffFilesToolbar` / `resolveDiffLayout`. Otto's
   `diff-pane` carries ~1,900 substantive lines theirs lacks (file history, rollback, comments, tree
   guides), so adopting the tab means merging that file properly. The tab kinds stay in the union;
   nothing registers them. Marker: `DEFERRED(paseoDiffTab)` in `register-panels.ts` — **the marker was missing until remediation; the insertion script's anchor failed silently.** It is there now, and records that `working_diff`/`commit_diff` are live tab kinds with identity builders and menu entries, so opening one yields a dead tab.
2. **~180 files still holding our side of an upstream change.** Resolved wholesale to ours during the
   conflict pass: upstream's edit is gone with **no marker and no error**. This is the single largest
   correctness risk in the merge and the build cannot see it.
3. **Bitbucket Cloud end-to-end.** Types line up after the `forgeSpecific` move; no live run.

### How to detect item 2

```bash
BASE=c05e337cde9c88d3c86dc82d9e8bc26b336603b3
THEIRS=8d143abc43e2b257c4fc2f77606bb11734ba3da4
OURS=f4ea7c6f775a16b749cbdf36641a2b2da1fd5771
for f in $(git diff --name-only $BASE $THEIRS); do
  [ -f "$f" ] || continue
  git show "$OURS:$f" > /tmp/ours 2>/dev/null || continue
  cmp -s /tmp/ours "$f" && echo "UNTOUCHED: $f"
done
```

A file listed here had upstream changes and ended byte-identical to pre-merge ours. Some are
legitimate (we deliberately kept ours); the rest are silent losses.

## Traps that shaped the method

A reviewer re-running any of this will hit the same ones.

- **Parse errors mask every other error.** A broken merge drops the reported count to ~1–2 and looks
  like success. Twice. Always check `TS1005|TS1003|TS1128|TS1117` before trusting a low count.
- **`git checkout -- <dir>` mid-merge restores from the INDEX** and wipes unstaged work. It cost ~90
  minutes. Single file paths only, and check `git diff --stat <path>` first.
- **Keep-both and dedupe both eat closing braces.** Never filter or dedupe punctuation-only lines.
- **The shell mangles backslashes, backticks and `${...}`.** Bash heredocs and `node -e "…"` both
  collapsed `\\b` to a backspace and ate template literals. Write scripts with a file, not inline.
- **Brace-counting extractors trip on type annotations** (`Map<string, { additions: number }>`).
  Match the two-space `  }` for class methods.
- **NUL bytes make a file binary and unmergeable.** Hit twice in `daemon-client.ts`.
- **Blanket renames collapse distinct branches** — `status.github` and `status.bitbucket` both became
  `status.forgeSpecific` once, which is why `isBitbucketPullRequestStatusFacts` gates the legacy block.
- **Taking upstream's test file is not always right.** It helped for `composer/actions`,
  `strategy-web`, `policy`; it made `checkout-session` worse (14 failures vs 7) because Otto's
  checkout session carries its own snapshot metadata, and `bottom-anchor-controller` worse because
  Otto's scroll anchor is heavily customized (see [docs/chat-scrolling.md](../../docs/chat-scrolling.md)).

## Verification state at the commit

Typecheck 0 across every workspace, lint 0, zero conflict markers, pre-commit hook passed on its own
(no `--no-verify`). Targeted suites green: `checkout-session` (31), `checkout-git` (132), `policy`
(46), `track-presentation` (50), `composer/actions`, `workspace-tab-menu`,
`sidebar-workspaces-view-model`.

**Unverified:** `checkout-status-cache`, `app-visibility` and `bottom-anchor-controller` cannot
resolve `react` / `react-native` in this worktree. Confirmed to reproduce on the **unmodified HEAD**
versions, so it is the worktree's module layout rather than merge fallout — but those three want a
CI run. The full suite has not run locally by policy.

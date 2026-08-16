---
id: "paseo-v025-merge"
kind: "project"
title: "Paseo V025 Merge"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration", "missing-legacy-ledger-row"]
delivery_status: "charter"
created_at: "2026-08-08T06:18:03.718Z"
updated_at: "2026-08-08T06:19:53.939Z"
---

# Paseo V025 Merge

<!-- compiled_truth -->

# Paseo v0.2.5 merge: audit findings and remediation

Two independent audits ran against `f395655b5` after it landed. This is the merged result, with the
findings I re-verified myself marked as such. It **supersedes the optimistic parts of**
[merge-decisions.md](merge-decisions.md), which contains three claims now known false (listed under
"Corrections owed" below).

**The merge should not ship in this state.** Typecheck 0, lint 0 and green targeted suites were
necessary and told us almost nothing. Six regressions, one of them a hard crash on a primary surface,
all pass those gates.

## Status as of 2026-08-02

All eight P0 items are closed. Verified against the tree, not taken from the commit log.

| #   | Item                                                | State            | Evidence                                                                                         |
| --- | --------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `status-projection.ts` COMPAT(forgeSpecific) mirror | Fixed            | `COMPAT(forgeSpecific)` present in `checkout/status-projection.ts`                               |
| 2   | Stop does not hold the steer queue                  | Fixed            | `holdSteerQueue` called at `agent-manager.ts:4144`                                               |
| 3   | Tool-output bounding unwired                        | Fixed            | `limitAgentTimelineItemContent` imported by `agent-manager.ts` and `provider-subagents/store.ts` |
| 4   | Provider-subagent rows misroute                     | Fixed 2026-08-02 | see below                                                                                        |
| 5   | Server stale tests                                  | Fixed            | `server-tests (ubuntu-latest)` green                                                             |
| 6   | CI hang from leaked intervals                       | Fixed            | suites no longer hang                                                                            |
| 7   | App residue                                         | Fixed            | `app-tests` green; note some UI assertions were **parked**, not repaired                         |
| 8   | Highlight shell + SQL registrations                 | Fixed 2026-08-02 | see below                                                                                        |

**Item 4 was mis-scoped in the original writeup.** It was recorded as a missing
`onOpenProviderSubagent` handler. The handler was indeed missing, but the deeper cause was that
`normalizeWorkspaceTabTarget` had no branch for `provider_subagent` at all, so every such target
normalized to `null` and the tab could not be opened or restored even with a handler in place. The
panel, the tab menu entry and the persistence key builder had all shipped; only the normalizer and
the click path were absent. Both are now fixed, with `openProviderSubagentTab` following the house
`open<Thing>Tab` pattern. The audit's suggested source commit (`6fc491e62`) is **not** a fix commit;
it is upstream's "cut 0.2.5" release commit, so the fix was derived rather than copied.

Two neighbouring kinds, `working_diff` and `commit_diff`, are also unnormalizable, and that is
**deliberate**: neither has a registered panel here, because we kept our own Changes view. They are
tagged `DEFERRED(paseoDiffTab)` in `workspace-tabs/identity.ts` with a test pinning the behaviour, so
they are not mistaken for the same bug later.

**Item 8 had a testable invariant hiding in it.** `detect.ts` says in its own header that every
extension it can return is a key in `parsers.ts`. The merge broke exactly that: detection still
scored shell and SQL while the parser table had lost both rows, so Otto confidently classified a
snippet and then had nothing to colour it with. Beyond restoring `sh`/`bash`/`zsh`/`sql`, `detect.ts`
now exports `DETECTABLE_EXTENSIONS` and `parsers.test.ts` asserts the whole invariant, so the next
dropped row fails a test instead of silently degrading.

## P1 status as of 2026-08-02

Each one re-checked against the tree. **Four of the nine were already fixed and the audit had gone
stale; one does not reproduce at all.** Verifying before implementing was worth more here than the
fixes were.

| Item                                            | State              | Note                                                    |
| ----------------------------------------------- | ------------------ | ------------------------------------------------------- |
| Mojibake in tracked source                      | Fixed              | 754 runs across 9 files; see below                      |
| `judge-verdict.ts` rebrand corruption           | Fixed              | "upstream Otto's" is upstream **Paseo's**               |
| Mixed-case `projectId` on upgrade               | **Does not repro** | pinned by comment + test; no migration needed           |
| `html-ish.ts` renders raw HTML                  | Already fixed      | `b/strong/em/i/code/table` all translate; 51 tests pass |
| `desktop-settings` migration dropped            | Already fixed      | present at `desktop-settings.ts:285`                    |
| `otto://` scheme unregistered                   | Already fixed      | `electron-builder.yml` registers it                     |
| `DEFERRED(paseoDiffTab)` marker missing         | Fixed              | now real in `workspace-tabs/identity.ts`, with a test   |
| `toolCallDetailLevel` half-landed               | **Fixed**          | adopted and wired 2026-08-02, see below                 |
| Nix trace misses the speech worker              | **Fixed**          | 8 modules were absent from the closure; see below       |
| `workspace-auto-name` uses cwd not worktreeRoot | **Fixed**          | real bug, regression test added; see below              |
| Agent-state leak in `agent-response-loop`       | Does not apply     | Otto never creates the agent that would leak            |
| Large-file streaming backpressure               | Non-issue          | `pipeline()` handles it; ours is richer than upstream's |

**The projectId scare was the valuable one, because the answer was "do nothing".** The merge made
`deriveProjectKey` lowercase GitHub owner/repo, so an upgrading install re-derives a different key
than it persisted. That does not duplicate the project: lookup goes through `rootPath`, and a
project found that way has its stale key rewritten in place. The one thing that turns a key into a
`projectId`, the legacy registry bootstrap, returns early once registry files exist. Writing the
migration the audit implied would have churned user data to fix nothing. The real hazard is the
comparison nobody has written yet, so `project-key.ts` now says so and a test pins the upgrade path.

**Mojibake was mechanical but not blind.** Each run was re-encoded to the bytes cp1252 would have
produced and decoded as UTF-8, rewritten only when that decode was strictly valid and yielded no
control characters. `messages.ts` held 539 of the 754, mostly section-divider comments where every
dash of a rule had become three characters. Three sites reached a person: an OMP mode description in
the UI and two agent-facing truncation suffixes in `session.ts`. This file is deliberately **not**
repaired, because it quotes the corrupt sequences as evidence.

**The Nix speech worker was the one with teeth.** `scripts/trace-daemon.mjs` computes the daemon's
runtime closure with `@vercel/nft`, which does not follow `fork()` boundaries, so every forked
process needs its own trace entry. The terminal worker had one; the speech worker did not, even
though `nix/package.nix` claims in a comment that both are traced. Measured by diffing the trace
output before and after: **8 modules were missing**, the worker itself plus the entire sherpa engine
(offline recognizer, node loader, Parakeet STT, Parakeet realtime session, TTS, Silero VAD provider
and session). The Nix package would build clean and then fail the first time anyone used speech.

**`workspace-auto-name` was a real bug, and narrower than it sounds.** `readOttoWorktreeMetadata`
builds its path from whatever it is handed rather than walking up, so a workspace opened on a
_subdirectory_ of an Otto worktree read the metadata from the wrong place, got null, and silently
skipped auto-naming: a miss is indistinguishable from "nothing to do". Git resolves a worktree from
any depth, so only the metadata reads and writes moved to the root, via the same
`isOttoOwnedWorktreeCwd` helper the change-request fix used. The regression test was verified to fail
without the fix, not merely to pass with it.

**Two of the four were not bugs at all.** The agent-state leak does not apply: upstream's
`closeAgent`/`deleteAgentState` teardown exists because _their_ `generateStructuredAgentResponse`
creates an agent, and Otto's rewrote that path as a bare tool-less completion that never creates one.
Backpressure is already correct: the sherpa model download streams through `pipeline()` from
`node:stream/promises`, which propagates backpressure natively, and Otto's downloader is strictly
richer than upstream's (sha256 integrity verification, corrupt-archive cleanup, a Windows `tar`
resolution fix).

**`toolCallDetailLevel`: Philippe's call was adopt, and it is wired (2026-08-02).** The field was a
valid `AppSettings` key with a default and a validator, absent from `APP_SETTINGS_UPDATE_KEYS` (so
writes were silently dropped) and with zero readers.

Every computational module had in fact survived the merge intact and rebranded (`detail-level/`
grouping, overview model and view, projection, 20 green tests). Only the wiring was missing, so
adoption was five seams, not a port:

1. `toolCallDetailLevel` added to `APP_SETTINGS_UPDATE_KEYS`, which is what made the setting
   writable at all. `collectAppSettingsUpdates` is now exported and tested, because a dropped write
   is invisible: it neither fails to compile nor throws.
2. A dropdown row in `appearance-section.tsx`, under Chats next to action grouping.
3. `agent-stream/view.tsx` runs the projection and renders `OverviewToolCallGroupView` for grouped
   runs. Both memos read the **deferred** stream pair, not the effective one: deferral has to stay
   intact, and the reveal spans are computed from the same pair. The prepare memo depends on the
   tail alone so retained history is never regrouped on the ~48ms live-head flush.
4. `strategy-native.tsx` consumes `historyRowRevision`, whose type had already landed in
   `strategy.ts` with no producer and no consumer. FlatList re-renders from item identity, so
   without it a collapsed run in retained history keeps stale counts and a stuck spinner. Web needs
   nothing: it re-renders through the renderer closure.
5. The `toolCallGroup.*` i18n keys, which the audit missed. They had landed in **no** locale file,
   English included, so the collapsed row would have rendered raw i18n keys. Added as literal
   English across all eight locales pending the i18n sweep.

Two things the audit's inventory got wrong, worth recording because both were only visible from the
wiring side: those missing `toolCallGroup.*` keys, and a **duplicate** `settings.general.toolCallDetail`
block in `en.ts`. The duplicate is why this looked more finished than it was: later keys win in an
object literal, so the merge's translated copy was live and the second copy dead. The duplicate is
removed and the merge's wording kept, since all seven non-English locales already translate it.

`e2e/tool-call-shimmer.spec.ts` already seeded `toolCallDetailLevel: "overview"` and asserted on the
`tool-call-group` testID, so it was exercising a feature that could not render. It is live now with
no change, and was already claimed by the coverage matrix.

## The pattern connecting almost everything

**The implementation survived; the wiring did not.** A reducer with no caller. A schema branch with
no handler. A module with no importer. A provider hook with no provider mounted. Every instance
typechecks, lints and builds clean, which is precisely why the green build proved nothing.

When triaging anything below, the question is never "does the code exist" but "is it reachable from a
real user action."

## RESOLVED 2026-08-02: Hub is gated off, not stripped

Philippe's call: **do not risk more merge damage by tearing the wiring out; stop it loading.**

Hub is now switched off at the **import specifier**. `packages/server/src/server/hub-disabled.ts`
and `packages/cli/src/commands/hub-disabled.ts` export inert stand-ins under the same names, and the
three value imports in `bootstrap.ts`, `session.ts` and `cli.ts` resolve there instead. Every other
line at those call sites is byte-identical to upstream, so upstream's future edits to the hub wiring
auto-merge rather than conflicting with our deletions. That was the whole point: deleting the wiring
would have put a permanent conflict in the three files upstream edits most.

Verified, not assumed: after `npm run build:server`, no emitted `.js` in `packages/server/dist`
imports anything under `hub/`. The subsystem is unreachable from the daemon's module graph, so it is
never parsed or evaluated. Only `.d.ts` files reference it, and those are compile-time only.

The stubs re-export the real modules' types and derive their constructor signatures via
`ConstructorParameters<typeof Real...>`. Both are erased at runtime, so fidelity is free and any
upstream reshape of a Hub interface breaks the stubs loudly instead of drifting.

Three of the six hub suites boot a real daemon through `createOttoDaemon` and cannot pass with the
wiring inert; they are excluded in `packages/server/vitest.config.ts` rather than edited, so all six
files stay byte-identical to upstream. The other three construct the controllers directly and still
pass (23 tests), which is what keeps the stubs honest.

The standing decision is unchanged: Hub stays excluded and unsupported. `rg "DISABLED\(hub\)"` finds
every part of the switch, and re-enabling is three specifiers plus the test exclusion.

The original finding follows, kept for the record.

**Hub landed, against a documented permanent exclusion. Do not touch it.**

`docs/upstream-merges.md:226` reads: _"Hub (`a414f8ea8`) - permanent exclusion. Never incorporate."_
The doc prescribes an audit grep whose expected output is "nothing"; it now returns 23 files.

Verified: `packages/server/src/server/hub/` has **12 files** now and **0** at pre-merge
`f4ea7c6f775a16b749cbdf36641a2b2da1fd5771`. Also landed: `packages/cli/src/commands/hub/`
(2 files), `docs/hub.md`, `packages/server/src/server/agent/agent-owner.ts`, and `owner` threading
through `agent-storage.ts`, `bootstrap.ts`, `session.ts`, `session/daemon/daemon-session.ts`,
`websocket-server.ts`, `protocol/src/messages.ts`, `client/src/daemon-client.ts`
(`requireHubRelationshipSupport`).

Stripping it touches seven shared files, so it must be settled before other work reshapes them.
~~**Awaiting Philippe's call: strip, or amend the standing decision.**~~ **Settled 2026-08-02: a
third option was taken.** Neither strip nor amend. The wiring stays exactly where upstream put it and
is made inert at the import specifier, so the seven shared files keep auto-merging. See the
resolution above. Every Hub file is still byte-identical to upstream.

## Verified regressions

Ordered by user impact. Items 1–4 were re-verified directly against the tree, not taken on trust.

### 1. The draft workspace tab crashes on render - VERIFIED

`packages/app/src/composer/draft/workspace-tab.tsx:553` calls `useCommandCenterActions`
unconditionally. That calls `useCommandCenterRegistry`
(`packages/app/src/command-center/provider.tsx:25-29`), which does
`if (!registry) throw new Error("CommandCenterProvider is required")`.

`CommandCenterProvider` is **mounted nowhere**. Meanwhile `packages/app/src/app/_layout.tsx:31` still
mounts Otto's separate `@/components/command-center` (677 lines).

Upstream's `packages/app/src/command-center/` (10 files, 1,590 lines) landed with exactly **three**
importers, all in `workspace-tab.tsx` - which is what turns dead code into a crash. (One audit
reported zero importers; that was wrong, and the correction makes it worse, not better.)

**Decide:** mount `CommandCenterProvider` and migrate `_layout.tsx` onto upstream's command center, or
revert `workspace-tab.tsx`'s three imports to Otto's. Do not ship both stacks.

### 2. Project rename reaches the UI through neither carrier - VERIFIED

`applyProjectDescriptor` has exactly two references tree-wide: its type declaration
(`session-store.ts:657`) and its implementation (`:1791`). **Zero callers.**

The merge deleted the `project.updated.notification` subscription from
`packages/app/src/contexts/session-context.tsx`. The daemon still emits it
(`packages/server/src/server/session.ts:5540`). This was Otto-only code with no upstream counterpart,
so nothing took over. Renaming a project updates neither the project record nor the
`projectDisplayName` denormalized onto each workspace descriptor until a reconnect.

Fix: restore the subscription. The reducer itself is correct and was already ported onto upstream's
single `projects` map.

### 3. `hosting_*` prompt attachments throw in the daemon - VERIFIED

`packages/server/src/server/agent/prompt-attachments.ts:123` ends its switch with
`throw new Error("unreachable")`. Pre-merge the same file had `case "hosting_pr"` and
`case "hosting_issue"` (confirmed: 2 hits at `f4ea7c6f7`, 0 now).

The protocol **still accepts** them - `HostingPrAttachmentSchema` / `HostingIssueAttachmentSchema`
remain in `AgentAttachmentSchema` (`messages.ts:2496-2497`). So an older client's PR attachment
validates and then hits an uncaught throw on the prompt-build path for **every provider**.

Fix: either handle both kinds (mapping to the `forge_*` rendering) or make the default arm degrade
instead of throwing. Prefer handling them; a silently dropped attachment is its own bug.

### 4. Bitbucket Cloud PR merge is dead client-side

`packages/app/src/git/forges/` contains github, gitlab, gitea, forgejo, codeberg and **no bitbucket**.
Only gitea/github/gitlab register a `deriveMergeCapability`, so it returns `null` for Bitbucket facts.
`canMergePr` (`packages/app/src/git/policy.ts:562-572`) then falls into the `capability === null`
branch, which requires `pullRequestMergeable === "MERGEABLE"` - a GitHub-only value Bitbucket never
produces.

Pre-merge `policy.ts` had explicit Bitbucket branches (gating on branch-in-sync, and
`bitbucket.mergeStrategiesAllowed.includes(method)` per method). `bitbucket` now appears **zero**
times in `policy.ts`. The daemon adapter (`packages/server/src/services/git-hosting/bitbucket-*.ts`)
is intact - this is purely the client half.

Fix: add a bitbucket forge module exporting `deriveMergeCapability` from
`isBitbucketPullRequestStatusFacts`. Extending upstream's registry is the right shape; do not
reintroduce provider `if`-branches into `policy.ts`.

### 5. Two forge RPCs are advertised and never answered

`websocket-server.ts:1789-1791` advertises `forgeSearch: true` and `forgeCheckDetails: true`.
`daemon-client.ts:5267` / `:3518` await `forge.search.response` and
`checkout.forge.get_check_details.response`. But `checkout-session.ts:1510-1584` emits only
`github_search_response` and `checkout.github.get_check_details.response` for both request types.

The app takes the forge path because the flags are on, and hangs to timeout. `checkout-session.ts`
appears to be a wholesale-ours resolution.

Fix: select the response type from the request type, as upstream does.

### 6. Two silent no-ops from wholesale-ours resolutions

- **"Remove provider" in Settings.** Upstream added `removeProviders: string[]` to
  `daemon-config-store.ts`; we kept the `{id: null}` sentinel. The merge **took upstream's client**
  (`providers-section.tsx:378` sends `{removeProviders:[id]}`). Both keys are in the schema, so it
  typechecks and does nothing.
- **Desktop auto-updates never install.** Upstream's `createQuitLifecycle` installs a pending update
  on quit and honours `before-quit-for-update`; we kept the handler that calls `app.exit(0)`
  unconditionally. `installAppUpdateOnQuit` landed with zero callers.

### 7. Claude context windows over-report

`.../claude/model-manifest.ts` kept ours against upstream's correction of `claude-fable-5` /
`claude-sonnet-5` to **200k**. We still report **1M**, so the context meter under-reports usage on
the fork's most-used models. Also dropped: `supportsThinkingDisabled`,
`minimumClaudeCodeVersion` gating, the `[1m]` variants.

## Corrections owed in the repo

These are false statements currently sitting where the next merger will read them.

1. **`DEFERRED(paseoDiffTab)` does not exist.** Claimed in both the commit message and
   `merge-decisions.md`; the insertion script's anchor failed silently. `rg "DEFERRED\("` over
   `packages/` returns only the English word in `voice/auto-speech-queue.ts:211`. Add the marker for
   real in `register-panels.ts`, and note that `working_diff`/`commit_diff` are **live tab kinds**
   (`workspace-tabs/model.ts:22,36`, identity builders at `identity.ts:369-370`, menu handling at
   `workspace-tab-menu.ts:180,183`) with no registered panel, so opening one yields a dead tab.
2. **"Consumers repointed at the new home rather than shimmed" is false.**
   `packages/app/src/stores/workspace-tabs-store/state.ts:11-14` is literally a re-export shim, with
   a comment saying it serves 38 call sites. Current split: 39 files import `@/workspace-tabs/`,
   38 import `@/stores/workspace-tabs-store`. Correct the claim in `merge-decisions.md`.
3. **"`hostingProvider` is a narrowing of `forge` and should collapse later" is wrong.**
   `bootstrap.ts:1201-1204` registers Bitbucket into the forge registry **under the forge id
   `github`**, stating outright that "`github` keeps its historical name - it is the provider-routing
   facade." So `forge` reads `"github"` for a Bitbucket workspace and the client must read
   `hosting.provider` for the truth. **They disagree by design and cannot collapse.** Retract the
   claim and record why.
4. **`docs/upstream-merges.md:280-281` now contradicts the code.** It says _"don't register their
   `provider-subagent-panel`, don't take their `select.ts` discriminated union."_ The merge did both
   (`register-panels.ts:27`, `select.ts:39`). Either amend the standing decision or revert the two
   lines. Do not leave the ledger and the code disagreeing.

## Measured scale of the untouched-upstream problem

**168 upstream-changed files received zero merge treatment; ~19,700 upstream lines dropped.** Of
files with ≥100 lines of upstream churn, **34 ended byte-identical to ours**, carrying 12,123 dropped
lines. Worst by churn, with `Δtheirs` = permanent divergence now carried:

| File                                             | upstream churn | Δtheirs          |
| ------------------------------------------------ | -------------- | ---------------- |
| `app/src/git/diff-pane.tsx`                      | 1831           | 3802             |
| `app/src/composer/agent-controls/index.tsx`      | 1055           | 1913             |
| `app/src/components/combined-model-selector.tsx` | 926            | 1794             |
| `app/src/components/file-explorer-pane.tsx`      | 567            | 2141             |
| `app/src/components/web-desktop-scrollbar.tsx`   | 464            | 533 (whole file) |
| `app/src/components/left-sidebar.tsx`            | 421            | 657              |
| `app/src/hooks/use-command-center.ts`            | 388            | 390 (whole file) |
| `cli/src/commands/agent/run.ts`                  | 305            | 409              |
| `server/daemon-config-store.ts`                  | 115            | 952              |

~~**Not yet measured:** the ~180 _conflict-resolved_ wholesale-ours files are a different set from
these 168 byte-identical ones.~~ **MEASURED 2026-08-02:**
[[finding-2026-08-02-wholesale-ours-sizing]].

Headline: **the tree carries 88.6% of upstream's additions**, and that is a floor, because a file
Otto re-implemented in its own idiom scores low even when the capability was taken. The
"~19,700 lines dropped" framing does not survive measurement against the merge that actually
shipped.

Note the audit measured the wrong commit throughout this section: `f395655b5` is **not an ancestor
of main**. The merge on main is `5e3cc1def`.

The risk is concentrated rather than spread: 73 files below 50% adoption carry 6,830 of the 9,729
dropped lines, and in production that is 48 files. **25 of those 48 are documented decisions and 23
are not.** A symbol-level pass over the 23 leaves 12 worth reading and 2 worth fixing:

- **`workspace-scripts-button.tsx`** (7 of 7 new symbols absent): upstream's service-route
  affordance, open / copy / preview a running script's URL. This one already produced a symptom
  nobody traced: commit `32f4a2cd9` "parked the never-merged UI assertions" here, because upstream's
  tests came across and the component did not. **Parked tests are the fingerprint of a dropped
  component**, and that is the cheapest detector we have for the rest.
- **`workspace-archive-service.ts`** (3 of 7 absent): upstream added backing-directory resolution to
  archiving and we took four of the seven symbols. A partial take of one change is the shape that
  produced regression 5 in `checkout-session.ts`.

## P2 status as of 2026-08-02

**Corrections owed: all four closed.** `DEFERRED(paseoDiffTab)` is real in
`workspace-tabs/identity.ts` with a test. The "consumers repointed rather than shimmed" claim is
gone, and the shim now says outright that it is one. The `hostingProvider`/`forge` collapse claim is
retracted at both schema sites, with the reason recorded inline: Otto registers every provider into
the forge registry under the forge id `github`, which is a routing facade, so `forge` reads "github"
for a Bitbucket workspace and only `hosting.provider` is true. The provider-subagent standing
decision was amended on 2026-08-01.

**COMPAT tags: audited properly, and the audit's count was low.** Grouping by tag name rather than
by occurrence, 203 distinct names exist and 12 had no cleanup condition anywhere (the audit said
14 undated occurrences, which conflated cross-references with canonical sites). Four had no
condition at all and now do: `fsFileWatch`, `subagentLiveness`, `workspaces`, `claudeVersionGating`.
Two prose dates were normalised to ISO so they are greppable. `compactionFailedStatus` now says
explicitly that it has nothing to remove, which is why it never had a date. The rest carry
event-based triggers, which the repo convention allows: `macOS-signing` clears when Apple signing is
configured, `xterm-ipad-ctrl-c` when the xterm.js bump lands, `opencodeSlowAbort` when upstream
acknowledges aborts. The two remaining hits are `COMPAT(...)` and `COMPAT(name)` placeholders in docs
illustrating the convention.

**Untagged shims: tagged, and two were not shims.** `hostingAttachments` gained its render half,
`forgeBrandIcon` and `foregroundExtraMuted` and `visibilityCatchUpStub` are now tagged with the
deletion that clears each. The two `hosting` blocks in `messages.ts` are documented as **permanent**
rather than tagged, because they cannot collapse into `forge` (see above).

**Dead modules: decided, not deferred.** Verified by import specifier, not stem grep, after the
earlier orphan scan was shown to produce garbage. Six modules had zero import statements.

- **Deleted** (Otto has its own equivalent, or the helper had no caller at all):
  `sidebar-help-menu.tsx`, `sidebar-resize-handle.tsx`, `desktop-sidebar-layout.ts`,
  `daemon-reconnect.ts`, `history-start-pagination.ts`, plus three companion unit tests.
- **Kept, and tagged `UNWIRED(fileDownload)`:** `use-file-download.ts`. Deleting it would strand a
  working server subsystem: the daemon mints download tokens (`file-download/token-store.ts`,
  constructed in `bootstrap.ts`) and `stores/download-store.ts` exists. Only the hook joining them
  to the file explorer is unreached, so downloading from the explorer does nothing today.
- **Renamed, not deleted:** `utils/desktop-window.tsx` -> `utils/window-chrome.tsx`, tagged
  `UNWIRED(windowChrome)`. It sat beside the live `utils/desktop-window.ts`; both resolve from the
  same specifier and `.ts` wins, so all seven importers got the other file and none of its fifteen
  exports were reachable. Worse than dead: an editor jumping to the specifier could land there, and
  a future `WindowChromeProvider` import would have silently resolved to the wrong module.

**Two E2E specs were exercising the deleted components.** `sidebar-help.spec.ts` and
`sidebar-resize-handle.spec.ts` drove testIDs that exist nowhere in Otto's source, so both were
guaranteed-red for the same reason `commit-diff-panel.spec.ts` was. Deleted, with their matrix rows
moved from 🟡 to ❌ so the gap is recorded rather than hidden. Note the resize row is **P1**: Otto
does have sidebar resize (`resizeGesture` in `left-sidebar.tsx` and `explorer-sidebar.tsx`), it
simply carries no testIDs, so a shipped feature is uncovered. `npm run e2e:coverage` passes with all
140 specs claimed.

**Feature ports: all seven resolved, and five were already shipped.** The list read as seven builds
and was almost entirely stale.

| Port                   | Outcome                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| add-to-chat            | Shipped: live menu item in `file-actions-menu.tsx`                                      |
| pinned chats           | Shipped: `use-sidebar-pins.ts`, wired through `sidebar-projection.ts`                   |
| tool-call detail level | Shipped 2026-08-02                                                                      |
| fork-failed-turns      | Shipped: both error paths live in `agent-stream/view.tsx`, translated everywhere        |
| Claude `[1m]`          | Shipped: `[1m]` entries in `model-manifest.ts`; thinking-off is live too                |
| Claude version-gating  | Not a port: needs a version-tagged manifest first, tagged `COMPAT(claudeVersionGating)` |
| shortcut search        | **Built 2026-08-02**                                                                    |
| window chrome          | Code on disk, unwired, renamed and tagged `UNWIRED(windowChrome)`                       |

**"fork-failed-turns" was never a feature.** `forkFailed` is an i18n key for the toast shown when a
fork fails, and Otto has had both call sites and all eight translations the whole time. Reading the
list literally would have meant building something that already existed.

**Shortcut search matches the resolved chord, not the default keys.** Upstream searches `row.keys`;
Otto already resolves user remaps for display, and a search disagreeing with the row beside it would
be worse than none. Modifier aliases are why this needs more than a substring match: on a Mac the
stored key is `mod` and the chord renders as a glyph, so neither contains the letters a person types.
`settings.shortcuts.searchPlaceholder` already existed and was already translated in all seven
non-English locales, upstream's i18n having landed without the feature that used it, so only
`searchEmpty` was added. A second placeholder key would have won by declaration order and orphaned
those seven translations, the same trap the tool-call detail port hit.

**The fifth documentation tree stays, and CLAUDE.md now says so.** The audit said to fold `findings/`
into `projects/README.md`. That would have destroyed roughly 1,300 lines of measured evidence
(method, numbers, retired hypotheses) by flattening it into a one-line-per-project ledger. What
CLAUDE.md actually forbids is a rival **status** registry, and `findings/` rule 4 already bars itself
from carrying status and requires linking to the row in `projects/README.md`. So the contradiction
was in the count, not the content: `findings/` is now a documented fifth tree, and the prohibition is
reworded to ban a status ledger rather than evidence. **This is a judgment call and cheap to
reverse** if Philippe disagrees: delete the row and fold.

## Lower-priority, verified

- **Mojibake introduced in 10 tracked files** - 169 lines in `protocol/src/messages.ts` alone have
  em-dashes/ellipses/arrows re-encoded as Latin-1 (`â€"`, `â€¦`, `â†'`); ours had zero. Three sites
  are **outside comments**: `provider-manifest.ts:220` (user-visible OMP mode description) and
  `session.ts:7415,7429` (agent-facing truncation suffix).
- **`judge-verdict.ts:7` was mangled by the rebrand pass** into "Absorbs upstream **Otto**'s…", which
  is self-referential nonsense; upstream is Paseo.
- **Eight untagged shims** that `rg "COMPAT\("` will not surface: the protocol `hosting` siblings
  (`messages.ts:8647`, `:8684`) beside their tagged `forge` twins; `HostingPrAttachmentSchema` /
  `HostingIssueAttachmentSchema` (`:2408`, `:2420`) **whose doc comment claiming new clients send them
  is now false**; the dead render branches in `attachment-pill-content.tsx:75,81`;
  `workspace-tabs-store/state.ts:11-14`; `git/forge.ts:133 forgeToHostingProvider`;
  `agent-panel.tsx:1004` (`visibilityCatchUpStatus` stub); `file-pane/bar.tsx:158-160`.
- **Fourteen genuinely undated COMPAT tags** (list in the second audit; mostly pre-existing).
- **Landed-but-unimported upstream modules:** ~~`toolCallDetailLevel`~~ (adopted and wired
  2026-08-02), `SidebarResizeHandle` /
  `SidebarHelpMenu` / `resolveDesktopSidebarWidth` in `left-sidebar.tsx`,
  `agent-stream/history-start-pagination.ts`, `settings/daemon-reconnect.ts`.
- **`markdown/html-ish.ts` kept ours** - `<b>/<strong>/<em>/<code>/<table>` now render raw in model
  output.
- **`desktop-settings.ts`**: the `daemonStopOnQuitDefaultApplied` migration was dropped **but its test
  was taken**, so that merged test fails.
- **`electron-builder.yml`**: the `otto://` URL scheme is never registered with the OS though the app
  parses those deep links.
- **`findings/` is a fifth documentation tree** (7 files). CLAUDE.md defines four and explicitly
  forbids a second registry or dated batch document. Fold into `projects/README.md`.

## What the audits confirmed as sound

Worth keeping, so remediation does not churn it:

- **Protocol contract: no violations.** All seven CLAUDE.md rules pass on the merge diff. New fields
  are `.optional()`, no new `.transform()`/`.catch()`/`.preprocess()`, no plain `z.union()` with a
  shared tag, no optional→required flips, no removed fields, no narrowing.
- **Browser/preview: clean, no parallel stack.** Upstream's host-window `(hostWebContentsId,
browserId)` rework was taken in full; Otto's `server/preview/` is a layer on top, present in neither
  base nor theirs. Zero extra hand-merge cost.
- **agent-stream module set** is a clean superset (upstream's files plus six Otto-only modules) -
  though `strategy-native.tsx` and `strategy-web.tsx` kept ours against 412 combined lines of churn.
- `prStatusOnly` is genuinely threaded (`workspace-git-service.ts:2080` → `checkout-session.ts:422` →
  `checkout-status-cache.ts:101`).
- Otto's base-ref resolution does run under `listCheckoutCommits` (`checkout-git.ts:3966` calls
  `resolveBaseRefForCwd`). **But** the comment at `checkout-session.ts:590` claiming it "takes the
  base ref as a parameter" is factually wrong - it resolves internally. Fix the comment.
- `confirmClose` live on 9 registrations, consumed at `workspace-screen.tsx:3544`. Focus mode wired
  end to end. All nine Otto tab kinds registered. Chatter ladder intact.
- `visibilityCatchUpStatus: "ready"` suppresses exactly two states (`sync_error` on catch-up failure,
  the `catching_up` indicator after backgrounding) - correctly self-identified as a stub.

---

## Companion document: merge-decisions.md

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
>   parameter". It does not - it calls `resolveBaseRefForCwd` itself. The
>   behaviour the comment describes is real; the mechanism is not. Comment fixed.
> - The verification state below reads "targeted suites green". `models.test.ts`
>   was not among them and was failing 19 of 40: it was hand-merged with
>   upstream's version while the manifest kept ours, so it imported three symbols
>   that do not exist. `npm run typecheck` cannot see this - the server typecheck
>   project excludes test files - so a green typecheck says nothing about whether
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
| `forge_change_request` / `forge_issue` attachments            | `hosting_pr` / `hosting_issue`                     | **Required, not cosmetic** - the merged daemon's `prompt-attachments.ts` handles `forge_*` and legacy `github_*` but **no longer `hosting_*`**. Keeping ours would have dropped PR attachments silently on submit                          |
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
| nine Otto tab kinds                                                                                                                                      | `artifact`, `gitLog`, `visualizer`, `fileHistory`, `codeReferences`, `codeRename`, `refine`, `contextManagement`, `orchestrationGraph` - added to **their** new `workspace-tabs/model.ts` union                                                                                                                                                                                                                                              |
| focus mode                                                                                                                                               | Rewired onto their scoped `workspace.focus.toggle` action. They routed `view.toggle.focus` there but registered no handler, so the shortcut would have been silently dead                                                                                                                                                                                                                                                                    |
| Chatter personality ladder                                                                                                                               | They rebuilt `input-draft.ts` on the draft store and dropped the personality block entirely; grafted back onto their structure                                                                                                                                                                                                                                                                                                               |
| Bitbucket `/pull-requests/N` URL grammar                                                                                                                 | Their `pr-hint` regex covers `pull                                                                                                                                                                                                                                                                                                                                                                                                           | pulls | merge_requests` but not Bitbucket's spelling |
| `setTrayAttention`, `signalReady`, `description` on `GitAction`, `PANE_TOOLBAR_HEIGHT`, `navigateToPreparedWorkspaceTab`, `findCheckoutHintPrAttachment` | Otto-only, no upstream equivalent; each restored onto upstream's module layout                                                                                                                                                                                                                                                                                                                                                               |
| `hostingProvider` / `hostingCapabilities` **alongside** their `forge`                                                                                    | 28 call sites consume the narrowed provider id for icons and capabilities. Deliberate keep-both. **Correction: they cannot collapse.** `bootstrap.ts:1201-1204` registers Bitbucket into the forge registry under the forge id `github`, which "keeps its historical name - it is the provider-routing facade". So `forge` reads `"github"` for a Bitbucket workspace and only `hosting.provider` carries the truth. They disagree by design |

## Deleted as superseded - audit these first

These are the highest-risk calls, because deleting Otto code is irreversible in review terms and the
"took over the job" claim is the only thing standing behind each one.

- **`FileContextAttachment`** was deleted, then **restored**: the usage check excluded the declaring
  file, and `WorkspaceComposerAttachment` still referenced it. It is back. Mentioned because it shows
  the failure mode.
- **`buildWorkspaceCheckout`, `resolveWorkspaceForImportedAgent`** - Paseo's `runInImportWorkspace`
  demonstrably took over. Verify no import path lost behaviour.
- **`skipIfUserMessageExists`** - upstream removed it and replaced the mechanism with
  `handoffCreatedAgentUserMessageToStream`. Only a test referenced it.
- **`backfillUserMessageAttachments`** - see the table above.
- **Otto's eager browser registration + `clearPartition` on tab close** - browsers now share one
  profile partition and clearing it is a deliberate settings action (`clearProfile`).
- **`foregroundExtraMuted`** - Otto's themes stop at `foregroundMuted` and each tint would need its
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
   nothing registers them. Marker: `DEFERRED(paseoDiffTab)` in `register-panels.ts` - **the marker was missing until remediation; the insertion script's anchor failed silently.** It is there now, and records that `working_diff`/`commit_diff` are live tab kinds with identity builders and menu entries, so opening one yields a dead tab.
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
- **Blanket renames collapse distinct branches** - `status.github` and `status.bitbucket` both became
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
versions, so it is the worktree's module layout rather than merge fallout - but those three want a
CI run. The full suite has not run locally by policy.

## Timeline

- time: "2026-08-08T06:18:03.718Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:03.718Z"
  kind: "evidence"
  summary: "Migrated all Markdown under `projects/paseo-v025-merge`. This project had no row in the legacy `projects/README.md` ledger, so delivery defaults to charter."
- time: "2026-08-08T06:19:53.939Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."

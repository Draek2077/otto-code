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

| Item                                                         | State              | Note                                                    |
| ------------------------------------------------------------ | ------------------ | ------------------------------------------------------- |
| Mojibake in tracked source                                   | Fixed              | 754 runs across 9 files; see below                      |
| `judge-verdict.ts` rebrand corruption                        | Fixed              | "upstream Otto's" is upstream **Paseo's**               |
| Mixed-case `projectId` on upgrade                            | **Does not repro** | pinned by comment + test; no migration needed           |
| `html-ish.ts` renders raw HTML                               | Already fixed      | `b/strong/em/i/code/table` all translate; 51 tests pass |
| `desktop-settings` migration dropped                         | Already fixed      | present at `desktop-settings.ts:285`                    |
| `otto://` scheme unregistered                                | Already fixed      | `electron-builder.yml` registers it                     |
| `DEFERRED(paseoDiffTab)` marker missing                      | Fixed              | now real in `workspace-tabs/identity.ts`, with a test   |
| `toolCallDetailLevel` half-landed                            | **Confirmed dead** | needs a product call, see below                         |
| Backpressure, auto-name, agent-state leak, Nix speech worker | Open               | not started                                             |

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

**`toolCallDetailLevel` needs Philippe, not an implementer.** The field is a valid `AppSettings` key
with a default and a validator, but it is absent from `APP_SETTINGS_UPDATE_KEYS`, so writes are
silently dropped, and it has zero readers. Wiring it up means porting Paseo's tool-call detail
feature; deleting it means declining that feature. Both are product calls, so it is left exactly as
found rather than half-resolved in a cleanup commit.

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

`docs/upstream-merges.md:226` reads: _"Hub (`a414f8ea8`) — permanent exclusion. Never incorporate."_
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

### 1. The draft workspace tab crashes on render — VERIFIED

`packages/app/src/composer/draft/workspace-tab.tsx:553` calls `useCommandCenterActions`
unconditionally. That calls `useCommandCenterRegistry`
(`packages/app/src/command-center/provider.tsx:25-29`), which does
`if (!registry) throw new Error("CommandCenterProvider is required")`.

`CommandCenterProvider` is **mounted nowhere**. Meanwhile `packages/app/src/app/_layout.tsx:31` still
mounts Otto's separate `@/components/command-center` (677 lines).

Upstream's `packages/app/src/command-center/` (10 files, 1,590 lines) landed with exactly **three**
importers, all in `workspace-tab.tsx` — which is what turns dead code into a crash. (One audit
reported zero importers; that was wrong, and the correction makes it worse, not better.)

**Decide:** mount `CommandCenterProvider` and migrate `_layout.tsx` onto upstream's command center, or
revert `workspace-tab.tsx`'s three imports to Otto's. Do not ship both stacks.

### 2. Project rename reaches the UI through neither carrier — VERIFIED

`applyProjectDescriptor` has exactly two references tree-wide: its type declaration
(`session-store.ts:657`) and its implementation (`:1791`). **Zero callers.**

The merge deleted the `project.updated.notification` subscription from
`packages/app/src/contexts/session-context.tsx`. The daemon still emits it
(`packages/server/src/server/session.ts:5540`). This was Otto-only code with no upstream counterpart,
so nothing took over. Renaming a project updates neither the project record nor the
`projectDisplayName` denormalized onto each workspace descriptor until a reconnect.

Fix: restore the subscription. The reducer itself is correct and was already ported onto upstream's
single `projects` map.

### 3. `hosting_*` prompt attachments throw in the daemon — VERIFIED

`packages/server/src/server/agent/prompt-attachments.ts:123` ends its switch with
`throw new Error("unreachable")`. Pre-merge the same file had `case "hosting_pr"` and
`case "hosting_issue"` (confirmed: 2 hits at `f4ea7c6f7`, 0 now).

The protocol **still accepts** them — `HostingPrAttachmentSchema` / `HostingIssueAttachmentSchema`
remain in `AgentAttachmentSchema` (`messages.ts:2496-2497`). So an older client's PR attachment
validates and then hits an uncaught throw on the prompt-build path for **every provider**.

Fix: either handle both kinds (mapping to the `forge_*` rendering) or make the default arm degrade
instead of throwing. Prefer handling them; a silently dropped attachment is its own bug.

### 4. Bitbucket Cloud PR merge is dead client-side

`packages/app/src/git/forges/` contains github, gitlab, gitea, forgejo, codeberg and **no bitbucket**.
Only gitea/github/gitlab register a `deriveMergeCapability`, so it returns `null` for Bitbucket facts.
`canMergePr` (`packages/app/src/git/policy.ts:562-572`) then falls into the `capability === null`
branch, which requires `pullRequestMergeable === "MERGEABLE"` — a GitHub-only value Bitbucket never
produces.

Pre-merge `policy.ts` had explicit Bitbucket branches (gating on branch-in-sync, and
`bitbucket.mergeStrategiesAllowed.includes(method)` per method). `bitbucket` now appears **zero**
times in `policy.ts`. The daemon adapter (`packages/server/src/services/git-hosting/bitbucket-*.ts`)
is intact — this is purely the client half.

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
   `github`**, stating outright that "`github` keeps its historical name — it is the provider-routing
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

**Not yet measured:** the ~180 _conflict-resolved_ wholesale-ours files are a different set from these
168 byte-identical ones. A file whose side won a conflict and was then edited is invisible to the
byte-identical scan — `checkout-session.ts` (regression 5) is exactly that case. **That gap is the
most likely home of further regressions and nobody has sized it.**

## Lower-priority, verified

- **Mojibake introduced in 10 tracked files** — 169 lines in `protocol/src/messages.ts` alone have
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
- **Landed-but-unimported upstream modules:** `toolCallDetailLevel` (storage field only, not in
  `APP_SETTINGS_UPDATE_KEYS` so writes are dropped, zero readers), `SidebarResizeHandle` /
  `SidebarHelpMenu` / `resolveDesktopSidebarWidth` in `left-sidebar.tsx`,
  `agent-stream/history-start-pagination.ts`, `settings/daemon-reconnect.ts`.
- **`markdown/html-ish.ts` kept ours** — `<b>/<strong>/<em>/<code>/<table>` now render raw in model
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
- **agent-stream module set** is a clean superset (upstream's files plus six Otto-only modules) —
  though `strategy-native.tsx` and `strategy-web.tsx` kept ours against 412 combined lines of churn.
- `prStatusOnly` is genuinely threaded (`workspace-git-service.ts:2080` → `checkout-session.ts:422` →
  `checkout-status-cache.ts:101`).
- Otto's base-ref resolution does run under `listCheckoutCommits` (`checkout-git.ts:3966` calls
  `resolveBaseRefForCwd`). **But** the comment at `checkout-session.ts:590` claiming it "takes the
  base ref as a parameter" is factually wrong — it resolves internally. Fix the comment.
- `confirmClose` live on 9 registrations, consumed at `workspace-screen.tsx:3544`. Focus mode wired
  end to end. All nine Otto tab kinds registered. Chatter ladder intact.
- `visibilityCatchUpStatus: "ready"` suppresses exactly two states (`sync_error` on catch-up failure,
  the `catching_up` indicator after backgrounding) — correctly self-identified as a stub.

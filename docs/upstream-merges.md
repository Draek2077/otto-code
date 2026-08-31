# Ingesting upstream Paseo changes

Otto is a fork of [Paseo](https://github.com/getpaseo/paseo) with full upstream
history preserved. The `upstream` remote points at the Paseo repo, so upstream
changes are ingested with a normal `git merge` - plus a rebrand pass, because
every upstream change that mentions "paseo" must be translated to Otto naming.

The rebrand is purely rule-based (see `scripts/rebrand-upstream.pl`), which makes
merges mechanical: when in doubt, take upstream's version of a hunk and re-run
the rules on it.

## The naming map

| Upstream                                      | Otto                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Paseo` / `paseo` (prose, identifiers)        | `Otto` / `otto`                                                                                        |
| `@getpaseo/*` npm scope                       | `@otto-code/*`                                                                                         |
| `getpaseo/paseo` GitHub repo                  | `Draek2077/otto-code`                                                                                  |
| `getpaseo` org                                | `Draek2077`                                                                                            |
| `paseo.sh` domain                             | `otto-code.me`                                                                                         |
| `PASEO_*` env vars                            | `OTTO_*`                                                                                               |
| `sh.paseo` / `.debug` / `.desktop` bundle ids | Desktop: `ai.ottocode.desktop`. **Mobile: `me.ottocode.mobile` / `.debug`** (no hyphens - reverse-DNS) |
| `paseo` CLI command                           | `otto`                                                                                                 |
| `~/.paseo` data dir, `paseo.json` config      | `~/.otto`, `otto.json`                                                                                 |
| Default daemon port `6767`                    | `6868`                                                                                                 |

## Upstream tags never live in `refs/tags/` - set this up once per clone

Otto cuts its own `vX.Y.Z` releases, so our tag names collide with Paseo's:
there is an Otto `v0.4.0` **and** a Paseo `v0.4.0`, and they are different
commits. `git fetch upstream --tags` silently refuses every colliding name and
leaves `v0.4.0` pointing at ours. `git merge v0.4.0` would then merge an Otto
release into itself, and `scripts/upstream-status.mjs` reported "upstream has not
tagged a release since our baseline" while three upstream releases sat there.

Map upstream tags into their own namespace instead. One-time, per clone:

```bash
git config --add remote.upstream.fetch '+refs/tags/*:refs/upstream-tags/*'
git fetch upstream
```

`upstream-status.mjs` refuses to run without this and prints the same two
commands. Afterwards, upstream releases are addressable and unambiguous:

```bash
git for-each-ref --format='%(refname:strip=2)' refs/upstream-tags/   # list them
git rev-parse refs/upstream-tags/v0.4.0^{}                           # peel to a commit
```

**Always merge by SHA, never by tag name.** The report prints the exact
`git merge <sha>` line for the target.

## Merge procedure

```bash
git fetch upstream
node scripts/upstream-status.mjs                 # which releases are available?
node scripts/upstream-status.mjs --at v0.4.0     # size the merge you actually plan to do
git checkout -b merge/upstream-$(date +%Y-%m) main
git merge b44bb63cf                              # the target's SHA - see Cadence, and above
```

### 0. Read the drift report first

`scripts/upstream-status.mjs` prints the baseline (`git merge-base HEAD
upstream/main`), how far upstream has moved, which release tags are available to
merge at, and - the part that matters - whether upstream landed work inside a
subsystem Otto has independently rebuilt. Do not start a merge without reading
the **watchlist** section; the ledger below records what previous merges decided
about each of those subsystems so the same argument isn't had twice.

Pass `--at <tag>` once you know your target. The default measures against
`upstream/main`, which always overstates the work because main carries unreleased
commits: at the v0.2.5 baseline, main showed 442 commits and 838 overlapping
files while the actual v0.4.0 target was 280 and 696. Size and triage the merge
from the `--at` numbers, not the default ones.

### 1. Resolve conflicts

For each conflicted file, prefer upstream's side of the hunk (it has their new
logic), then re-apply the rebrand rules to that file:

```bash
git checkout --theirs <file>
perl -CSD scripts/rebrand-upstream.pl <file>
git add <file>
```

Only hand-merge when Otto has made _functional_ (not naming) changes to the
same lines.

### 2. Rebrand anything new

Upstream additions that didn't conflict can still carry paseo naming (new files,
new env vars, new docs). Run the script over everything the merge touched:

```bash
git diff --name-only HEAD@{1} HEAD -- | xargs perl -CSD scripts/rebrand-upstream.pl
```

Rename any new paseo-named files/dirs:

```bash
git ls-files | grep -i paseo   # then git mv each, applying Paseo->Otto / paseo->otto
```

### 3. Audit - must be clean before committing

```bash
git grep -ilE 'paseo|getpaseo' -- \
  ':!LICENSE' ':!NOTICE' ':!README*' ':!CHANGELOG.md' \
  ':!CLAUDE.md' ':!docs/upstream-merges.md' ':!docs/fork-release-guide.md' \
  ':!scripts/rebrand-upstream.pl' \
  ':!packages/website/src/components/landing-page.tsx' \
  ':!packages/website/src/components/site-footer.tsx' \
  ':!packages/website/src/routes/index.tsx' \
  ':!packages/website/src/routes/sponsor.tsx' \
  ':!packages/app/src/styles/theme.ts' \
  ':!packages/app/src/utils/upstream-base-version.ts'
```

Expected output: **nothing**. The excluded files keep Paseo references on
purpose:

- `LICENSE`, `NOTICE`, and the README credits - AGPL attribution.
- `CLAUDE.md`, `docs/upstream-merges.md`, `docs/fork-release-guide.md`, and
  `scripts/rebrand-upstream.pl` - they document the fork relationship and the
  rebrand rules themselves.
- The website landing/footer/sponsor pages - public "built on Paseo" credit
  and the sponsorship page pointing at upstream's author.
- `packages/app/src/styles/theme.ts` - comments recording which themes are
  inherited from upstream.
- `packages/app/src/utils/upstream-base-version.ts` - the single source of the
  upstream base name + version shown in Settings → About. It is Otto-only (so
  the rebrand pass never touches it) and deliberately holds the "Paseo" literal
  so the display code and i18n never have to. Bump its version in step 4 below.

Anything outside this list must be Otto. If a merge adds a new intentional
reference (e.g. more credit copy), add it to the exclusion list here in the
same commit.

Also check the port didn't sneak back:

```bash
git grep -n '\b6767\b' -- ':!*package-lock.json'
```

And check that upstream's Hub subsystem is still inert. Hub is a **permanent
exclusion** (see the standing decision below), but it landed anyway in the
v0.2.5 merge, so the check is no longer "is it absent" but "is it unreachable".
The source grep now returns plenty and that is expected:

```bash
# The real invariant: no runtime edge into the hub subsystem. Type-only imports
# are fine because they are erased; a `.js` hit means Hub is loading again.
npm run build:server
grep -rln 'from "\./hub/\|from "\.\./hub/' packages/server/dist/server/ | grep '\.js$'
```

Expected output: **nothing**. A `.js` hit means something re-imported a real Hub
module as a value. Point that specifier back at
`packages/server/src/server/hub-disabled.ts` rather than letting the subsystem
back into the module graph.

### 4. Bump the upstream base version

Every upstream merge **must** update `UPSTREAM_BASE_VERSION` in
`packages/app/src/utils/upstream-base-version.ts` to the Paseo release this merge
ingests. That constant is the single source of the "Based on Paseo vX.Y.Z" line
shown in Settings → About next to the Otto app version, so users can tell which
upstream fixes are under the hood - a stale value silently misreports the base.

Only the version changes; `UPSTREAM_BASE_NAME` stays `"Paseo"`. Read the number
from the upstream tip you're merging (works during or after the merge):

```bash
git show MERGE_HEAD:package.json | grep -m1 '"version"'      # during the merge
git show upstream/main:package.json | grep -m1 '"version"'   # or from the fetched tip
git describe --tags upstream/main                            # sanity-check the tag
```

This is why the file is on the audit exclusion list in step 3 - it is the one
place the "Paseo" literal is allowed to live. Do not move the name/version into
the display code or i18n strings; the rebrand pass would rewrite them on the next
merge that touches those files.

That exclusion cuts both ways: because step 3 skips this file, a rebrand pass that
wrongly rewrites it is invisible to the audit. The v0.2.5 merge did exactly that,
and About shipped "Based on Otto v0.1.106" until someone read it. So assert the
literal directly, every merge:

```bash
grep -q 'UPSTREAM_BASE_NAME = "Paseo"' packages/app/src/utils/upstream-base-version.ts \
  || echo 'FAIL: the rebrand pass ate the upstream base name'
```

### 5. Regenerate lockfiles and verify

```bash
npm install --package-lock-only
npm run typecheck
npm run lint
```

Then merge the branch into `main`.

### 6. Prove no Otto module was orphaned

The doctrine that keeps merges cheap - Paseo owns the architecture, Otto's
features live in their own files hanging off it - is also what makes a dropped
feature invisible. An Otto-only module's sole call site usually sits inside an
upstream file, so resolving that file to THEIRS leaves the module on disk,
compiling, passing its own tests, and reachable from nothing. Typecheck is
silent, lint is silent, and UI loss has no compile signal at all.

`scripts/merge-orphan-guard.mjs` snapshots which Otto-only modules have live
importers, then re-checks after the merge. **The baseline must be captured
before you merge**; taken afterwards it records the damage as normal.

```bash
node scripts/merge-orphan-guard.mjs --baseline --at v0.6.1   # clean tree, before merging
node scripts/merge-orphan-guard.mjs --check                  # after resolving conflicts
```

Every reported module is an Otto feature whose call site left with a THEIRS
resolution. Re-attach it to upstream's new structure, or record dropping it in
the ledger table - a wholesale resolution is a decision either way.

The "Otto-only" set is computed as present in HEAD, absent from the target, and
absent from the merge base. That last clause is what makes it rename-proof:
without it every file upstream renamed inside the merge window reads as an Otto
invention. `explorer-sidebar.tsx` at v0.6.1 is exactly that case, an upstream
file renamed to `compact-explorer-sidebar.tsx`, whose edits git carries across
the rename and which needs no guarding.

## Script gotchas (learned the hard way)

- **Third-party links stay upstream-named.** Community projects like
  `paseo-relay` and `paseo-vscode` are real external URLs - rebranding them
  breaks the links. Check README/community references after running the script.
- **The `6767` rule can mangle lookalikes.** It once rewrote a test UUID
  containing `-6767-` segments. After a merge, scan for accidental `6868`
  inside UUIDs/hashes: `git grep -nE '6868-6868'`.
- **Bundle ids must stay hyphen-free.** Never let `sh.paseo` map to anything
  containing `otto-code` - reverse-DNS segments cannot contain hyphens.
- **Mobile and desktop bundle ids are not the same namespace.** Desktop is
  `ai.ottocode.desktop`; the Android/iOS app is `me.ottocode.mobile` (`.debug`
  for `APP_VARIANT=development`), because Play Store package names are permanent
  once published (see [fork-release-guide.md](fork-release-guide.md)). A blanket
  `sh.paseo` -> `ai.ottocode` rewrite gets mobile wrong. When any package id
  moves, grep the **whole** repo for the old one: `packages/app/maestro/` and
  `packages/app/e2e/mobile/` held a dead id for weeks, which silently broke
  every flow while the app itself worked fine.
- **`LICENSE` is never rewritten.** The upstream copyright notice must remain
  verbatim (AGPL requirement). The script is simply never run against it.

## Cadence

**Merge at upstream's minor release tags, not at `upstream/main`.**

The earlier policy here was "merge every upstream release, small and often." That
was written when the fork was young and conflicts were almost purely naming. It
no longer matches reality: Otto now rewrites the same subsystems upstream is
evolving, so conflicts are functional regardless of merge size. Once size stops
buying you cheaper conflicts, the thing worth minimizing is the **number of merge
events**, not the size of each one.

Merging at a tag rather than at `main` wins three ways:

- Upstream has already fixed its own mid-flight regressions before it tags.
- There is a written changelog to review the merge against.
- You resolve each conflicted file once, instead of re-resolving it every time
  upstream iterates on it across a release cycle.

Rules:

- **Merge at `vX.Y.0` minor tags.** Patch releases are only worth a merge when
  they carry a fix Otto actually needs.
- **Never merge an `-rc` / `-beta` tag or a bare `main`.** `upstream-status.mjs`
  flags this - a `describe` output ending in `-N-g<sha>` means the tip is
  mid-flight. Unreleased work sits there (upstream's Hub subsystem lived on
  `main` for days in no tag at all).
- **Cherry-pick out-of-band** for security fixes or a bug that's actively biting.
  Record it in the ledger so the next full merge knows it's already in.
- **Don't stretch past two minor releases.** Beyond that, the real risk isn't
  conflict volume - it's upstream independently rebuilding something Otto already
  ships (see the `v0.2.0` forge entry below).
- **Read every minor release's changelog even when you skip the merge.** This is
  the cheap early warning for that rival-abstraction problem, and it's the only
  step here that catches it _before_ the work is wasted.

## What we last took

Git is the authority on **what** we last merged - `git merge-base HEAD
upstream/main`, accurate as long as upstream is always ingested with a real merge
(never a squash or rebase). `scripts/upstream-status.mjs` reads it for you.

The table below is the authority on **why**: what each merge deliberately left
behind, and what still needs deciding. Without it, every merge re-litigates the
same subsystems from scratch.

| Merged     | Upstream tag | Upstream sha | Otto version | Deliberately skipped                                                            |
| ---------- | ------------ | ------------ | ------------ | ------------------------------------------------------------------------------- |
| 2026-07-12 | v0.1.106     | `c05e337cd`  | 0.5.x        | -                                                                               |
| 2026-08-01 | v0.2.5       | `6fc491e62`  | 0.7.5        | Hub (`a414f8ea8`) - **permanent**; upstream's client-side subagent presentation |
| 2026-08-21 | v0.4.0       | `b44bb63cf`  | 0.8.12       | Not recorded at the time. Reconstructed from git only; treat as unknown.        |
| 2026-08-30 | v0.6.1       | `20d7efc46`  | 0.8.19       | Tab-bar workspace pins, and Otto's app-side diff layer - both **to revisit**    |

The 2026-08-21 row is a warning as much as a record. That merge happened and
nobody wrote down what it left behind, so the only surviving account of it is the
diff. Fill a row in during the merge, not after.

**The rebrand pass will eat this file if you let it.** Step 2 says to run
`scripts/rebrand-upstream.pl` over everything the merge touched. This document is
on the step-3 audit exclusion list because it must keep its Paseo references, but
an exclusion list does not stop the script - and if you edit this file during a
merge it becomes "merge-touched" and the blanket pass rewrites it into nonsense
("Otto is a fork of Otto"). Exclude it explicitly from the rebrand xargs, or
re-check it afterwards.

### Orphaned at v0.6.1, to re-attach

`scripts/merge-orphan-guard.mjs --check` reports these Otto modules as having
lost every call site. Each is intact on disk and reachable from nothing, because
the file that used to call it was resolved to upstream's side. They are features,
not dead code.

| Otto module                                                   | Call site it lost                | What it is                              |
| ------------------------------------------------------------- | -------------------------------- | --------------------------------------- |
| `app/src/git/diff-base-switcher.tsx`                          | `git/diff-pane.tsx`              | Fork-point diff base picker             |
| `app/src/git/open-git-log-tab.ts`                             | `git/diff-pane.tsx`              | Git Log tab entry point                 |
| `app/src/git/running-agent-labels.ts`                         | `git/diff-pane.tsx`              | Running-agent labels in the diff header |
| `app/src/hooks/use-non-client-hover.ts`                       | `workspace-desktop-tabs-row.tsx` | Hover in the OS non-client area         |
| `app/src/screens/workspace/workspace-preview-controller.tsx`  | `workspace-desktop-tabs-row.tsx` | Preview controls in the tab row         |
| `app/src/screens/workspace/workspace-tab-actions-overflow.ts` | `workspace-desktop-tabs-row.tsx` | Tab overflow actions                    |
| `server/src/server/otto-daemon-config.ts`                     | `daemon-config-store.ts`         | Otto daemon config helper               |

`desktop/src/features/editor-targets.ts` also orphaned, but that one is genuine
supersession: upstream moved the same feature to `features/editor-targets/ipc.ts`
and it is wired. Nothing to do.

The three `diff-pane.tsx` entries and the three `workspace-desktop-tabs-row.tsx`
entries share a cause: both files were taken from upstream wholesale because
upstream rebuilt them (canvas diff rendering, and tab sizing/overflow). That was
the right call for the mechanism and it cost these six call sites.

Also deleted by rename detection and restored by hand, because Otto still imports
them: `screens/settings/appearance/apply-appearance.ts`,
`screens/workspace/workspace-empty-draft-seed.ts`,
`desktop/components/skill-selection-sheet.tsx`, `composer/input/height-mirror.web.ts`,
and `components/explorer-sidebar.tsx` (upstream renamed ours to
`compact-explorer-sidebar.tsx` and kept it as the compact slide-over; Otto's
docked sidebar is restored as its own file).

The v0.2.5 row also left behind things nobody chose to skip. Large conflicted
files were resolved wholesale to OURS, which drops upstream hunks silently: no
conflict marker, no failing test, nothing to grep. `packages/desktop/src/main.ts`
lost the entire browser-keyboard wiring and the `clear-profile` handler while
`preload.ts` and the app kept the THEIRS side that calls them, so both surfaced
later as "No handler registered for ...". `packages/desktop/src/features/editor-targets/`
came in whole and was never wired up, so seven editors upstream supports are
still invisible in Otto.

**A wholesale-OURS resolution is a decision, so record it in the table above.**
Two mechanical sweeps catch what slips through, and both belong in step 5:

```bash
# every channel the preload invokes must have a main-process handler
# every exported symbol should have at least one non-test caller
```

### Standing decisions

These carry across merges. Revisit only when the stated trigger fires.

- **Hub (`a414f8ea8`) - permanent exclusion. Never incorporate.**

  A daemon↔cloud control plane whose counterparty is a closed "Paseo Cloud" repo
  this fork has no access to. Untestable and unusable here, and it is not on
  Otto's roadmap in any form - Otto's remote story is the E2E-encrypted relay
  (see [SECURITY.md](../SECURITY.md)), which is self-hosted by design. Nothing
  about Hub is unsafe (enrollment is genuinely opt-in; nothing phones home before
  `hub connect`) - it simply buys this fork nothing, ever. **No revisit trigger.**

  **It is not self-contained, and that is the part to plan for.** The
  `packages/server/src/server/hub/` directory is only half of it. The commit also
  threads a new `owner` concept through agent persistence:
  - `agent/agent-owner.ts` - new `AgentOwnerSchema`, a `discriminatedUnion` with
    one variant (`daemon`) that is plainly built to grow.
  - `agent/agent-storage.ts` - `owner` added to the **persisted agent record**,
    plus two secondary indices (`daemonAgentIdsByExecution`,
    `daemonExecutionKeysByAgentId`) and `findByDaemonExecution`.
  - Threaded onward through `agent-loading.ts`, `agent-projections.ts`,
    `create-agent/create.ts`, `create-agent-lifecycle-dispatch.ts`,
    `persistence-hooks.ts`, `session.ts`, `session/daemon/daemon-session.ts`,
    `bootstrap.ts` (which constructs the controller unconditionally at startup),
    `agent-manager.ts`, `websocket-server.ts`, `client/src/daemon-client.ts`,
    `protocol/src/messages.ts` (+143), and `cli/src/cli.ts`.

  So excluding Hub is a **recurring cost, not a one-time skip**: every future
  merge touching those shared files re-offers Hub hunks, and each must be
  rejected again. Two consequences worth knowing before you hit them:
  - The `owner` field is `.optional()`, so declining it is protocol-safe in both
    directions - we simply never write or read it.
  - The real risk is **compile coupling**: if a later upstream change puts
    non-Hub logic in a file that references Hub types, that hunk cannot be taken
    as-is. Strip the Hub reference rather than pulling the subsystem in behind it.

  Enforce the exclusion in step 3 of the audit rather than trusting merge-time
  vigilance - the grep is in the audit block above.

  **Update (2026-08-02): Hub landed, and is now gated off rather than stripped.**
  The v0.2.5 merge brought the whole subsystem in: 12 files under
  `packages/server/src/server/hub/`, `packages/cli/src/commands/hub/`,
  `docs/hub.md`, `agent/agent-owner.ts`, and `owner` threading through seven
  shared files. Exactly the recurring cost predicted above, arriving all at once.

  Stripping it would mean hand-editing `bootstrap.ts`, `session.ts` and
  `cli.ts`, which are the three files upstream edits most, so every future merge
  would conflict on our deletions. We took the cheaper and more durable option
  instead: **switch it off at the import specifier.**

  `packages/server/src/server/hub-disabled.ts` and
  `packages/cli/src/commands/hub-disabled.ts` export inert stand-ins with the
  same names. The three value imports now resolve there, and every other line at
  those call sites is left byte-identical to upstream, so upstream's future edits
  to the hub wiring keep auto-merging instead of conflicting. Because nothing
  imports `./hub/*` as a value any more, the subsystem never enters the daemon's
  module graph: off means not loaded, not merely unused. The stubs re-export the
  real modules' types (erased at compile time), so if upstream reshapes a Hub
  interface, the stubs stop typechecking instead of drifting quietly.

  Consequences to know:
  - Three of the six hub suites boot a real daemon through `createOttoDaemon`
    and therefore cannot pass. They are excluded in
    `packages/server/vitest.config.ts`, not edited, so all six files stay
    byte-identical to upstream. The other three construct the controllers
    directly and still run, which is what keeps the stubs honest.
  - `otto hub ...` still exists and reports one sentence explaining it is off.
  - Re-enabling is repointing three specifiers and removing the test exclusion.
    `rg "DISABLED\(hub\)"` finds every piece.

  **This does not amend the standing decision.** Hub remains excluded and
  unsupported. Should it ever be reconsidered, that is a product call, not an
  implementation one.

- **Forge abstraction (`a8ebd390f`) - took theirs, ported ours onto it.**
  Upstream shipped a pluggable forge layer (GitLab, Gitea/Forgejo/Codeberg,
  CLI-delegated auth) covering the same concern as our `git-hosting` layer
  (GitHub + Bitbucket Cloud, stored credentials). Two rival abstractions over one
  concern means hand-merging every future upstream PR that touches PR/issue code,
  so upstream's is now the base and Bitbucket Cloud is a REST-backed adapter
  registered against it. **This is the cautionary tale the cadence rules exist
  for** - upstream built it while we were building ours, and nobody noticed until
  the merge. Hence the watchlist in `upstream-status.mjs`.

- **Provider subagents (`66445adc0` and successors) - split by layer.**
  We take upstream's **daemon-side ingestion verbatim and never edit those
  files** (`ProviderSubagentStore`, the `agent.provider_subagents.*` RPCs, and
  every provider adapter), because that is where their recurring fixes land -
  phantom parents, stuck sessions, hidden Codex subagents. We keep **our client
  presentation** and project their store into Otto's observed-subagent model,
  which carries the per-subagent usage accounting, nesting, and stop control
  their descriptor has no room for.

  **Amended at v0.2.5 (2026-08-01).** This entry used to end "don't register
  their `provider-subagent-panel`, don't take their `select.ts` discriminated
  union." That instruction assumed the choice was our presentation _or_ theirs.
  It isn't. `select.ts` now carries a union tagged on `kind`: `OttoSubagentRow`
  keeps the full accounting (`cumulativeUsage`, `toolUseCount`,
  `personalityName`, …) and `ProviderSubagentRow` carries the provider
  descriptor. Our presentation still owns our rows; theirs adds a row kind our
  model cannot represent, because a provider-reported subagent has no Otto agent
  record behind it. Their panel is registered and wired end to end
  (`workspace-tab-menu.ts` opens the `provider_subagent` tab; the panel reads
  `subagents/provider-store`), which is what makes provider-native subagents
  visible at all - previously they were not.

  So: still take the daemon side verbatim, still keep our presentation for our
  own rows, and **do** take their row kind, their panel, and the `${row.kind}_`
  presentation-key prefix that stops the two id spaces colliding. See
  `projects/upstream-subagent-convergence/`.

### Dropped at v0.6.1, to revisit

#### `use-settings/migrations.ts` - the steer-default migration

Upstream added a one-shot migration flipping every existing install's
`sendBehavior` from `interrupt` to `steer`, alongside a three-option send picker.
Otto's picker offers two options (`interrupt` and `queue`), and Otto's settings
`SendBehavior` union has no `steer` member - the steer queue is the `queue`
option. Running the migration would leave users pinned to a value the settings
screen cannot display or reselect.

Dropped rather than adapted: `migrateAppSettings` had no caller in the merged
tree either. Revisit if Otto ever adds a third send option; the marker key
(`SETTINGS_MIGRATIONS_KEY`) is still defined, so the framework can come back
without a rename.

### Silent breakage found by the v0.6.1 test pass

Everything below typechecked and linted clean. The conflict resolution had
produced code that compiled and was wrong, which is the failure mode this
section exists to make findable next time. Each was found by running a suite,
not by reading a diff.

**Both sides' turn start survived, so every foreground turn started twice.**
Upstream extracted the inline `session.startTurn` in `streamAgent`'s forwarder
into `startPendingForegroundTurn`. The merge kept Otto's inline call _and_ added
upstream's helper call after it. The second start hit the provider's
"A foreground turn is already active" guard, so every run failed. This is the
one to look for first after a merge: an extraction upstream performed leaves the
original in place, and both halves compile.

**Two `AgentRunState` instances.** The same conflict left Otto's `foregroundRuns`
and upstream's `runs` both declared, with two call sites settling runs on a
registry nothing else read. Collapsed onto `foregroundRuns`.

**`onStreamTurnStarted` lost its suppression flags.** The run generator yields
the accepted `turn_started` itself, so the provider's echo must not also reach
clients. Otto's copy dropped the `flags` parameter and forwarded both. Note that
Otto suppresses only `shouldDispatchEvent`, not `shouldNotifyWaiters` as upstream
does: Otto's run-start waiters key off this event, and suppressing the
notification hangs them.

**Cancellation stopped sharing the steer lock.** Upstream runs `cancelAgentRun`
through `runForegroundMutation`, the same tail steer admission uses, so a
replacement issued mid-steer waits instead of interrupting a turn the steer may
have just entered. Otto's merged copy called the inner path directly.

**Rewind lost the provider-acknowledgement guard.** A submitted prompt carries
the client's id until the provider echoes it back under its own; rewinding in
that window hands the provider an id it has never seen. Restored, along with
resolving the provider id for the capability call.

**Test files were spliced together mid-declaration.** Three cases: upstream's
`canonical submitted prompt keeps wire identity while rewind resolves provider
identity` was fused into Otto's `authoritative timeline includes provider-emitted
submitted user prompt`; `session.test.ts` lost its whole `describe("preview
RPCs")` header (and with it `makeProjectRoot`/`fakePreviewDevServers`), leaving
its tests parented to the authorization describe; and the quota fetcher's Claude
and Codex 401 tests kept upstream's read-only tails on Otto's refreshing
implementation. A spliced test file still typechecks whenever the orphaned tail
references names that happen to exist at file scope.

**Assertions that predate a field.** `readPullRequestLookupTargetFromFacts` gained
upstream's `headSha`, and the project descriptor carries Otto's four
per-project locations. Ten and two stale exact-match assertions respectively.
Prefer `toMatchObject` at these boundaries.

### Repo identity, fixed at v0.6.1

Two `checkout-git` cases failed against HEAD's implementation as well as the
merged one, so they predated this merge, and both came from `isSameRepo`:
`parseGitHubRepoFromRemote` returns null for a non-github.com host and is case
sensitive, so two Enterprise remotes differing only in case read as different
repositories, and a fork tracking upstream's base branch reported the tracked
head instead of the local branch.

Repo comparison now goes through a host-agnostic, case-insensitive identity
(`parseRemoteRepoIdentity`), while `parseGitHubRepoFromRemote` keeps its narrower
job of naming the fork owner the forge API expects. Tracking a base branch is no
longer treated as a pull request head - except where the local branch is named
`<owner>/<headRef>`, which is how a PR worktree checks a contributor's branch out
and is the one case where the head really is named after the base.

### Persisting config: still whole-config, deliberately

Upstream writes the _patch_ into `config.json`. Otto writes the resolved config,
and did long before this merge. Two upstream tests encode the narrower contract
and are skipped with that reason.

Converging was attempted during this merge and reverted. Writing only the paths a
patch changed is easy to state and wrong in three places Otto's own tests catch:
a provider removal cancels itself out of the diff, clearing metadata generation
writes a half section, and a launch-provided secret that a client round-trips
through the masking sentinel never reaches disk. Getting it right means teaching
each of the ~15 section builders which keys the patch named, which is its own
change with its own review.

### Adopted at v0.6.1 with a burn-down

Upstream added a `no-restricted-imports` rule banning raw `TextInput` from
`react-native` in favour of `EditingTextInput`, and converted its own surfaces.
Otto has 37 that were never converted. `EditingTextInput` is uncontrolled
(`initialValue`, no `value`), so each one is a control-model conversion rather
than a rename, and doing them blind at the tail of a merge would ship 37 subtle
input bugs.

The rule is adopted; those 37 files are listed in `.oxlintrc.json` as a
burn-down, in the same shape upstream uses for its own. They may only shrink out
of that exemption. Convert them against a running app, a few at a time.

### App-side breakage the v0.6.1 test pass found

Same shape as the server list above: all of it typechecked and linted clean.

**Turn timing never derived.** `deriveStreamTurnTiming`'s new-turn branch kept a
`return` from Otto's older shape after adopting upstream's `startsNewTurn`
boundary check. Upstream falls through, so the item that opened the turn is
still processed and `previousItem` advances; with the `return`, `previousItem`
stayed null and every subsequent item read as another turn start. No completed
turn ever got a duration or a token count.

**Six tab kinds could not be opened.** `normalizeWorkspaceTabTarget` lost its
branches for `files`, `changes_tree`, `pull_request`, `plugin`, `working_diff`,
and `commit_diff`, so every layout silently stripped them - including the
Explorer sidebar's own default tabs. Two compounding causes: the branches were
missing, and `SIMPLE_TAB_ID_BUILDERS` had no entry for the id-less kinds, so
they all collapsed onto one fallback id and deduped each other away. A tab kind
needs a normalize branch, an id builder, and a registered panel; any one missing
is silent.

The `DEFERRED(ottoDiffTab)` note that said Otto had not adopted the diff panels
was stale by the time it was read: this merge brought `panels/diff-panel.tsx`
in and wired it to Otto's own Changes view. Both diff kinds normalize now.

**Keyboard bindings without their definitions.** The four `workspace.tab.target.*`
actions existed in the action union, the dispatcher, and the route table, but
their eight binding entries were gone from `keyboard-shortcuts.ts`, so the
chords did nothing. Otto's `ShortcutHelp` also requires a `keys` array that
upstream's entries do not carry; contextual shortcut discovery renders from it.

**A settings section with no screen, and a screen with no copy.** `layout`
arrived in `SETTINGS_SECTION_SLUGS` without a panel (removed), and the English
`settings.plugins` block was dropped from `en.ts` while every other locale lost
its `plugins: pluginSettings.<locale>` wiring, so the Plugins page rendered raw
key names.

**`theme: {}` in the test setup.** The global `useUnistyles` mock returned an
empty object, so any component grandfathered onto `useUnistyles` crashed on
`theme.colors.*` inside the test rather than failing an assertion. It returns
the real light theme now.

**`openTabFocused` stopped revealing.** It used to reveal-or-create; the merged
version routes through `openTab` with `intent: "new"`, which always creates. Every
"open the X tab" entry point goes through it - artifact, context management, git
log, file history, code references, Visualizer - so asking for any of them twice
stacked a duplicate.

**Preview split-right split a fresh workspace.** `findSplitRightTarget` counts the
focused pane's tabs, and the default layout seeds a New tab placeholder, so the
"nothing to split from" case its own comment describes could never be reached.

**A failed setup could only ever be announced once.** Nothing cleared
`surfacedFailedSetupKeys`, so after the first failure was surfaced for a
workspace, a later one was silently swallowed. A non-failed push now releases the
claim, which is what "until a later setup lifecycle begins" meant.

**Upstream tests asserting upstream's design.** Several theme tests encode
upstream's type scale, neutral light palette, and surface-derived sidebar
states. Otto's scale is a tier larger, its light theme is warm, and its
interactive states ride the one theme-accent ladder. These were rewritten to
Otto's values rather than changed in the theme, and Otto's own pure-black test
(which the merge had replaced) was restored.

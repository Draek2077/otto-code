# Ingesting upstream Paseo changes

Otto is a fork of [Paseo](https://github.com/getpaseo/paseo) with full upstream
history preserved. The `upstream` remote points at the Paseo repo, so upstream
changes are ingested with a normal `git merge` — plus a rebrand pass, because
every upstream change that mentions "paseo" must be translated to Otto naming.

The rebrand is purely rule-based (see `scripts/rebrand-upstream.pl`), which makes
merges mechanical: when in doubt, take upstream's version of a hunk and re-run
the rules on it.

## The naming map

| Upstream                                      | Otto                                                             |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `Paseo` / `paseo` (prose, identifiers)        | `Otto` / `otto`                                                  |
| `@getpaseo/*` npm scope                       | `@otto-code/*`                                                   |
| `getpaseo/paseo` GitHub repo                  | `Draek2077/otto-code`                                            |
| `getpaseo` org                                | `Draek2077`                                                      |
| `paseo.sh` domain                             | `otto-code.me`                                                   |
| `PASEO_*` env vars                            | `OTTO_*`                                                         |
| `sh.paseo` / `.debug` / `.desktop` bundle ids | `ai.ottocode` / `.debug` / `.desktop` (no hyphens — reverse-DNS) |
| `paseo` CLI command                           | `otto`                                                           |
| `~/.paseo` data dir, `paseo.json` config      | `~/.otto`, `otto.json`                                           |
| Default daemon port `6767`                    | `6868`                                                           |

## Merge procedure

```bash
git fetch upstream
node scripts/upstream-status.mjs          # what changed, and does it hit anything we own?
git checkout -b merge/upstream-$(date +%Y-%m) main
git merge v0.2.0                          # merge at a release tag, not at main — see Cadence
```

### 0. Read the drift report first

`scripts/upstream-status.mjs` prints the baseline (`git merge-base HEAD
upstream/main`), how far upstream has moved, which release tags are available to
merge at, and — the part that matters — whether upstream landed work inside a
subsystem Otto has independently rebuilt. Do not start a merge without reading
the **watchlist** section; the ledger below records what previous merges decided
about each of those subsystems so the same argument isn't had twice.

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

### 3. Audit — must be clean before committing

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

- `LICENSE`, `NOTICE`, and the README credits — AGPL attribution.
- `CLAUDE.md`, `docs/upstream-merges.md`, `docs/fork-release-guide.md`, and
  `scripts/rebrand-upstream.pl` — they document the fork relationship and the
  rebrand rules themselves.
- The website landing/footer/sponsor pages — public "built on Paseo" credit
  and the sponsorship page pointing at upstream's author.
- `packages/app/src/styles/theme.ts` — comments recording which themes are
  inherited from upstream.
- `packages/app/src/utils/upstream-base-version.ts` — the single source of the
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

And check that upstream's Hub subsystem didn't ride in on a shared file. Hub is a
**permanent exclusion** (see the standing decision below) but it is threaded
through a dozen files Otto also edits, so it re-offers itself on every merge:

```bash
git grep -nE 'AgentOwnerSchema|daemonExecutionKey|findByDaemonExecution|HubRelationship|DaemonExecutions|hub\.(management|execution)\.' \
  -- ':!docs/upstream-merges.md'
```

Expected output: **nothing**. A hit means a Hub hunk survived — strip the Hub
reference out of that file rather than pulling the subsystem in behind it.

### 4. Bump the upstream base version

Every upstream merge **must** update `UPSTREAM_BASE_VERSION` in
`packages/app/src/utils/upstream-base-version.ts` to the Paseo release this merge
ingests. That constant is the single source of the "Based on Paseo vX.Y.Z" line
shown in Settings → About next to the Otto app version, so users can tell which
upstream fixes are under the hood — a stale value silently misreports the base.

Only the version changes; `UPSTREAM_BASE_NAME` stays `"Paseo"`. Read the number
from the upstream tip you're merging (works during or after the merge):

```bash
git show MERGE_HEAD:package.json | grep -m1 '"version"'      # during the merge
git show upstream/main:package.json | grep -m1 '"version"'   # or from the fetched tip
git describe --tags upstream/main                            # sanity-check the tag
```

This is why the file is on the audit exclusion list in step 3 — it is the one
place the "Paseo" literal is allowed to live. Do not move the name/version into
the display code or i18n strings; the rebrand pass would rewrite them on the next
merge that touches those files.

### 5. Regenerate lockfiles and verify

```bash
npm install --package-lock-only
npm run typecheck
npm run lint
```

Then merge the branch into `main`.

## Script gotchas (learned the hard way)

- **Third-party links stay upstream-named.** Community projects like
  `paseo-relay` and `paseo-vscode` are real external URLs — rebranding them
  breaks the links. Check README/community references after running the script.
- **The `6767` rule can mangle lookalikes.** It once rewrote a test UUID
  containing `-6767-` segments. After a merge, scan for accidental `6868`
  inside UUIDs/hashes: `git grep -nE '6868-6868'`.
- **Bundle ids must stay hyphen-free.** Never let `sh.paseo` map to anything
  containing `otto-code` — reverse-DNS segments cannot contain hyphens.
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
  flags this — a `describe` output ending in `-N-g<sha>` means the tip is
  mid-flight. Unreleased work sits there (upstream's Hub subsystem lived on
  `main` for days in no tag at all).
- **Cherry-pick out-of-band** for security fixes or a bug that's actively biting.
  Record it in the ledger so the next full merge knows it's already in.
- **Don't stretch past two minor releases.** Beyond that, the real risk isn't
  conflict volume — it's upstream independently rebuilding something Otto already
  ships (see the `v0.2.0` forge entry below).
- **Read every minor release's changelog even when you skip the merge.** This is
  the cheap early warning for that rival-abstraction problem, and it's the only
  step here that catches it _before_ the work is wasted.

## What we last took

Git is the authority on **what** we last merged — `git merge-base HEAD
upstream/main`, accurate as long as upstream is always ingested with a real merge
(never a squash or rebase). `scripts/upstream-status.mjs` reads it for you.

The table below is the authority on **why**: what each merge deliberately left
behind, and what still needs deciding. Without it, every merge re-litigates the
same subsystems from scratch.

| Merged     | Upstream tag | Upstream sha | Otto version | Deliberately skipped                                                            |
| ---------- | ------------ | ------------ | ------------ | ------------------------------------------------------------------------------- |
| 2026-07-12 | v0.1.106     | `c05e337cd`  | 0.5.x        | —                                                                               |
| _pending_  | v0.2.0       | _untagged_   | 0.6.5        | Hub (`a414f8ea8`) — **permanent**; upstream's client-side subagent presentation |

### Standing decisions

These carry across merges. Revisit only when the stated trigger fires.

- **Hub (`a414f8ea8`) — permanent exclusion. Never incorporate.**

  A daemon↔cloud control plane whose counterparty is a closed "Paseo Cloud" repo
  this fork has no access to. Untestable and unusable here, and it is not on
  Otto's roadmap in any form — Otto's remote story is the E2E-encrypted relay
  (see [SECURITY.md](../SECURITY.md)), which is self-hosted by design. Nothing
  about Hub is unsafe (enrollment is genuinely opt-in; nothing phones home before
  `hub connect`) — it simply buys this fork nothing, ever. **No revisit trigger.**

  **It is not self-contained, and that is the part to plan for.** The
  `packages/server/src/server/hub/` directory is only half of it. The commit also
  threads a new `owner` concept through agent persistence:
  - `agent/agent-owner.ts` — new `AgentOwnerSchema`, a `discriminatedUnion` with
    one variant (`daemon`) that is plainly built to grow.
  - `agent/agent-storage.ts` — `owner` added to the **persisted agent record**,
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
    directions — we simply never write or read it.
  - The real risk is **compile coupling**: if a later upstream change puts
    non-Hub logic in a file that references Hub types, that hunk cannot be taken
    as-is. Strip the Hub reference rather than pulling the subsystem in behind it.

  Enforce the exclusion in step 3 of the audit rather than trusting merge-time
  vigilance — the grep is in the audit block above.

- **Forge abstraction (`a8ebd390f`) — took theirs, ported ours onto it.**
  Upstream shipped a pluggable forge layer (GitLab, Gitea/Forgejo/Codeberg,
  CLI-delegated auth) covering the same concern as our `git-hosting` layer
  (GitHub + Bitbucket Cloud, stored credentials). Two rival abstractions over one
  concern means hand-merging every future upstream PR that touches PR/issue code,
  so upstream's is now the base and Bitbucket Cloud is a REST-backed adapter
  registered against it. **This is the cautionary tale the cadence rules exist
  for** — upstream built it while we were building ours, and nobody noticed until
  the merge. Hence the watchlist in `upstream-status.mjs`.

- **Provider subagents (`66445adc0` and successors) — split by layer.**
  We take upstream's **daemon-side ingestion verbatim and never edit those
  files** (`ProviderSubagentStore`, the `agent.provider_subagents.*` RPCs, and
  every provider adapter), because that is where their recurring fixes land —
  phantom parents, stuck sessions, hidden Codex subagents. We keep **our client
  presentation** and project their store into Otto's observed-subagent model,
  which carries the per-subagent usage accounting, nesting, and stop control
  their descriptor has no room for. The carried patch is small and deliberate:
  don't register their `provider-subagent-panel`, don't take their `select.ts`
  discriminated union. See `projects/upstream-subagent-convergence/`.

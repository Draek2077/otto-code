---
id: "finding-2026-08-02-leaked-daemon-projects"
kind: "finding"
title: "Why do unrelated E2E specs fail against directories that other specs deleted?"
status: "confirmed"
tags: ["finding", "e2e-shard-cascades"]
created_at: "2026-08-16T22:16:11.481Z"
updated_at: "2026-08-16T22:16:11.481Z"
---

# Why do unrelated E2E specs fail against directories that other specs deleted?

<!-- compiled_truth -->

**Date:** 2026-08-02
**Subject:** CI run 30768976339, `playwright (shard 4/8)` and `playwright (shard 1/8)`
**Question:** The daemon logs `Working directory does not exist: /tmp/<spec-fixture>` against specs
that never created that directory, across several shards. Is it one lifecycle bug or many?

## Answer

One bug, in the E2E specs, not in the daemon: **a spec registers a temp directory as a daemon
project, then deletes the directory without removing the project record.** The shard's daemon is
shared and long-lived, so it keeps serving a project rooted at a path that no longer exists, and
every later spec that boots the app trips over it.

The second-order effect is what makes it expensive. The New Workspace composer preselects the _last
active_ project, which is the leaked one, and then asks the daemon to list that draft's provider
features. `AgentManager.listDraftFeatures` normalizes the config first, `normalizeConfig` stats the
cwd, and the whole read fails hard. The client retries at 1s / 2s / 4s. Every composer-opening spec
for the rest of the shard pays this.

## Method

`gh run view --job <id> --log` for the two shards, then correlating each error's timestamp against
the `✓`/`✘` test lines in the same stream. The `--log` output interleaves the daemon's pino records
with the Playwright list reporter, so the two can be read on one timeline. No local repro was needed
to establish the ordering; the timestamps do it.

## Numbers

Shard 4, all against **one** directory, `/tmp/codex-mode-preferences-target-42wIK9`:

| Failing daemon call                                            | Count | Window              |
| -------------------------------------------------------------- | ----: | ------------------- |
| `AgentManager.listDraftFeatures` → `normalizeConfig` (ENOENT)  |    35 | 22:09:16 → 22:22:22 |
| `listDirectoryEntries` → `resolveScopedPath` (realpath ENOENT) |    36 | same window         |

The directory's owning test - `new-workspace-codex-mode-preferences.spec.ts:162` - ran
22:08:40 → 22:09:16 and deleted the directory in its `finally`. **The errors continue for 13 minutes
after that test finished.** The mkdtemp suffix is the giveaway: all three attempts of that test
(original plus two CI retries) made their own directory, yet retries #1 and #2 both fail against
attempt #1's suffix. The record outlives the test that made it.

The retry shape is visible in the timestamps - 22:14:44.6, 22:14:45.6, 22:14:47.6, 22:14:51.6 - one
cluster of four per composer open, at 1s / 2s / 4s backoff.

Shard 4 test outcomes after the leak lands: 24 of the 32 subsequent attempts fail, concentrated in
`new-workspace-composer-draft`, `new-workspace-entry`, `new-workspace-isolation-memory` and
`new-workspace.spec.ts`. Both shards that carry a leak (1 and 4) were **cancelled on the 35-minute
cap** rather than failed - the retry chains are part of why they overran.

Shard 1 shows the same class at low volume and through different call paths - `prepareSessionConfig`
(2, agent resume) and `generateBareCompletion` (1, the auto-title writer) - against
`stream-first-app-turn-timer-FBlrBm` (6), `assistant-fork-tab-submit-1sPKfo` (2) and
`add-file-to-chat-5g9Grn` (2). Those are the _within-test_ variant: `seedWorkspace`'s cleanup removes
the project correctly, but daemon work started during the test is still in flight when the `rm -rf`
lands. Noise, not a cascade.

## The leak, precisely

`new-workspace-codex-mode-preferences.spec.ts:162` registers a second, workspace-free project with
`addProjectViaDaemon` so the composer has something to create against, drives Create, and then:

```ts
} finally {
  await seeded.cleanup();                 // removes the *seeded* project, correctly
  await newWorkspaceClient.close();
  await targetRepo.cleanup();             // rm -rf - but the project was never removed
}
```

The composer's Create succeeded (only `create_agent_request` is blocked by the spec's
`routeWebSocket`; `workspace.create` is forwarded), so the daemon is left holding **both** a project
and a workspace on a deleted path.

`personality-autosubmit-regression.spec.ts` does the same setup and gets it right: it archives the
created workspace, removes both projects, and only then deletes the directories.

## The wider class

Two separate mistakes produce the same dangling record, and both are common in this tree:

1. **Never removing the project.** `openProjectViaDaemon` registers a project as a side effect. Of
   the specs that call it, `new-workspace.spec.ts` tracks only 2 of its ~14 tests in
   `localProjectIds`; `pr-pane`, `worktree-archive`, `worktree-archive-risk-warning` and
   `new-workspace-isolation-memory` track none.
2. **Deleting the directory first.** Several specs `rm -rf` the repo in the test body's `finally`,
   while the daemon teardown lives in `test.afterEach` - which Playwright runs _after_ the test body.
   Archiving a worktree shells out to git inside the repo, so by then it fails, the `.catch(() =>
undefined)` swallows it, and the workspace record survives permanently.
   `new-workspace-isolation-memory.spec.ts` and most of `new-workspace.spec.ts` are in this shape.
   The ENOENT on `WorkspaceGitServiceImpl.startWorkspaceWatchers` watching
   `/tmp/workspace-nav-same-project-PDy1nZ/.git/refs/heads` is this variant.

The invariant either way: **remove every daemon record first, delete the directory last.**

### The id that makes a removal silently do nothing

A third variant hides inside the second. `removeProject` takes the **host-local `projectId`**; the
composer's picker renders the **cross-host `projectKey`**. They are different opaque `prj_*` strings,
so passing the wrong one is not a type error - it is a no-op that the surrounding
`.catch(() => undefined)` swallows, and the project stays.

- `addProjectViaDaemon` returned `project.add`'s `projectId` **under the name `projectKey`**. Both
  its callers then used that value for `selectNewWorkspaceProject`, whose locator is
  `new-workspace-project-picker-option-${project.projectKey}` - so the option could never match and
  the spec waited out its 30s. This is why
  `new-workspace-codex-mode-preferences.spec.ts:162` fails on every attempt in CI, and it is a
  _separate_ failure from the leak, not a consequence of it.
- `new-workspace-codex-mode-preferences.spec.ts`'s second test passed `seeded.projectId` into the
  same `projectKey` parameter, for the same 30s timeout.
- `personality-autosubmit-regression.spec.ts` and both `worktree-restore*` specs collected
  `projectKey` into the set they later feed to `removeProject`, so their teardowns removed nothing.

Same root shape as `9385328a2`, which fixed it for workspaces; the E2E helpers were not swept.

## Ruled out

- **The dangling records are not explained by `9385328a2`.** That commit landed before this run and
  the dead-path errors reproduce regardless. The id confusion is a _sibling_ of it in the E2E helpers
  (see the section above) and explains why the owning specs both fail on their own and fail to clean
  up - but it is not what keeps the daemon serving a deleted directory.
- **Not agent creation.** The error message reads like a spawn, but the stack is
  `handleListProviderFeaturesRequest → listDraftFeatures → normalizeConfig`: a read-only draft
  feature listing, not `createAgent`.
- **Not `multi-root-edit-gate.spec.ts:152`.** It is listed alongside these, but it failed as shard 4's
  _second_ test, before any leak existed - the first `Working directory does not exist` in that shard
  is timestamped 3 minutes later. That suite uses `beforeAll`/`afterAll` with correct ordering. It is
  an independent failure and still needs its own diagnosis.
- **Not a cross-test race from `workers: 1`.** Cleanup is not landing late; it is not happening at
  all. The 13-minute survival rules out a scheduling window.

## Still open: the daemon's half

A draft feature listing wants the provider's manifest. It does not need the working directory to
exist, but it inherits `normalizeConfig`'s `stat` and fails hard - and `listDraftCommands` has the
same shape. A user whose project folder sits on an unmounted drive gets an erroring, self-retrying
New Workspace composer for the same reason a deleted E2E fixture does. Hardening that is a product
decision (does the composer surface "this directory is gone" instead?) and is not part of the
lifecycle fix recorded here.

## Timeline

- time: "2026-08-16T22:16:11.481Z"
  kind: "migration"
  summary: "Migrated from the legacy findings report without discarding its evidence."
  source: "findings/e2e-shard-cascades/2026-08-02-leaked-daemon-projects.md"

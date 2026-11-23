# Workspace Git

Otto extends Paseo's existing `WorkspaceGitServiceImpl` with host fetch policy
and an explicit Fetch action. It does not own a second Git service, watcher,
poller, credential system, or metadata cache.

Host Settings > Workspaces contains **Automatic Git fetch** and **Fetch interval**.
The default is enabled every three minutes, matching Paseo. Available intervals
are 1, 3, 5, 10, 15, 30 and 60 minutes. Save is explicit; a settings change re-arms
the existing repository timer without starting a fetch. Queued callbacks recheck
the current policy and active workspace ownership at final repository admission.
An explicit Fetch can claim pending automatic work after opt-out; a skipped
automatic admission never serves as a successful manual acknowledgement.

**Fetch** appears in the existing workspace Git actions and Command Center for a
Git workspace with an `origin` remote. It remains available when automatic fetch
is off. Compact workspaces use the existing Changes toolbar's Git menu; the
desktop workspace header and Command Center retain their normal placements.
It runs Paseo's `git fetch origin --prune`, shares any in-flight fetch for
the same canonical common Git directory, and refreshes the canonical Git snapshot
without requesting forge status. Linked worktrees share the operation. The Git
command retains its existing two-minute bound; only the explicit plugin RPC has a
130-second acknowledgement budget. Failures remain visible in the menu until a
new explicit attempt. No automatic retry is introduced.
Successful Fetch remains immediately repeatable and uses the existing success
toast; it does not retain the shared menu's disabling terminal-success state or
add a reset timer.

## Storage and compatibility

The host reads `<OTTO_HOME>/workspace-git/settings.json`. Until the first explicit
save, it also accepts preserved Otto 0.9 `daemon.gitFetch` settings in
`otto-config.json`. A saved opt-out takes effect before workspace observations
start. No read writes settings. An unreadable inherited policy disables automatic
fetch and reports the problem rather than silently enabling it; manual Fetch is
still an explicit action.

Saves compare a SHA-256 revision, preserve unknown owned fields, and use the host's
private atomic-file writer. Legacy files are never rewritten. Invalid, future,
oversized and non-regular settings are refused rather than reset. Conflicts or
unknown save outcomes retain the local draft and require explicit Reload. Hidden
write replies cannot adopt a new revision. The form has no autosave or polling.

`server_info.features.ottoGitFetch` is the single feature gate. Older hosts show
an update message; no legacy RPC fan-out emulates the new capability. The
`otto-workspace-git` host contribution resolves a workspace ID through its own
registry, refuses archived or unknown workspaces, and never accepts a client
filesystem path. Its reserved RPC identity shares the built-in install protection
and allowlist, but is not in the plugin loader's startup list and loads no worker.
RPC declarations live in `@getpaseo/plugin/otto/workspace-git`;
implementation lives in each package's `otto/workspace-git` directory. Marked
seams in Paseo composition, Git actions and Host Workspaces settings only bind
those owners. Chat, session, provider, transcript and memory paths are unchanged.

## Parent branch comparisons

Changes > **Committed** shows a **vs** picker beside the comparison mode. **Parent branch**
offers local branches, separate `origin/` branches, and **Repository default**. A local
and remote branch can point to different commits, so an explicit choice keeps its exact
ref. The existing diff engine compares from the merge base; a child's Changes view then
excludes work already on the selected parent.

The choice is stored per working branch in the checkout's Git directory at
`otto/diff-base.json`, using Otto 0.9's existing record format. Ordinary checkouts share
a Git directory across branch switches; linked worktrees have separate Git directories.
The picker changes no checked-out branch, index, commit, or worktree identity metadata.
The existing Git service reads the selected base for its snapshots, diffs, commit list
and base-targeted actions, and refreshes its existing subscriptions after a save.
An explicit selection forces a structural snapshot and queues behind an in-flight
refresh before acknowledging success. The ordinary refresh throttle must not leave
the previous comparison visible after a saved choice.

Branch suggestions load when the picker opens. A failed save leaves the picker open
with the error and available choices; it does not replace the current comparison.
`server_info.features.ottoGitDiffBase` gates editing. Hosts without that capability
retain the comparison label and require an update to change it. The host resolves
workspace ownership and checks that the working branch still matches the opened picker
before saving.

## Verification

Feature tests cover legacy preservation, revision conflicts, disabled callbacks,
single-flight work, local draft lifetime and explicit recovery. An isolated real
Git/file-origin test proves linked-worktree coalescing and canonical ref refresh.
`app/e2e/browser/otto-workspace-git.spec.ts` runs real settings and Fetch success,
conflict and failure journeys in wide and compact browsers in CI. It uses a
disposable host and no external Git credentials. Employer-specific remotes and
device-native controls remain environment acceptance checks.

`server/src/server/otto/workspace-git/comparison-base.test.ts` verifies real stacked
branches, branch-scoped persistence, linked worktrees, exact remote refs and stale or
invalid choices, rapid reselection and writes during an in-flight read.
`app/e2e/browser/otto-comparison-base.spec.ts` covers the real sidebar
picker, changed file list, reload persistence, a deleted-branch failure and recovery on
wide and compact browsers.

## Move a chat or reopen a worktree

**Move chat to workspace** in the chat tab menu lists active workspaces on the same host. The
host changes the owning workspace and publishes both workspace updates. The chat keeps its ID,
working directory, provider session and transcript. An Architecture draft binding is released
before moving its authoring chat. The MCP tool `move_chat_to_workspace` uses the same operation.

**Reopen worktree** in the project menu shows archived worktree records that still have a usable
directory or branch, and Otto-managed Git worktrees without a registered workspace. Reopening an
archived worktree uses Paseo's recovery path and preserves its workspace ID. Adopting an existing
directory uses the selected project's placement and does not rerun workspace setup.

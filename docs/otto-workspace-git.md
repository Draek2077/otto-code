# Workspace Git fetch

Otto extends Paseo's existing `WorkspaceGitServiceImpl` with host fetch policy
and an explicit Fetch action. It does not own a second Git service, watcher,
poller, credential system, or metadata cache.

Host Settings > Workspaces contains **Automatic Git fetch** and **Fetch interval**.
The default is enabled every three minutes, matching Paseo. Available intervals
are 1, 3, 5, 10, 15, 30 and 60 minutes. Save is explicit; a settings change re-arms
the existing repository timer without starting a fetch. Queued callbacks recheck
the current policy and active workspace ownership before entering Git.

**Fetch** appears in the existing workspace Git actions and Command Center for a
Git workspace with an `origin` remote. It remains available when automatic fetch
is off. It runs Paseo's `git fetch origin --prune`, shares any in-flight fetch for
the same canonical common Git directory, and refreshes the canonical Git snapshot
without requesting forge status. Linked worktrees share the operation. The Git
command retains its existing two-minute bound; only the explicit plugin RPC has a
130-second acknowledgement budget. Failures remain visible in the menu until a
new explicit attempt. No automatic retry is introduced.

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
filesystem path. RPC declarations live in `@getpaseo/plugin/otto/workspace-git`;
implementation lives in each package's `otto/workspace-git` directory. Marked
seams in Paseo composition, Git actions and Host Workspaces settings only bind
those owners. Chat, session, provider, transcript and memory paths are unchanged.

## Verification

Feature tests cover legacy preservation, revision conflicts, disabled callbacks,
single-flight work, local draft lifetime and explicit recovery. An isolated real
Git/file-origin test proves linked-worktree coalescing and canonical ref refresh.
`app/e2e/browser/otto-workspace-git.spec.ts` runs real settings and Fetch success,
conflict and failure journeys in wide and compact browsers in CI. It uses a
disposable host and no external Git credentials. Employer-specific remotes and
device-native controls remain environment acceptance checks.

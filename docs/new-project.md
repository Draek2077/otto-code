# New project

Adding a project used to mean naming a folder that already existed. The **New project** page replaces that: it can create the folder, give it a git repository (fresh or cloned), create the remote on a connected hosting provider, and register the result — so nothing has to be set up outside Otto first.

The page is at `/new-project` (`packages/app/src/app/new-project.tsx` → `screens/new-project-screen.tsx`) and is modelled on the New workspace page: a full screen, not a dialog.

## One RPC, not a client-driven sequence

`project.scaffold.request` does the whole thing in the daemon. This is the load-bearing decision: a client-driven mkdir → init → create-remote → push → register sequence leaves a half-built directory behind the moment the socket drops between two steps. The daemon owns the transaction, reports each step, and **never registers a project whose scaffold failed**.

Steps, in run order, per path:

| `git.kind` | Steps                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `none`     | `create_directory` → `register_project`                                                                                    |
| `init`     | `create_directory` → `git_init` → [`starter_files`] → [`initial_commit`] → [`create_remote` → `push`] → `register_project` |
| `clone`    | `git_clone` → `register_project`                                                                                           |

Two rules that are easy to get wrong and are enforced in `buildProjectScaffoldStepPlan`:

- **Clone creates its own directory.** Pre-creating it would make `git clone` refuse. Every other path creates it first.
- **Asking for a remote implies the first commit**, even when `initialCommit` was not set — a push needs something to push. The plan and the service agree on this so the step list the UI renders up front matches what runs.

`register_project` is listed in the plan but the service cannot run it (it owns no registry). The service reports it `skipped`; the session replaces that entry with `done` after `findOrCreateProjectForDirectory` succeeds — the same call `project.add` makes.

## Where it lands afterwards

On success the page routes to **New workspace with the project preselected** (`buildNewWorkspaceRoute` with `projectId`, `dir`, `name`). A freshly scaffolded project has no workspace yet, so routing to a workspace route lands on "Workspace not found" with only a Back button — a dead end at the exact moment the user has just created something. Creating a workspace is the next thing they came to do, so hand off to that page rather than inventing a project landing screen.

The open-an-existing-folder path instead goes `router.back()` (falling back to `/` when there is no history, e.g. a deep link), since that flow adopted a project the user already knew about.

Progress arrives as `project.scaffold.progress`, keyed by `requestId` and routed to that one request's listener in `DaemonClient` rather than the global `DaemonEvent` stream every consumer would then ignore. It is **advisory**: the response payload carries the authoritative `steps`, so a client that drops every progress message still gets a correct result.

**The UI shows one status line, not a step log.** The page renders a spinner plus the currently-running step ("Creating the remote repository…") and nothing else. The sequence is build detail the user did not ask to watch; a checklist ticking itself off in the middle of a form reads as debug output. The full `steps` array still comes back on the response and is what a failure is explained from — don't promote it back into the happy path.

## Failure carries the partial outcome

A scaffold that fails at step 5 has already created real things. `ProjectScaffoldError` carries the partial `ProjectScaffoldOutcome` (via `getScaffoldOutcome`), so the response reports `path` (what is on disk) and the per-step statuses alongside the error. "Local repo created, remote creation failed" is a legible answer; "failed" is not.

Error codes are the branch points the client needs, not a transcript: `parent_not_found`, `invalid_name`, `already_exists`, `git_unavailable`, `git_failed`, `provider_unavailable`, `remote_failed`, `clone_failed`, `register_failed`.

## Folder names are validated for the strictest platform

`validateProjectFolderName` rejects path separators, `.`/`..`, Windows-reserved punctuation and device names (`con`, `lpt1`, …), control characters, and trailing dots/spaces — on every host, not just Windows. A project created on Linux is routinely opened from a Windows client, so producing a name that breaks on sync is worse than refusing it. Spaces and hyphens are legal and stay allowed.

The `already_exists` check runs before any path, so a taken name is one code the client can phrase, rather than a raw `EEXIST` from `mkdir` on one path and a git error on another.

## Adding a folder that is already a project is refused client-side

`project.add` is find-or-create: pointing it at a directory that already backs a project **succeeds and returns the existing record**. That is right for the RPC and wrong for this page — it would close as though it had done something. `findDuplicateProjectPath` compares the resolved target path (so it covers create and clone targets too, not just the open path) against the host's project list and blocks submit with a red error naming the path that is already taken. Same instinct as New workspace refusing an occupied directory.

It is rendered as an **error**, not as one of the muted `blockers` hints: a blocker means "you haven't filled this in yet", and this is a genuine conflict.

## Remote creation

The three host-level provider methods (`listRepositories`, `listOwners`, `createRepository`) are described in [docs/git-providers.md](git-providers.md) — they address an account, not a checkout, so they take no cwd.

- **GitHub** infers the owner from the authenticated identity; an explicit owner is treated as an org (`/orgs/{owner}/repos`) with a fallback retry on `/user/repos`, because a personal-account owner would otherwise 404.
- **Bitbucket Cloud** has no implicit namespace — the workspace is part of the REST path — so it is the one provider that **requires** an owner up front. The client encodes this as `PROVIDERS_REQUIRING_OWNER` and blocks Create until one is chosen. Bitbucket also derives a repo's URL from its slug, so `toBitbucketRepositorySlug` mirrors its normalization (`My New App` → `my-new-app`) instead of letting the API reject the name.

A provider the user has not signed into is **hidden**, not offered and then failed: the page checks `hosting.auth_status` per provider and only lists the connected ones. With none connected, the "new repository and remote" choice does not render at all.

## Layout: this page follows New workspace, not the settings form kit

The page is **the New workspace page's twin**, and should stay that way:

- `ScreenHeader` + `SidebarMenuToggle`, vertically centred column on desktop, bottom-aligned on compact (`getContentStyle`), `MAX_CONTENT_WIDTH` from `@/constants/layout`.
- The title uses the same size/weight and the same `paddingLeft: spacing[6]` as New workspace's, so both pages' headings sit on the same optical line.
- **Everything selectable is a pill** above the input (`new-project-picker-row.tsx`) — mode, host, git setup, .gitignore, provider, repository, owner, visibility — mirroring New workspace's project / host / isolation / base row. Pills that cannot apply to the current mode are **hidden, never disabled**.
- **One row, except for create + remote.** That mode alone adds four pills on top of mode/host/git-setup/.gitignore, which wraps mid-group and reads as noise, so it gets a second row. Clone adds only two (provider, repository) to a row holding at most mode and host — that fits, so it stays inline. Don't "tidy" this into an unconditional two-row split.
- The folder path is the one prominent input, the way the composer is on New workspace. Only free text lands below it (`new-project-detail-fields.tsx`).
- The action is a normal `size="sm"` button pinned to the trailing edge, not a full-width bar — this column is a form, not a dialog footer.

This is a deliberate departure from [docs/forms.md](forms.md): the form kit's labelled `Field`/`SelectField` rows produce a settings-page look, and this is a landing page. If you are adding a control here, add a pill — do not reintroduce stacked form rows.

## Client shape

- `new-project-form.ts` is the pure form model — mode, git setup, blockers, and the translation into the wire request. Every rule is tested there; the screen renders and dispatches.
- `getNewProjectBlocker` returns _which_ field is missing, so the page states the reason next to a disabled Create rather than leaving the user to guess.
- `use-new-project-hosting.ts` owns the three async provider reads.
- Reads go through `useFetchQuery` from `@/data/query`, not raw `useQuery` — see [docs/coding-standards.md](coding-standards.md).
- **The route is registered in two places** (`RootStack` and `shouldShowAppChrome`). Missing the second one is what left the first cut of this page with no sidebar and no way out — see [docs/expo-router.md](expo-router.md).

## What replaced what

The old `ProjectPickerModal` + `project-picker-store` are **gone**. Every "New project" entry point — home tile, sidebar button, command center, keyboard shortcut — funnels through `useOpenProjectPicker`, which now routes to `/new-project` after the host chooser resolves (a single host auto-resolves). The directory search itself survives: same `directory_suggestions_request` RPC, rendered inline as a form field instead of a floating list.

One behavior change worth knowing: **Browse no longer submits.** In the modal, picking a folder in the desktop dialog opened the project immediately. On a form page with several fields, Browse fills the directory field and stops; submitting is the explicit action. `e2e/project-picker-desktop.spec.ts` pins this.

## Capability gate

`server_info.features.projectScaffold` — `COMPAT(projectScaffold)`, added in v0.6.9. Without it the page offers the open-an-existing-folder path only and reports "Update the host to create projects" for the rest. No fallback path: an old daemon does not get an emulated scaffold.

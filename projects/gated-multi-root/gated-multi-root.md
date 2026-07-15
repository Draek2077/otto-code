# Gated multi-root file editing (project links)

**Status:** Phases 0, 1, 2, 4 shipped and green (typecheck/lint/tests). Phase 3
(authoritative daemon link enforcement) deferred as defense-in-depth.

**Superseded by "preview any file, edit-gated" (v0.5.8) — see the section at the
bottom.** The original model _blocked_ opening an unlinked project's file. That
was replaced: **any file previews** (including files outside every project, e.g.
an agent's plan in `~/.claude`), and the gate moved from _open_ to _edit_. The
side-pane opener (`handleOpenFileFromChatInSidePane`) is now gated too, closing
the gap noted here originally.

## The problem

Otto scopes file access to the active workspace. But agents routinely work across
projects — especially "Epic Projects" split into several repos. You need to open and
edit a file that lives in **another project**, without turning Otto into an arbitrary
filesystem browser and without silently editing files that won't be part of the current
project's commit.

## The product decision (locked)

Cross-project file access is **gated multi-root, in place** — not a picker, not a
filesystem browser.

1. **In place, no picker.** The file explorer, project search, and Changes tab only ever
   show **this** project's files. There is no cross-workspace picker. The only new
   capability is **viewing/editing** a file that belongs to another project. Otherwise the
   UI has no idea other projects exist.

2. **The trigger is an out-of-project file reference** — e.g. clicking a file path in a
   conversation that resolves to a file inside another project's workspace. When that
   happens, the file opens **in place** as a tab in the current workspace's screen
   (multi-root open), edited side-by-side with this project's files.

3. **Gated by bidirectional project links ("permissions").**
   - Projects can be **linked** to each other in project settings. A link is a
     permission: "these two projects may open each other's files."
   - **Links are bidirectional and single-sided to author.** Linking A→B also links B→A;
     you do not edit both projects. Unlink from either side removes it.
   - **Opening an out-of-project file is allowed only if the two projects are linked.**
     Same project (including its other worktrees) is always allowed. A linked project is
     allowed. An **unlinked** project's file open **fails with an error** — this is the
     guardrail that stops you from accidentally editing another project's files whose
     changes won't land in this commit.
   - **Cascade:** if a project is deleted **or archived**, its links disappear.

4. **Warning on first cross-project open.** When you open a file from a _linked_ project,
   show a warning dialog: "You're opening a file from another project (‹name›)." with a
   **"Don't show this again"** checkbox that suppresses it going forward.

5. **Out-of-project toolbar indicator.** While viewing an out-of-project file, the file
   toolbar shows a **centered** badge — "Out of project" (or similar) — naming the owning
   project, so it is always obvious the file won't be part of this project's commit.

## Architecture

The gate lives in two layers:

- **Client (UX gate):** knows the current project context, the target file's project, and
  the link graph. Enforces same-project → open; linked → open (+ optional warning);
  unlinked → error, and never sends the RPC.
- **Daemon (security backstop):** bounds _all_ file RPCs to **known Otto workspace roots**
  so the daemon never serves arbitrary filesystem paths regardless of client behavior. A
  later increment can tighten this to authoritative link enforcement (see Phase 3).

Everything downstream of the file-tab **target** is already workspace-aware — the panel
resolves its own `cwd` from `(serverId, workspaceId)`, the editor buffer is keyed
`(serverId, workspaceId, path)`, and every daemon client file method already takes a
`cwd`. The one non-workspace-aware link is the **file-tab target itself**
(`WorkspaceFileTabTarget = { kind:"file", path, lineStart?, lineEnd? }`,
`packages/app/src/workspace/file-open/index.ts`) and its persistence key
`` `${serverId}:${workspaceId}` `` (`packages/app/src/stores/workspace-tabs-store/state.ts`).
Multi-root open in place means giving the tab target a workspace discriminator so a tab in
project A's screen can point at a file in project B's workspace.

## Phases

### Phase 0 — Daemon known-workspace boundary — **SHIPPED**

The daemon file RPCs previously trusted whatever `cwd` the client sent (only
path-containment _within_ that cwd was enforced). They now require the `cwd` to be one of
the distinct **known workspace/project roots** (or a descendant). This is the security
floor the whole feature stands on, and it already permits opening files from _any_ known
workspace at the daemon layer — the project-link gate is layered on top in the client.

- `packages/server/src/server/session/files/workspace-files-session.ts` — new
  `resolveAllowedRoots` option + `assertCwdWithinKnownWorkspace` guard called by every
  file RPC handler (explorer/read, write, search, replace, code list/symbols/outline,
  watch subscribe, download token, project icon). Rejects with "Access outside of known
  workspaces is not allowed". WSL/Windows path forms folded via `isSameOrDescendantPath`.
- `packages/server/src/server/session.ts` — resolver built from
  `workspaceRegistry.list()` cwds + `projectRegistry.list()` rootPaths, evaluated per
  request so newly created/removed workspaces are reflected immediately.
- Tests in `workspace-files-session.test.ts` (36 passing): opens from any known workspace
  and from a nested cwd inside one; rejects a stranger cwd on read, write, and watch.

Note: the client can only ever send `workspaceDirectory` values, which the daemon sets
directly from `workspace.cwd` (`session.ts:4389/4470`), so the boundary never rejects a
legitimate request.

### Phase 1 — Project links data model + RPCs — **SHIPPED**

Implemented as described below. `packages/server/src/server/project-links.ts`
(`FileBackedProjectLinkStore`: canonical-ordered pairs in `project-links.json`, idempotent
link, symmetric `areLinked`/`listLinkedProjectIds`, `removeAllForProject` cascade;
`createNoopProjectLinkStore` for tests). RPCs `project.links.list/set/unset` + pushed
`project.links.changed`, wired through `session.ts` (handlers + `buildLiveProjectLinks`
liveness filter + cascade in `handleProjectRemoveRequest`), `bootstrap.ts`, and
`websocket-server.ts`. `features.projectLinks` (COMPAT v0.5.6). 7 store unit tests.

Original plan:

- **Storage.** A dedicated symmetric link set (canonical sorted `{projectAId, projectBId}`
  pairs) is cleaner for bidirectionality + cascade than mirroring an array onto two project
  records. Candidate: `project-links.json` via the atomic-write pattern, or a
  `FileBackedRegistry`-style store keyed by a canonical link id. Reads filter out any pair
  referencing an archived/removed project.
- **Cascade.** Hook the existing project archive/delete paths (`session.ts` project
  registry `archive`/`remove` sites) to drop every link referencing that project.
- **RPCs** (dotted namespaces per `rpc-namespacing.md`): `project.links.set.request` /
  `.response` (link), `project.links.unset.request` / `.response` (unlink), and links
  surfaced on the projects/workspaces projection (or a `project.links.list` query). Gate
  behind `features.projectLinks` (`server_info.features.*`) with a `COMPAT(projectLinks)`
  tag.
- Tests: link is symmetric, dedup on canonical order, cascade on archive and on delete.

### Phase 2 — Client multi-root open flow — **SHIPPED**

Implemented: link cache `packages/app/src/projects/project-links.ts` (`useProjectLinkSet`
via `useReplicaQuery` + `project.links.changed` push); pure path→owner resolver
`resolve-workspace-for-path.ts` and gate `cross-project-open.ts` (9 unit tests); the
`useCrossProjectFileOpenGate` hook (warning dialog with suppressible "Don't show again" via
`editor-prefs-store`, blocked-open toast); tab-target `origin` discriminator threaded
through `file-open/index.ts` (`workspaceFileTabTargetsEqual`), `workspace-tabs/identity.ts`
(origin-namespaced id), and `panels/file-panel.tsx` (origin-scoped cwd/workspaceId/buffer);
centered "Out of project" banner in `file-tab-pane.tsx`; gate wired into
`workspace-screen.tsx` `handleOpenFileFromChat`. Daemon RPCs used unchanged (origin cwd).
Full i18n (all 8 locales translated). **Remaining:** gate the side-pane opener too.

Original plan:

- **Resolve a file reference to its owning workspace/project.** Given an absolute path
  from a chat file link, find which known workspace root contains it (reuse the same
  containment logic). Derive its project.
- **Gate.** Same project → open normally. Linked project → open in place as an
  out-of-project tab. Unlinked → error toast ("This file belongs to ‹project›, which isn't
  linked to ‹current project›. Link them in project settings to open it.").
- **In-place tab target.** Add an optional workspace discriminator (target workspaceId +
  cwd) to `WorkspaceFileTabTarget`; thread it through tab identity/equality
  (`workspace-tabs/identity.ts`, `file-open/index.ts`) and `FilePanel` cwd resolution
  (`panels/file-panel.tsx`) so a tab hosted in project A's screen can render project B's
  file. Editor buffer keying is already `(serverId, workspaceId, path)` — reuse it.
- **Warning dialog** with "Don't show again" (device-local suppress flag).
- **Out-of-project toolbar badge** — centered in the file view-mode bar
  (`file-view-mode-bar.tsx` / `file-tab-pane.tsx`), naming the owning project.
- **Read [docs/expo-router.md](../../docs/expo-router.md) before touching open/routing.**

### Phase 3 — Authoritative daemon link enforcement (defense in depth)

Add an optional origin context (`originWorkspaceId` or `originCwd`) to the file RPC
requests (additive, back-compat). When present, the daemon enforces: target project ==
origin project, or the two are linked; else reject. Old clients omit it and fall back to
the Phase 0 known-workspace floor. This makes the gate authoritative rather than
client-only.

### Phase 4 — Project settings link management UI — **SHIPPED**

`ProjectLinksSection` in `packages/app/src/screens/project-settings-screen.tsx`: a "Linked
projects" SettingsGroup listing every other project on the selected host (from the session
store's workspace descriptors), each with a Switch that links/unlinks via
`client.linkProjects`/`unlinkProjects` and invalidates the links query. Hidden when the
host lacks `features.projectLinks`. Shown regardless of developer mode.

## Open questions

- **Same-host only?** Links across different hosts (serverIds) are out of scope for v1 —
  a file reference resolves within one host's workspaces.
- **Worktrees of the same project** are implicitly "linked" (same project) — confirmed
  always allowed, no link needed.
- **Unarchive** does not restore links (they "disappeared" on archive, per the locked
  decision). Revisit only if it feels wrong in practice.
- Phase 3 origin-context shape (`originWorkspaceId` vs `originCwd`) — decide when building
  Phase 3; `originWorkspaceId` is more robust than a raw path.

## Preview any file, edit-gated (v0.5.8)

The "unlinked → blocked with a toast" rule was a dead end — and it also broke the
common case of an agent dropping a **plan/scratch file outside every project**
(e.g. `~/.claude/plans/*`), which the Phase 0 daemon boundary refused to even read.
Reworked so **any file can be previewed** and **only editing is gated**:

- **Daemon (`workspace-files-session.ts`).** Single-file **read** (`mode:"file"`),
  **write**, and **watch-subscribe** no longer enforce `assertCwdWithinKnownWorkspace`
  — OS filesystem permissions are the boundary (the daemon runs as the user; a write
  they lack permission for fails with the OS error, which is intended). Directory
  **list**, project search/replace, code-index, project icon, and download tokens stay
  workspace-bounded (no "browse any folder"). New capability flag
  `features.fileOutsideWorkspace` (`COMPAT(fileOutsideWorkspace)`, v0.5.8) so a newer
  client detects a daemon that serves out-of-workspace single-file ops.

- **Open never blocks (`cross-project-open.ts`, `use-cross-project-file-open.ts`).**
  `resolveCrossProjectFileOpen` returns `in-project` or `out-of-project` (never
  `blocked`). A file in another project gets that project's real origin; a file
  **outside every project** gets a **synthesized origin** rooted at the file's own
  directory (`cwd = dirname`, `path = basename`, synthetic path-derived
  `workspaceId`/`projectId`, `outsideAnyProject: true`) — gated behind the capability
  flag. The opener is now synchronous (no dialog); the side-pane opener is gated too.

- **Edit gate (`resolveEditGate`, applied reactively in `file-panel.tsx`;
  enforced in `file-tab-pane.tsx`).** Computed against the **live** link set, so
  linking/unlinking updates an open tab:
  - **free** — in the current project or a linked project. Edits with no warning.
  - **other-project** — another, _unlinked_ project. Editing warns; the warning is
    **globally suppressible** (reuses `suppressOutOfProjectWarning`).
  - **outside-project** — no project at all. Editing warns **every time, no
    suppression** ("for now", pending feedback).

  Out-of-project files **default to preview**; the mode bar's Editor/Split are
  intercepted by an "Edit anyway?" dialog. Accepting sets a **per-tab override that
  lasts until the tab closes** (reopening warns again). The centered out-of-project
  banner shows for both non-free tiers (`badgeNoProject` for project-less files).

- **Watermark polish.** The terse "Binary preview unavailable" became friendlier
  copy plus a one-line hint (`panels.file.binaryPreviewHint`).

Linking is now purely an **intent signal** that removes the edit warning; nothing is
ever blocked. Non-English locales fully translated. Tests: daemon boundary
(`workspace-files-session.test.ts` — single-file read/write/watch now serve
out-of-workspace, list still bounded), `cross-project-open.test.ts`
(`resolveCrossProjectFileOpen` + `resolveEditGate`).

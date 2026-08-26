---
id: "configurable-project-knowledge-store-location"
kind: "project"
title: "Configurable project-knowledge store location"
status: "proposed"
tags: ["project-knowledge","settings","storage","daemon"]
delivery_status: "partial"
progress_completed: 5
progress_total: 6
progress_unit: "slices"
created_at: "2026-08-26T02:07:58.645Z"
updated_at: "2026-08-26T02:45:03.968Z"
---
# Configurable project-knowledge store location

<!-- compiled_truth -->

## Goal

Let each project choose where its Otto Knowledge store lives: inside the repository at `.otto/`, or host-local under `$OTTO_HOME`. A host-local project leaves no Otto files in the working tree, so a repo never has to gitignore anything to use Knowledge.

A global daemon setting picks the default for new projects; a per-project override wins over it.

## Store layout

Host-local stores mirror the repository layout exactly, so path code is a base swap and nothing else:

```
$OTTO_HOME/project-knowledge/<slug>-<8 hex>/
    project.json          marker: projectId, projectKey, rootPath
    KNOWLEDGE.md
    knowledge/{index.md, decisions/, findings/, projects/, references/, ...}
```

The directory name is `<slug of display name>-<first 8 hex of sha256(projectKey ?? normalized rootPath)>`, legible in a file browser and collision-free.

## Invariants

1. **The directory name is resolved once and persisted** on the project record as `knowledgeDirectoryName`. It is never re-derived. `project-key.ts` carries a standing warning that re-deriving a project key duplicates the project; the same hazard applies here.
2. **Effective location resolves in a fixed order**: project override, then an existing store detected on disk, then the global default. A repository store that already exists always wins over a host-local global default, so a teammate's committed `.otto/knowledge` keeps working and changing the global default never appears to erase anyone's knowledge.
3. **Switching location never moves files silently.** The user is asked, and may leave the old store in place.
4. **The whole `.otto/` payload moves**, KNOWLEDGE.md included. The trade is accepted: a host-local project's Knowledge policy stops being shared or reviewable in a pull request.
5. **Worktrees share one store**, unchanged from today, because root resolution already collapses to the main repo root.
6. **The marker file is the reconcile anchor.** A store whose `project.json` rootPath no longer matches is reconciled rather than orphaned.

## Slices

1. **Store resolver (server).** `ProjectKnowledgeStoreResolver` mapping a project root to a base directory; `knowledgeLocation` and `knowledgeDirectoryName` on `PersistedProjectRecord`; the `project-knowledge/` tree under `OTTO_HOME`; the marker file. `ProjectKnowledgeService` takes `resolveStore` in place of `resolveProjectRoot`.
2. **Protocol.** Global default on `MutableDaemonConfig`; the `project.knowledge.location.set` request/response pair; `absolutePath` and `storeLocation` on the record schema; a `server_info.features` capability gate. All additive and COMPAT-tagged.
3. **Migration (server).** Move-with-confirmation between locations, and the reconcile path for a moved repository.
4. **UI (app).** A global row in Settings; a per-project row in Project Settings beside the Kanban section; the Knowledge panel preferring `absolutePath` so host-local pages open through the `outsideAnyProject` path.
5. **Prose sweep.** The injected catalog brief's `.otto/KNOWLEDGE.md` line; the link rewriter's `.otto/knowledge/findings` prefix; generated KNOWLEDGE.md boilerplate; the three `otto-*-project-knowledge` skills; AGENTS.md; and the architecture page that currently asserts repository ownership.

## Acceptance criteria

- A project set to host-local storage has no `.otto/` directory in its working tree, and all Knowledge RPCs, MCP tools, and the Knowledge panel behave identically to a repository-backed project.
- Opening a page from a host-local store opens the real file in the editor.
- Flipping the global default leaves every existing repository-backed project untouched.
- Otto worktrees of a host-local project read and write the same store as the main checkout.
- Old clients keep parsing every changed message, and a client without the capability shows the "update the host" affordance rather than a degraded picker.

## Out of scope

- Syncing or sharing a host-local store between machines.
- Any change to the Markdown page format or the atomic write discipline.
- Automatic migration on upgrade. Existing projects stay repository-backed until a user changes the setting.

## Timeline

- time: "2026-08-26T02:07:58.645Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["packages-server-src-server-agent-project-knowledge","packages-server-src-server-workspace-registry-ts","packages-protocol-src-project-knowledge-ts","packages-app-src-project-knowledge"]
- time: "2026-08-26T02:07:58.645Z"
  kind: "evidence"
  summary: "Requested 2026-08-25 after user feedback from Marton: he wants Otto project knowledge without the store living inside the project repository. Design confirmed with the user in the same session: effective location resolves override -> existing store on disk -> global default; switching offers a move with confirmation; the whole `.otto/` payload including KNOWLEDGE.md moves.\n\nCode survey establishing feasibility:\n- `ProjectKnowledgeService.knowledgeDirectory(root)` (project-knowledge-service.ts:1028) is the single path choke point: `join(root, \".otto\", \"knowledge\")`, with sibling `join(root, \".otto\", \"KNOWLEDGE.md\")` reads.\n- Both session RPCs (session/project-knowledge/project-knowledge-session.ts) and MCP tools reach it through one injected `resolveProjectRoot(cwd)` dependency wired at bootstrap.ts:1394.\n- `.otto/` in a repo holds only knowledge; `otto.json` is a separate repo-root file. Moving the store removes the folder entirely.\n- `resolveRepoRoot` already collapses Otto worktrees to the main repo root, so worktrees share one store either way.\n- `PersistedProjectRecord.kanban` (workspace-registry.ts:40) plus `kanban.project.target.set.request` is the shipped precedent for a per-project, host-local, non-credential setting.\n- `resolveWorkspaceFilePaths` already carries `outsideAnyProject` for files outside every workspace, so the app can open host-local pages without new file-transport work."
- time: "2026-08-26T02:45:03.968Z"
  kind: "note"
  summary: "All five planned slices are built, typecheck clean across protocol, client, server and app, with 39 new unit tests green (resolver 8, migration 5, app decision 4, plus the existing 21 service and 11 session tests still passing). Held at partial rather than complete for one reason: no Playwright E2E spec covers the new UI, and docs/testing.md requires a spec plus its coverage-matrix row for user-facing surfaces. The feature has also not been exercised against a live daemon end to end. Those two are the remaining slice."
  affects: ["configurable-project-knowledge-store-location"]

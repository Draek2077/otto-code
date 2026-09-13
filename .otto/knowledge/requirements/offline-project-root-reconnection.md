---
id: "offline-project-root-reconnection"
kind: "requirement"
title: "Missing project roots remain Offline until explicitly reconnected"
status: "proposed"
tags: ["projects","workspaces","recovery","data-preservation"]
created_at: "2026-09-13T07:39:48.411Z"
updated_at: "2026-09-13T07:39:48.411Z"
---
# Missing project roots remain Offline until explicitly reconnected

<!-- compiled_truth -->

When a project's base folder or an ancestor is moved, renamed, or unavailable, Otto keeps the existing project Offline. Its workspace and chat identities remain intact; missing-root detection must never recreate directories, archive workspaces, initialize workspace runtimes, or mutate workspace records. Recovery edits the existing project's base folder and reconnects the selected existing location, rebasing Otto-owned paths beneath the former root while preserving relative structure and ownership. Internal folder moves, Git worktree repair, terminals, and rewriting project files are outside this operation. Upstream changes should remain localized, without making the upcoming Paseo merge a prerequisite.

## Timeline

- time: "2026-09-13T07:39:48.411Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-13T07:39:48.411Z"
  kind: "evidence"
  summary: "User explicitly requested Offline state and manual base-folder reconnection, then authorized implementation with Go. Implemented on 2026-09-13; contract in docs/workspace-lifecycle.md. Ten tests in packages/server/src/server/project-relocation-service.test.ts passed, covering parent rename, startup preservation, mutation refusal, path rebasing, destination validation/collision, rollback, interrupted recovery, and in-memory transcript retention across provider close/resume. Isolated Windows browser/daemon test packages/app/e2e/browser/project-offline-relocation.spec.ts passed: Offline reload, rejected nonexistent destination, same workspace/chat IDs and moved cwd, restored mock transcript after reconnect and another reload. Server/client/app typechecks, targeted lint, and E2E coverage index passed. Native macOS folder-picker behavior and native-provider continuation have not been exercised; no release or installed-daemon restart performed."

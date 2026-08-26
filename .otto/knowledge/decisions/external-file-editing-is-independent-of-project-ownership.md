---
id: "external-file-editing-is-independent-of-project-ownership"
kind: "decision"
title: "External file editing is independent of project ownership"
status: "confirmed"
tags: ["files","text-editor","workspaces","project-settings"]
created_at: "2026-08-26T13:19:28.765Z"
updated_at: "2026-08-26T13:19:28.765Z"
---
# External file editing is independent of project ownership

<!-- compiled_truth -->

Otto has no project-links concept or project-owned edit permission layer. A specific absolute file reached from a trusted file-opening surface opens and edits directly regardless of project or workspace ownership. The client resolves a registered serving workspace when one owns the path; otherwise it scopes single-file daemon operations to the file's parent directory. File Explorer browsing and create/delete/rename operations remain workspace-contained, and actions that require a registered workspace are withheld when no workspace owns the file.

## Timeline

- time: "2026-08-26T13:19:28.765Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["project-settings-save-reflects-every-draftable-project-setting"]
- time: "2026-08-26T13:19:28.765Z"
  kind: "evidence"
  summary: "User decision on 2026-08-26. Implemented by removing the project.links.* protocol and client API, daemon project-link persistence and handlers, Project Settings link UI, and link-dependent edit state. Verified by packages/app/src/projects/cross-project-open.test.ts and packages/app/e2e/browser/external-file-editing.spec.ts; both registered-workspace and workspace-less disk-write journeys passed."

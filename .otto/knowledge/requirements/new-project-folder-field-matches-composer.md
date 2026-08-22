---
id: "new-project-folder-field-matches-composer"
kind: "requirement"
title: "New Project folder field matches composer geometry"
status: "confirmed"
tags: ["new-project","folder-field","composer","ui","geometry"]
created_at: "2026-08-21T22:19:41.891Z"
updated_at: "2026-08-21T22:20:33.160Z"
---
# New Project folder field matches composer geometry

<!-- compiled_truth -->

The New Project page does not show a path caption below the folder field. The prominent folder field uses the same rounded-corner radius as the message composer input, and the submit action is labeled “Create project” for both opening an existing folder and creating a new project.

## Timeline

- time: "2026-08-21T22:19:41.891Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T22:19:41.891Z"
  kind: "evidence"
  summary: "User requirement on 2026-08-21. Implemented in packages/app/src/screens/new-project-screen.tsx by removing the rendered path preview, while retaining pathPreview for duplicate-path validation, and in packages/app/src/screens/new-project/new-project-inputs.tsx by using theme.borderRadius.md, matching packages/app/src/composer/input/input.tsx."
- time: "2026-08-21T22:20:33.160Z"
  kind: "decision"
  summary: "User clarification on 2026-08-21: the New Project submit button should say “Create project” rather than “Open project”. Implemented in packages/app/src/screens/new-project-screen.tsx by always using the localized newProject.actions.create label."
  source: "User requirement and implementation in packages/app/src/screens/new-project-screen.tsx."

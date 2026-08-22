---
id: "borderless-page-headers-and-dev-branch-badges"
kind: "requirement"
title: "Borderless page headers use the page surface and dev branch badges do not reserve chrome"
status: "proposed"
tags: ["ui","desktop","titlebar","sidebar","theme","development-build"]
created_at: "2026-08-21T21:54:14.380Z"
updated_at: "2026-08-21T22:12:12.014Z"
---
# Borderless page headers use the page surface and dev branch badges do not reserve chrome

<!-- compiled_truth -->

Screens that intentionally render a borderless `ScreenHeader` use the owning page surface (`surface0`), while retaining the titlebar drag region, control affordances, and existing safe-area geometry. The development source-branch badge is desktop-only and renders as an accent pill in the workspace title bar, immediately to the right of that workspace's `...` menu; it is not rendered in the sidebar and does not reserve separate sidebar chrome.

## Timeline

- time: "2026-08-21T21:54:14.380Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T21:54:14.380Z"
  kind: "evidence"
  summary: "User screenshot and direction on 2026-08-21 identified the home page's `surfaceChrome` strip as visually incorrect because the page has no title bar, and identified the `main` pill as a development branch marker consuming excessive vertical space. Code traced to `packages/app/src/components/headers/screen-header.tsx`, `packages/app/src/screens/open-project-screen.tsx`, `packages/app/src/components/left-sidebar.tsx`, and the Windows dev launcher injection of `EXPO_PUBLIC_OTTO_DEV_BUILD_LABEL`. Implemented the borderless surface override and absolute badge overlay. Verification: app typecheck passed, targeted oxlint passed with 0 warnings/errors, focused `desktop-sidebar-layout.test.ts` passed (6 tests), formatting check passed, and `git diff --check` passed."
- time: "2026-08-21T22:02:36.247Z"
  kind: "evidence"
  summary: "The borderless home/new-project/new-workspace routes also need the native Windows caption strip to use the page surface (`surface0`). Otherwise the minimize/maximize/close region remains painted with the normal `surfaceChrome` title-bar color and appears as a second dark band over the continuous page canvas."
  source: "User-provided Windows desktop screenshots and verified implementation"
  affects: ["primary-sidebars-use-a-deeper-surface-than-tab-rails"]
- time: "2026-08-21T22:12:12.014Z"
  kind: "decision"
  summary: "The user requested moving `EXPO_PUBLIC_OTTO_DEV_BUILD_LABEL` from the top-left sidebar menu to the workspace title bar beside the `...` menu. Implemented the relocation in `packages/app/src/screens/workspace/workspace-screen.tsx`, removed the sidebar overlay from `packages/app/src/components/left-sidebar.tsx`, updated `docs/development.md`, and verified app typecheck, targeted lint, formatting, and `git diff --check` on 2026-08-21."
  source: "User request and verified implementation on 2026-08-21"
  affects: ["primary-sidebars-use-a-deeper-surface-than-tab-rails"]

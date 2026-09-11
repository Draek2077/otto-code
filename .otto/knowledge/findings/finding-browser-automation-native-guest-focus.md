---
id: "finding-browser-automation-native-guest-focus"
kind: "finding"
title: "Browser automation can transfer native guest focus away from host controls"
status: "proposed"
tags: ["browser","automation","focus","electron"]
created_at: "2026-09-11T14:06:34.662Z"
updated_at: "2026-09-11T14:06:34.662Z"
---
# Browser automation can transfer native guest focus away from host controls

<!-- compiled_truth -->

A Windows Electron 41 isolated guest regression reproduces a trusted CDP click moving the host document's active element from a chat textarea to its webview. No explicit application focus call is required. The browser pane's existing guest-focus handler can additionally promote that notification into pane and webContents focus.

The renderer now guards tab-scoped automation: it follows the currently focused host control, restores it after guest focus transfers, suppresses automated guest focus notifications before pane activation, and releases the guard when overlapping commands finish or fail. Explicit browser_focus_tab retains its separate behavior.

The native regression verifies that host keyboard characters continue into the textarea, CDP text still enters the guest, a host menu control keeps focus, and native clicking can focus the guest after cleanup. The Chromium component regression verifies the actual device-size menu remains mounted and focused while guest focus and loading events run.

These establish a reproduced focus-transfer mechanism and focused repair coverage. They do not prove every cause of the user's intermittent menu dismissal or a complete installed-app journey. The native test is an isolated hidden window; component tests substitute Electron guest methods and disable entrance animations.

## Timeline

- time: "2026-09-11T14:06:34.662Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-11T14:06:34.662Z"
  kind: "evidence"
  summary: "User report in this chat: Browser Actions repeatedly interrupt chat typing; the Responsiveness dropdown sometimes closes automatically. Verified 2026-09-11: npm run test:e2e:browser-focus --workspace=@otto-code/desktop passed using real Electron guest clicks, host sendInputEvent character input, guest Input.insertText, and native host mouse input. Focused checks: 5 focus-guard Chromium tests, 11 production-pane Chromium tests, and 18 automation-handler unit tests pass. App and desktop typechecks, targeted lint and git diff --check pass. Source: packages/app/src/desktop/browser/automation/focus-guard.web.ts; automation/handler.ts; pane/loading.browser.test.tsx; packages/desktop/e2e/browser-focus.e2e.cjs. Durable behavior and validation boundaries documented in docs/preview.md and docs/testing.md."

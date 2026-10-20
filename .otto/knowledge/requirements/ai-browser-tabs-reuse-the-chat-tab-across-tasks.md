---
id: "ai-browser-tabs-reuse-the-chat-tab-across-tasks"
kind: "requirement"
title: "AI browser tabs reuse the chat tab across tasks"
status: "proposed"
tags: ["browser","preview","tab-reuse","agents"]
created_at: "2026-10-03T18:56:52.125Z"
updated_at: "2026-10-03T22:33:00.049Z"
---
# AI browser tabs reuse the chat tab across tasks

<!-- compiled_truth -->

AI general browsing should reuse the tab opened for that chat across tasks. A page error, loading state, or transient tool failure is a reason to reload, navigate, or retry that tab, not create another. A separate tab remains appropriate for a comparison, an explicit user request, or another concrete need. Do not automatically take over the user's tabs or another chat's tabs. Preview verification continues in the server's designated preview tab. Supporting browser surfaces reuse the workspace's existing destination pane.

Each AI chat may open at most 12 browser and preview tabs combined in its workspace, across app and host browsers. Starting and detached tabs count. The cap is enforced by the shared daemon before creation, including preview_start, and cannot be bypassed by an additional-tab reason. Reusing or recovering an existing tab remains available at the cap; closing one frees a slot after successful discovery confirms absence. User-created tabs and other chats' tabs do not count against the chat. Failed discovery must not authorize new creation. Desktop creator attribution is persisted so restored AI tabs still count and tab discovery can recover general-browsing reuse after a daemon restart.

## Timeline

- time: "2026-10-03T18:56:52.125Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["browser-tab-registry","chat-opened-panels-follow-one-workspace-pane-preference"]
- time: "2026-10-03T18:56:52.125Z"
  kind: "evidence"
  summary: "User request and pane clarification, 2026-10-03. Implemented a provider-neutral reuse default for browser_new_tab with optional additionalTabReason, chat-tab hints in browser_list_tabs, and explicit reuse guidance for the OpenAI-compatible provider. Associations live on the shared broker identity and creation calls serialize per workspace/chat. Successful listing must prove absence before replacement; lookup, navigation, starting, and detached failures retain the ID. Verified 86 browser-tool tests covering catalog rebuilds, host filters, transient errors, explicit additional tabs, confirmed closure, chat isolation, and parallel open calls. App/server typechecks and lint pass; docs/preview.md records current semantics and proof boundaries. Association is daemon-lifetime only, not persisted across daemon restarts. Existing tabs with unknown association are not automatically claimed. Changes are local and uncommitted; live model choice and packaged Electron behavior are unverified."
- time: "2026-10-03T22:32:56.649Z"
  kind: "decision"
  summary: "User explicitly added the combined 12-tab maximum while requesting a commented commit. The implementation now includes the shared broker gate, serialized creation, persisted desktop attribution, and ownership recovery through discovery."
  source: "User request; packages/server/src/server/browser-tools/tab-limit.ts; packages/server/src/server/browser-tools/broker.test.ts; packages/app/src/desktop/browser/s"
  affects: ["browser-tab-registry","chat-opened-panels-follow-one-workspace-pane-preference"]
- time: "2026-10-03T22:33:00.049Z"
  kind: "evidence"
  summary: "2026-10-03: Added the requested hard cap of 12 browser and preview tabs combined per chat/workspace. The daemon's shared BrowserToolsBroker gates all attributed new_tab calls, including preview_start, across app and hosted browsers. Concurrent creation is serialized; starting/detached tabs count; a failed listing blocks creation; closing a tab frees capacity; reuse stays available at the cap. Desktop BrowserRecord stores optional openedByAgentId, surfaced through additive optional tab-info fields; discovery restores general browsing association. This supersedes the earlier daemon-lifetime-only limitation for desktop tabs whose creator metadata is saved. Verified 31 broker tests (including concurrent 13-request limit, combined preview/browser attribution, close/reuse, other-chat/user isolation, restored ownership, failed discovery, and combined app/host cap), 87 browser-tool tests, 22 browser-state tests, and 20 desktop-handler tests. App/server typechecks and targeted lint pass after rebuilding protocol/client declarations. Installed Electron and live-model behavior remain unverified."
  source: "packages/server/src/server/browser-tools/tab-limit.ts; packages/server/src/server/browser-tools/broker.test.ts; packages/server/src/server/browser-tools/tools.t"

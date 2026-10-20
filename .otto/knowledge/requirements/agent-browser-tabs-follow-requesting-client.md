---
id: "agent-browser-tabs-follow-requesting-client"
kind: "requirement"
title: "AI browser tabs follow the requesting client"
status: "proposed"
tags: ["browser","preview","mobile","desktop","agent-tools"]
created_at: "2026-10-02T02:58:51.585Z"
updated_at: "2026-10-02T02:58:51.585Z"
---
# AI browser tabs follow the requesting client

<!-- compiled_truth -->

AI-created Otto browser tabs and preview tabs default to the browser visible to the client that submitted the latest prompt: the desktop app's browser for desktop requests, and the daemon-hosted browser for mobile requests. `browser_new_tab` and `preview_start` accept an explicit `host: "app" | "host"` override; `browser_list_tabs` can filter by the same choice. Once a tab exists, its `browserId` routes later browser actions to its owner. An existing bound preview tab is reused even when a later request names a different host. This requirement remains draft while the user's device preference is being evaluated.

## Timeline

- time: "2026-10-02T02:58:51.585Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["browser-tab-registry"]
- time: "2026-10-02T02:58:51.585Z"
  kind: "evidence"
  summary: "User preference stated 2026-10-01: host tabs are needed from phone, ordinary app tabs preferred on desktop, with plain-English host override. Implemented in packages/server/src/server/browser-tools/broker.ts, tools.ts, preview/preview-tools.ts, and session.ts; documented in docs/preview.md. Focused broker, browser-tool, preview-tool, and session-origin tests pass; server typecheck and targeted lint pass. No live desktop/mobile runtime exercise yet."

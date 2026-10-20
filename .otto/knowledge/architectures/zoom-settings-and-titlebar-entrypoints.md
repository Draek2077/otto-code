---
id: "zoom-settings-and-titlebar-entrypoints"
kind: "architecture"
title: "Zoom settings and title-bar entry points"
status: "confirmed"
tags: ["zoom", "settings", "title-bar", "icons", "desktop", "chat", "meetings"]
created_at: "2026-08-13T23:17:02.586Z"
updated_at: "2026-08-14T04:52:01.316Z"
---

# Zoom settings and title-bar entry points

<!-- compiled_truth -->

Zoom capabilities are separately controlled according to their execution boundary. Zoom Recorder is a desktop-local integration, disabled by default, at Settings > Integrations > Meetings > Zoom Recorder. Zoom Chat is a daemon account connection at Settings > Host > Connections > Zoom Chat. The desktop title bar exposes two separate adjacent controls: Zoom Team Chat uses the Material `inbox_text` glyph and opens its own Chat popup; Meeting Notes uses `speaker_notes` and opens its own transcript popup. Neither control is nested under a shared parent menu or opens a dialog. Neither glyph may collide with an existing Otto action; they are exported as `InboxText` and `SpeakerNotes` from the shared Material icon registry.

## Timeline

- time: "2026-08-13T23:17:02.586Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-recorder-titlebar-transcript-library","zoom-recorder-is-desktop-host-local-only","communications-integrations-separate-chat-and-meetings"]
- time: "2026-08-13T23:17:02.586Z"
  kind: "evidence"
  summary: "Settings structure review: packages/app/src/screens/settings-screen.tsx and packages/app/src/desktop/components/integrations-section.tsx. Current Material icon usage review. Explicit user request for distinct chat and meetings icons."
- time: "2026-08-13T23:28:13.793Z"
  kind: "decision"
  summary: "The product owner explicitly selected Material `speaker_notes` as the Meetings icon, replacing `video_chat`."
- time: "2026-08-14T04:47:28.473Z"
  kind: "evidence"
  summary: "Implemented the shared desktop title-bar Communications menu in `packages/app/src/screens/workspace/workspace-screen.tsx`. It supersedes the separate Meeting Notes button and orders Zoom Team Chat (`chat`) first, then Meeting Notes (`speaker_notes`), with each entry gated by its own capability. Focused format, lint, and `@otto-code/app` typecheck passed."
  source: "Implementation verification, 2026-08-13"
- time: "2026-08-14T04:51:35.977Z"
  kind: "decision"
  summary: "The user rejected the shared Communications menu. Chat and Meeting Notes need independent immediate popup surfaces."
  source: "Explicit user correction, 2026-08-13"
- time: "2026-08-14T04:52:01.316Z"
  kind: "decision"
  summary: "The user clarified that `inbox_text`, not `chat`, is the dedicated Team Chat title-bar icon."
  source: "Explicit user correction, 2026-08-13"

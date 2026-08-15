---
id: "communications-conversation-tabs-are-distinct-from-ai-chats"
kind: "requirement"
title: "Communications conversation tabs are distinct from AI chats"
status: "confirmed"
tags: ["communications", "zoom", "workspace-tabs", "chat", "threads", "ui"]
created_at: "2026-08-15T05:40:54.821Z"
updated_at: "2026-08-15T07:52:02.707Z"
---

# Communications conversation tabs are distinct from AI chats

<!-- compiled_truth -->

When a communications conversation is opened into a workspace tab, it must use a distinct tab kind and room-oriented structure rather than masquerade as an AI chat. It carries provider and conversation identity, no model or agent controls, and presents participant messages, channels, and reply-thread structure truthfully.

Communications rooms reuse Otto's existing message-bubble visual language and interaction primitives: bubble styling, typography, spacing, hover and keyboard-focus behavior, composer controls, and reaction presentation. The distinction from an AI chat is structural and semantic, not a second visual system.

The room has a chronological top-level timeline. A reply targets one message and renders as an inline, indented branch beneath that root, with a visible tree rail and a control to expand or collapse its replies. An expanded thread includes its own reply composer inside the branch; the room-level composer remains pinned below the main timeline for new top-level messages. This structure must be backed by explicit message-parent relationships, not reconstructed from visual order.

Every message, whether top-level or nested, is an actionable target. Its hover- and keyboard-focus-revealed action tray includes Reply and message reactions, attached to that message's stable identity. Reaction state renders with the message and Reply creates its child branch; neither action is a transcript-level control.

## Timeline

- time: "2026-08-15T05:40:54.821Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-15T05:40:54.821Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-14: opened Zoom chats may use workspace tabs but must look materially different from AI chats. The communication layout is closer to a chat room with reply-thread trees and collapsing behavior, and requires separate design work."
- time: "2026-08-15T05:42:47.997Z"
  kind: "decision"
  summary: "User supplied the required inline reply-tree and nested-composer interaction model."
  source: "User-provided Zoom Team Chat screenshot and explicit direction, 2026-08-14"
- time: "2026-08-15T05:43:23.633Z"
  kind: "decision"
  summary: "User established that Reply and reactions are per-message room actions."
  source: "User-provided Zoom Team Chat message-action screenshot and explicit direction, 2026-08-14"
- time: "2026-08-15T05:43:42.156Z"
  kind: "decision"
  summary: "User clarified that communications rooms reuse Otto's existing message-bubble and interaction primitives."
  source: "Explicit user correction, 2026-08-14"
- time: "2026-08-15T06:17:09.526Z"
  kind: "evidence"
  summary: "Implemented an additive provider-neutral room contract and a distinct `communicationsRoom` workspace tab target. Shared popup/tab room rendering uses explicit parent message ids for thread retrieval, per-message reaction operations, room and thread composers, and a daemon capability gate. Verified with protocol/client build, app and server typechecks, targeted lint/format, and 58 focused communications tests."
  source: "Implementation and focused verification, 2026-08-14"
- time: "2026-08-15T06:41:37.550Z"
  kind: "evidence"
  summary: "Corrected popup room navigation after identifying a nested-overlay defect: selecting a room now replaces the existing title-bar dropdown content in place. The prior adaptive modal child sheet was removed. Back returns to the retained Home state; closing the dropdown clears child selection for the next popup session. App typecheck, targeted lint, and formatting passed."
  source: "Implementation correction and verification, 2026-08-15"
- time: "2026-08-15T07:05:32.237Z"
  kind: "evidence"
  summary: "Replaced the room renderer's handcrafted bubble/composer presentation with existing chat visual primitives: BlackChatScope, ChatWidthBounds, BubbleCornerSheen, TurnCopyButton, MessagePlaybackButton, and MessageInput. Communications hides the agent-only attachment control while retaining dictation and the shared composer control-slot structure. Threads retain explicit rails and room-specific actions. App typecheck, targeted lint, and formatting passed."
  source: "Implementation correction and app verification, 2026-08-15"
- time: "2026-08-15T07:45:05.704Z"
  kind: "evidence"
  summary: "Added the existing `ChatSeamFade` top and bottom timeline fades to the shared Communications Room frame, so both workspace-tab and title-bar popup rooms get content-facing seams. The bottom fade remains inside the timeline directly above the composer, inherits `BlackChatScope` for pure-black chat backgrounds, and adds neither a divider nor shell padding. Targeted format, lint, and app typecheck passed."
  source: "Implementation and focused app verification, 2026-08-15"
- time: "2026-08-15T07:45:18.094Z"
  kind: "evidence"
  summary: "Communications room message bodies now reuse the shared Markdown renderer with the compact rendering mode, selectable text, generic safe links, and existing rich-copy footer. Provider text remains raw for copy and speech while its renderer disables HTML translation and remote-image fetching. Verified with focused unit test, app lint, formatting, and typecheck."
  source: "Implementation and focused verification, 2026-08-15"
- time: "2026-08-15T07:50:43.498Z"
  kind: "evidence"
  summary: "Completed room message-row/bubble structural parity: a shared ChatMessageBubble now serves AI user messages and Communications participants; Communications aligns provider-confirmed self-authored messages to the outgoing side while retaining required sender presentation, routes message actions through stable provider message ids, and lays out only explicit roots as the chronological timeline. Explicit parentMessageId remains the sole basis for reply-tree membership. Verified with the focused communications-message-layout Vitest, targeted lint, format, and app typecheck. Visual verification was unavailable because no local Metro app was listening on port 8081; the dev daemon on port 6788 was left untouched."
  source: "Implementation and focused verification, 2026-08-15"
- time: "2026-08-15T07:50:51.098Z"
  kind: "evidence"
  summary: "Completed the Communications Room footer/action pass: extracted the provider-neutral `MessageFooter` and shared bare-glyph footer action primitive, then used it for per-message Reply and thread controls. The reaction picker remains a compact bullet-trailing group. Room controls retain a fixed footer baseline, hover/focus visibility without collapse during nested focus changes, native/compact fallback visibility, and incoming-only in-bubble playback. Added focused pure-unit coverage for playback eligibility and footer reveal semantics; targeted Vitest, lint, and app typecheck passed."
  source: "Implementation and focused verification, 2026-08-15"
- time: "2026-08-15T07:51:07.787Z"
  kind: "evidence"
  summary: "Extracted the shared non-agent composer frame and keyboard focus path, then applied it to the Communications Room root composer. The root owns the bounded composer geometry, keyboard lift, focused send/dictation shortcuts, and its single auto-speech control. Inline reply composers retain only thread-local text/dictation behavior, autofocus into their branch, hide auto-speech, and do not claim pane keyboard ownership. Attachments remain hidden. Focused formatter, lint, and the new pure keyboard-action test (2 assertions) passed. App typecheck was attempted but remains blocked by an unrelated duplicate `forwardRef` import in `packages/app/src/components/ui/floating.tsx`."
  source: "Implementation verification, 2026-08-15"
- time: "2026-08-15T07:52:02.707Z"
  kind: "evidence"
  summary: "Implemented the Communications Room reply-thread lifecycle: Reply remains an open/refocus action, while a separate accessible shared message-footer icon expands or collapses an established reply branch. Branch membership is filtered and appended only through explicit `parentMessageId`; failed thread-history reads retain the expanded composer and focus lifecycle. Added four focused state tests covering open/refocus, collapse retention, failed-load retention, and explicit parent filtering. Targeted Vitest, lint, format, and app typecheck passed."
  source: "Implementation and focused verification, 2026-08-15"
  affects: ["communications-conversation-tabs-are-distinct-from-ai-chats"]

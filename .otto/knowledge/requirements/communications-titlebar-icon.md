---
id: "communications-titlebar-icon"
kind: "requirement"
title: "Communications title-bar icon"
status: "confirmed"
tags: ["communications", "titlebar", "ui", "icons"]
created_at: "2026-08-13T23:29:26.376Z"
updated_at: "2026-08-15T07:34:22.897Z"
---

# Communications title-bar icon

<!-- compiled_truth -->

The title bar has no umbrella Communications menu. It presents separate adjacent Chat and Meeting Notes controls, each opening its own direct popup.

- Chat uses Material `chat` as its shared feature icon in workspace room tabs, popup conversation rows, the title bar’s normal connected state, and Settings. In the title bar only, an unacknowledged Otto local chat notification replaces that glyph with colored `mark_unread_chat_alt`. Opening its conversation in the popup or workspace immediately acknowledges that local notification and removes the unread glyph, without claiming a provider-side message was marked read. While a presence transition is Pending, the control instead shows `more_horiz`, including when unread messages exist, so the in-flight status change remains visible. When disconnected, it shows `chat_bubble_off`. It is not represented by a bell, desktop banner, separate notification control, or intrusive in-app alert.
- The dedicated Meeting Notes control reflects desktop-local recorder state with `headset_mic` while active and `headset_off` when paused: blue while idle or complete, red while recording, amber while transcribing or downloading the model, and muted when paused or unavailable.
- Title-bar tooltips use action text for toggles: `Mute voice cues`/`Unmute voice cues` and `Open Visualizer`/`Close Visualizer`. Stateful controls use a concise `Label: Status` form: `Hey Otto: Disabled|Enabled|Detecting|Recording|Processing`, `Meeting: Disabled|Detecting|Recording|Transcribing|Ready`, and `Chat: Disabled|<Status>|Notification`.

Chat and meeting transcription remain separate service families and must not share a combined title-bar control.

## Timeline

- time: "2026-08-13T23:29:26.376Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["communications-active-window-notification-restraint","provider-neutral-communications-hub"]
- time: "2026-08-13T23:29:26.376Z"
  kind: "evidence"
  summary: "Explicit user decision, 2026-08-13: \"maybe we use inbox_text for the icon for this feature\"."
- time: "2026-08-14T04:47:27.411Z"
  kind: "evidence"
  summary: "Implemented the desktop workspace Communications control in `packages/app/src/screens/workspace/workspace-screen.tsx`. It uses the shared Material `InboxText` (`inbox_text`) glyph and presents a compact in-app unread indicator from the daemon-owned communications overview; it introduces no desktop notifications, polling, or sound."
  source: "Implementation verification, 2026-08-13"
- time: "2026-08-14T04:51:34.811Z"
  kind: "decision"
  summary: "The user rejected one umbrella Communications control because Meeting Notes and Chat are separate working surfaces that require direct popup access."
  source: "Explicit user correction, 2026-08-13"
- time: "2026-08-14T04:53:39.922Z"
  kind: "decision"
  summary: "The user rejected the implemented umbrella menu and specified the Meeting Notes state colors."
  source: "Explicit user correction and implementation, 2026-08-13"
  affects: ["communications-active-window-notification-restraint","zoom-settings-and-titlebar-entrypoints"]
- time: "2026-08-14T05:09:15.581Z"
  kind: "decision"
  summary: "The user replaced the Chat icon family and specified the glyph used for incoming unread chat."
  source: "Explicit user UI decision, 2026-08-13"
- time: "2026-08-14T05:09:21.094Z"
  kind: "evidence"
  summary: "Implemented the Chat titlebar state icons in `packages/app/src/screens/workspace/workspace-screen.tsx`: `chat_bubble` for connected, `chat_bubble_off` otherwise, and `mark_chat_unread` when the daemon overview reports unread messages. Replaced the prior unread dot. Added vendored Material assets and exports. Focused format, lint, and `@otto-code/app` typecheck passed."
  source: "Implementation verification, 2026-08-13"
- time: "2026-08-14T05:28:26.651Z"
  kind: "evidence"
  summary: "Verified and reapplied the Chat titlebar state glyphs in the active workspace titlebar source after it had reverted to `inbox_text`: connected `chat_bubble`, disconnected `chat_bubble_off`, unread `mark_chat_unread`. Focused lint and app typecheck passed."
  source: "Implementation verification, 2026-08-13"
- time: "2026-08-14T05:38:10.813Z"
  kind: "decision"
  summary: "The user defined a uniform title-bar tooltip contract for voice, Visualizer, Hey Otto, Zoom Meeting, and Zoom Chat controls."
  source: "Explicit user UI requirement, 2026-08-13"
- time: "2026-08-15T06:17:15.025Z"
  kind: "decision"
  summary: "Explicit user requirement, 2026-08-15: the Zoom Chat title-bar icon must display the pending ellipsis while a presence change is between statuses."
  source: "Explicit user requirement, 2026-08-15"
- time: "2026-08-15T06:52:15.661Z"
  kind: "decision"
  summary: "The user explicitly removed Zoom branding from the Chat and Meeting feature UI and specified concise unbranded title-bar labels."
  source: "Explicit user requirement, 2026-08-15"
- time: "2026-08-15T07:27:31.372Z"
  kind: "decision"
  summary: "User clarified that opening a Chat room in a workspace tab marks Otto's local notification read, so the active-window unread glyph must clear immediately."
  source: "Explicit user requirement, 2026-08-15"
- time: "2026-08-15T07:34:22.897Z"
  kind: "decision"
  summary: "User selected Material chat as the Chat feature icon across workspace tabs, title bar, and Settings, reserving colored mark_unread_chat_alt for title-bar unread state."
  source: "Explicit user requirement, 2026-08-15"

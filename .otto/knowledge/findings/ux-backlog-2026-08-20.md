---
id: "ux-backlog-2026-08-20"
kind: "finding"
title: "Untriaged UX and reliability backlog reported 2026-08-20"
status: "proposed"
tags: ["backlog","ux","reliability","triage"]
created_at: "2026-08-20T06:49:19.807Z"
updated_at: "2026-08-20T06:51:20.792Z"
---
# Untriaged UX and reliability backlog reported 2026-08-20

<!-- compiled_truth -->

The following user-reported observations require implementation verification and scoping; none is yet treated as a confirmed root cause or accepted remediation.

- Chat spelling-error underlines lack right-click correction suggestions.
- Navigation split actions need clearly defined horizontal/vertical hotkeys.
- Automatic Git fetch appears to continue after it is disabled.
- The package dependency stack needs a deliberate audit of install-time deprecation and memory-leak warnings.
- Opening a project briefly surfaces an “already exists” error caused by the screen’s own creation flow.
- Model selection can unexpectedly change effort or mode, including selecting Claude ultracode, and commonly resets to Manual despite no explicit user change.
- File-document previews need anchored comments that add durable, source-linked context to a chat.
- File-tab context menus need Copy filename, Copy full path, and Copy workspace path actions.
- Dismissing inserted meeting notes with X does not clear the pending composer attachment; it reappears when a subsequent message is sent.

## Timeline

- time: "2026-08-20T06:49:19.807Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-20T06:49:19.807Z"
  kind: "evidence"
  summary: "User report, 2026-08-20. This record intentionally separates reports from confirmed causes and fixes."
- time: "2026-08-20T06:51:20.792Z"
  kind: "evidence"
  summary: "User added a Meeting Notes popup layout requirement on 2026-08-20: row actions must share the final visible text line, not render in a separate footer below the row content. This is an unconfirmed requirement pending implementation review."
  source: "User report, 2026-08-20"

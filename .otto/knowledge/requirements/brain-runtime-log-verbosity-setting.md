---
id: "brain-runtime-log-verbosity-setting"
kind: "requirement"
title: "Brain runtime log verbosity is configurable"
status: "confirmed"
tags: ["brain", "runtime", "logging", "settings", "llama.cpp"]
created_at: "2026-08-15T03:14:45.939Z"
updated_at: "2026-08-15T03:25:52.744Z"
---

# Brain runtime log verbosity is configurable

<!-- compiled_truth -->

Otto Brain Settings expose a persistent **Runtime log verbosity** selector for the resident `llama-server` process. It presents the runtime’s supported levels as **Generic output (0)**, **Errors (1)**, **Warnings (2)**, **Info (3, default)**, **Trace (4)**, and **Debug (5)**. The setting applies to every managed llama-server launch, takes effect on the next model load or restart, and is placed in the Runtime section immediately after the runtime selector and before model-specific controls.

## Timeline

- time: "2026-08-15T03:14:45.939Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-host-control","brain-console","brain-operations-use-resident-hosted-server"]
- time: "2026-08-15T03:14:45.939Z"
  kind: "evidence"
  summary: "Explicit user requirement, 2026-08-15: surface runtime log verbosity in Otto Brain Settings and choose its appropriate position."
- time: "2026-08-15T03:25:52.744Z"
  kind: "evidence"
  summary: "Implemented the persistent host-level selector in Brain Settings → Server after Start automatically and before listen controls. It launches resident llama-server with `-lv 0..5` (default 3), restarts structurally on change, hides behind `brainRuntimeLogVerbosity` for older daemons, and replaces deprecated `--no-webui` with `--no-ui`. Focused runtime, protocol, and Brain manager tests passed; Brain and app typechecks passed. Server-wide typecheck remains blocked by an unrelated pre-existing TS5076 in `communications/zoom-team-chat-client.ts:324`."
  source: "Implementation verification, 2026-08-14"

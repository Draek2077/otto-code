---
id: "brain-operations-use-resident-hosted-server"
kind: "requirement"
title: "Brain operations use the resident hosted llama-server"
status: "confirmed"
tags: ["brain", "operations", "llama-server", "logging"]
created_at: "2026-08-12T02:17:07.506Z"
updated_at: "2026-08-15T03:28:08.252Z"
---

# Brain operations use the resident hosted llama-server

<!-- compiled_truth -->

Calibrate, Sweep, Benchmark, inference, downloads, runtime work, and every other host-owned operation run under the Brain service's single managed execution boundary. The resident `llama-server` may be relaunched to load a model or apply launch-time settings, but that process boundary never creates a new log. Each Brain service run owns one append-only Brain log, reset only when the Brain service restarts, containing stdout/stderr and lifecycle events from every managed child plus every host operation. The Logs surface tails that Brain-session log, not an individual llama-server instance.

## Timeline

- time: "2026-08-12T02:17:07.506Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-console","brain-host-control"]
- time: "2026-08-12T02:17:07.506Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-11: all operations must run through the one hosted llama-server being observed, with complete tracking and updates."
- time: "2026-08-15T02:13:04.052Z"
  kind: "decision"
  summary: "Explicit user direction, 2026-08-14: one Brain log must contain every Brain-owned process and operation for the service lifetime, not reset per llama-server launch."
- time: "2026-08-15T02:24:32.557Z"
  kind: "evidence"
  summary: "The Brain service now writes each completed session-log line to its append-only file and publishes it immediately over the existing authenticated SSE stream. The daemon forwards each line to connected clients; the Logs tab appends it live and reloads durable history after reconnect. This preserves one Brain-service session log while avoiding polling batches."
  source: "Implementation, 2026-08-14"
- time: "2026-08-15T03:13:31.599Z"
  kind: "evidence"
  summary: "Observed startup-diagnostic gap: the current Brain session log records `llama-server` launch output through model initialization but no terminal lifecycle event. Separately, `$OTTO_HOME/otto-brain/otto-brain.log` records a Brain service startup failure, `listen EADDRINUSE 127.0.0.1:1234`. Pre-bind service failures must be surfaced in the session log so Logs is the complete operational record."
  source: "Local dev Brain logs, 2026-08-15"
- time: "2026-08-15T03:28:08.252Z"
  kind: "evidence"
  summary: "`packages/brain/src/service/serve.ts` now writes `FATAL Brain service startup failed: …` to the already-created per-service session log when `server.listen()` rejects (including `EADDRINUSE`), and writes `Brain service stopped` before it closes its SSE listeners. The foreground daemon child relays timestamped session entries captured before `/__host/events` can exist; `BrainManager.hostLogs()` falls back to that same local child session file after a terminal no-bind outcome instead of the legacy outer `otto-brain.log`. Focused coverage verifies the bind collision, terminal SSE entry, daemon SSE forwarding, and failed-session tail; targeted tests, both package typechecks, lint, and formatting passed."
  source: "Implementation and focused regression coverage, 2026-08-15"

---
id: "otto-daemon-lock-conflict-guard-lives-in-the-daemon-start-path-not-the-preview"
kind: "decision"
title: "Otto daemon lock-conflict guard lives in the daemon start path, not the preview subsystem"
status: "confirmed"
tags: ["preview", "daemon", "pid-lock", "dev-server", "ux-reliability"]
created_at: "2026-08-16T16:57:40.153Z"
updated_at: "2026-08-16T16:57:40.153Z"
---

# Otto daemon lock-conflict guard lives in the daemon start path, not the preview subsystem

<!-- compiled_truth -->

The "another Otto daemon already owns the single-instance lock" conflict guard lives in the Otto daemon start path (packages/server/scripts/supervisor-entrypoint.ts via the shared packages/server/src/server/daemon-lock-guard.ts, which reuses pid-lock.ts's isLocked/PidLockInfo). It reuses the SAME lock authority that emits "Another Otto daemon is already running (PID …)". The preview subsystem (dev-server-manager.ts, preview-tools.ts) must stay AGNOSTIC of how a configured dev server comes up — it does not know about the Otto lock, OTTO_HOME, or the daemon. When preview_start spawns `npm run dev:win`, the CHILD runs the daemon start path and does the conflict detection there; the parent preview tool just sees normal port-probe results. Guard behavior: interactive starts (stdin is a TTY) pause and poll until the existing daemon is quit, re-check the port is free, then continue (first Ctrl-C aborts, second force-exits, 15-min timeout); non-interactive/CI/spawned starts fail fast with a clear actionable message; --no-wait-on-conflict opts back into the old fail-immediately behavior. The guard never force-kills the existing daemon.

## Timeline

- time: "2026-08-16T16:57:40.153Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["preview-file-tabs"]
- time: "2026-08-16T16:57:40.153Z"
  kind: "evidence"
  summary: "Task: add a guard to the dev-server/preview start path so a configured dev server (e.g. otto-dev on 8081) started while an Otto dev daemon already owns the port is detected, surfaced to the user, and paused until the user quits the existing daemon, instead of the managed daemon failing while the client half-binds to the pre-existing daemon and a hard reload drops into /setup. Implemented in packages/server/scripts/supervisor-entrypoint.ts (acquirePidLockWithConflictGuard) + new packages/server/src/server/daemon-lock-guard.ts (+ tests). dev-server-manager.ts and preview-tools.ts left unchanged."

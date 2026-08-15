---
id: "startup-splash-precedes-app-runtime"
kind: "requirement"
title: "Startup splash precedes application runtime"
status: "confirmed"
tags: ["startup", "splash", "app-shell", "first-paint"]
created_at: "2026-08-15T06:49:56.871Z"
updated_at: "2026-08-15T06:49:56.871Z"
---

# Startup splash precedes application runtime

<!-- compiled_truth -->

The startup splash is the only application surface mounted for the initial React paint. The application runtime mounts only after host bootstrap is settled, under an opaque splash cover for its first committed frame, so no application UI can appear before the splash.

## Timeline

- time: "2026-08-15T06:49:56.871Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-15T06:49:56.871Z"
  kind: "evidence"
  summary: "User requirement in this conversation (2026-08-15). Implemented in `packages/app/src/app/_layout.tsx` with the mount policy in `packages/app/src/navigation/host-runtime-bootstrap.ts`."

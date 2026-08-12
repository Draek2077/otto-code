---
id: "brain-operations-use-resident-hosted-server"
kind: "requirement"
title: "Brain operations use the resident hosted llama-server"
status: "confirmed"
tags: ["brain", "operations", "llama-server", "logging"]
created_at: "2026-08-12T02:17:07.506Z"
updated_at: "2026-08-12T02:17:07.506Z"
---

# Brain operations use the resident hosted llama-server

<!-- compiled_truth -->

Calibrate, Sweep, and Benchmark are host-owned operations on the Brain service's single resident Supervisor and its hosted llama-server lane. They must not spawn independent llama-server instances or use alternate ports. Because llama.cpp applies context and reasoning-budget settings at launch, calibration and sweep may transition the resident server through configurations, but all launches, request traffic, progress, cancellation, and stdout/stderr remain owned and observable through the one Brain host and Logs surface.

## Timeline

- time: "2026-08-12T02:17:07.506Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-console","brain-host-control"]
- time: "2026-08-12T02:17:07.506Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-11: all operations must run through the one hosted llama-server being observed, with complete tracking and updates."

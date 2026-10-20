---
id: "unused-managed-runtimes-are-user-removable"
kind: "requirement"
title: "Unused managed runtimes are user-removable"
status: "proposed"
tags: ["brain", "runtime", "user-ownership", "lifecycle"]
created_at: "2026-08-14T18:07:51.667Z"
updated_at: "2026-08-14T20:02:17.708Z"
---

# Unused managed runtimes are user-removable

<!-- compiled_truth -->

An Otto-managed runtime that is not the configured runtime remains removable by the user. “Otto managed” identifies the installation owner and source; it is not a retention lock. Removal remains destructive and requires confirmation, and the control must expose the actual reason when the host cannot accept a removal operation.

## Timeline

- time: "2026-08-14T18:07:51.667Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T18:07:51.667Z"
  kind: "evidence"
  summary: "User report and screenshot, 2026-08-14: an unused CUDA 12.4 b10265 Otto-managed runtime was selected for removal but the Remove button stayed disabled. Code inspection found the UI used an unlabelled global Brain-job busy state even though only the configured runtime was excluded from removable choices. Existing CLI contract: packages/brain/src/commands/runtime.ts removes one Otto-managed runtime."
- time: "2026-08-14T19:53:59.528Z"
  kind: "evidence"
  summary: "Direct verification on 2026-08-14: the selected dev runtime removal reached the resident Brain host and failed with `EPERM: operation not permitted, scandir ...cuda-12-4-managed-b10357`. The host job recorded the failure. Read-only inspection showed that directory was owned by `BUILTIN\\\\Administrators` and the normal Otto process could not enumerate it, so this specific failure is Windows filesystem access, not an Otto-managed retention rule. The UI now keeps that job failure visible inline and gives a permission/process recovery message."
  source: "Dev host job endpoint `https://127.0.0.1:1234/__host/jobs`; filesystem inspection of packages/desktop/.dev/otto-home/otto-brain/runtimes/cuda-12-4-managed-b1035"
- time: "2026-08-14T20:02:17.708Z"
  kind: "evidence"
  summary: "Windows elevation recovery is implemented as a local-desktop-only retry after an EPERM/EACCES/EBUSY removal failure. The Electron main process validates a filesystem-safe runtime name and scopes the elevated PowerShell operation to one direct child of OTTO_HOME/otto-brain/runtimes; it does not elevate Otto or accept an arbitrary path/command. Targeted helper/UI tests and desktop typecheck passed. The page remains proposed pending product confirmation."
  source: "Implementation verification 2026-08-14"

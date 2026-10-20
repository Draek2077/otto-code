---
id: "finding-paseo-forge-account-identity-gap"
kind: "finding"
title: "Paseo Forge resolves hosts but leaves GitHub account identity implicit"
status: "proposed"
tags: ["forge","git","github","authentication","paseo","upstream"]
created_at: "2026-09-09T12:43:09.988Z"
updated_at: "2026-09-09T12:43:09.988Z"
---
# Paseo Forge resolves hosts but leaves GitHub account identity implicit

<!-- compiled_truth -->

Source inspection of Paseo main at fdf3b4b47f1aae0f4f44e8c97210f8b907159edb (2026-09-09; package version 0.8.0-beta.1) found the same repository-account gap discussed in Otto. This is a static-code finding, not a live multiple-account reproduction.

The upstream Forge layer lives in packages/server/src/services/forge-{service,registry,resolver,cli-command}.ts, the provider adapters github-service.ts, gitlab-service.ts and gitea-service.ts, packages/protocol/src/forge-manifest.ts, and packages/app/src/git/forges/. Its architecture guide is docs/forge-providers.md. ForgeResolution contains forge, host and a shared service, with no account identity. GitHub's command wrapper applies GH_HOST for host routing but does not select a repository-specific account. SSH alias resolution reads HostName via ssh -G; it does not identify the authenticated SSH account. GitHub's isAuthenticated calls gh auth status.

Upstream's newer GitHub PR polling groups repositories by host and executes each batch using the first entry's cwd. Rate-limit pauses are also keyed by host. Consequently, adding account selection only to individual gh invocations would leave mixed-account batches unresolved; any future account-aware design must address batch and rate-limit ownership too. This is an implementation implication, not a selected implementation plan.

Otto's current forge-resolver.ts differed from the pinned upstream file only in package naming and comments. The shared-service pattern itself does not require a single account; the missing piece is explicit operation identity and credential selection. A fresh upstream merge does not, on the inspected GitHub path, provide that selection.

## Timeline

- time: "2026-09-09T12:43:09.988Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["background-forge-authorization-is-user-initiated-and-repository-aware","upstream-mergeability-through-otto-owned-seams"]
- time: "2026-09-09T12:43:09.988Z"
  kind: "evidence"
  summary: "Read 12 pinned upstream files via GitHub contents API on 2026-09-09. Latest main: https://github.com/getpaseo/paseo/commit/fdf3b4b47f1aae0f4f44e8c97210f8b907159edb . Key source: services/forge-resolver.ts lines 12-18 and 120-132; services/github-service.ts lines 1298-1313, 1472-1511, 1548-1560, 1648-1655, 2527-2540 and 3903-3933; utils/ssh-hostname.ts lines 31-70, under packages/server/src at that commit. Compared local resolver using git diff --no-index. Upstream history attributes the pluggable Forge introduction to commit a8ebd390fabb88e00b1c2d54890b6cf758eeb103 / PR #1913, dated 2026-07-17. Latest stable release reported by GitHub was v0.7.2; latest prerelease was v0.8.0-beta.1. No upstream code was executed or merged."

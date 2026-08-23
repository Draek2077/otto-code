---
id: "otto-brain-package-integration"
kind: "project"
title: "otto-brain to @otto-code/brain package integration"
status: "proposed"
tags: ["brain","packaging","migration","cli","runtime","historical"]
delivery_status: "complete"
progress_completed: 9
progress_total: 9
progress_unit: "phases"
created_at: "2026-08-23T03:02:59.281Z"
updated_at: "2026-08-23T03:02:59.281Z"
---
# otto-brain to @otto-code/brain package integration

<!-- compiled_truth -->

Historical charter, migrated from `packages/brain/docs/integration-notes.md` during the 2026-08-22 repository file-hygiene sweep. The work described here has shipped; this page is retained as the record of what was decided and why.

## Mission

Refactor the standalone `otto-brain` tool in place so it is designed and coded like a first-class Otto product: a workspace package (`@otto-code/brain`) that installs, builds, deploys, and is configured exactly like the rest of the suite. Step one was a refactor in place; step two physically moved the tree into `packages/brain`, deliberately kept to a `git mv` plus workspace wiring rather than a rewrite.

The product promise: a user runs **local AI with no other software required**. Brain provides its own llama.cpp runtime and downloads its own models. It can be **managed by the Otto daemon** or **run standalone**, including on a separate server. Local access is simple; remote access is the same design with a bind address and auth. The local brain is **opt-in**: Otto does not start it by default.

## Target conventions adopted

| Axis | Before | Adopted |
| --- | --- | --- |
| Language / module | CJS `.js`, `'use strict'`, `require` | TS `.ts`, ESM (`"type":"module"`), `import … from "./x.js"` |
| Package | `otto-brain`, no deps | `@otto-code/brain`, AGPL-3.0-or-later, standalone NodeNext tsconfig mirroring `packages/relay` |
| Entry | `main: src/index.js` | `bin/otto-brain` for standalone, plus a commander group `createBrainCommand()` lifted into `packages/cli` |
| CLI | hand-rolled `parseArgs`, handlers logging directly | commander program, `src/commands/*`, handlers returning `{type,data,schema}`, `withOutput` renderer, `@clack/prompts` interactive, chalk only in renderers |
| Config | repo-local `config/profiles.json` | `$OTTO_HOME/otto-brain/`, zod `version:1`, camelCase, atomic private writes (`0600`), merge order CLI to env to file to default |
| Env | `OTTO_BRAIN_*` | kept `OTTO_BRAIN_*` and honors `OTTO_HOME` |
| Tooling | none | oxlint + oxfmt, `tsgo --noEmit` |
| Tests | `node:test` in `test/` | vitest, colocated `src/*.test.ts` |

## Architecture decided

**Package and CLI shape.** `@otto-code/brain` exports its library modules and `createBrainCommand(): Command`. `packages/cli` calls `program.addCommand(createBrainCommand())`, mirroring `createDaemonCommand()`. A thin `bin/otto-brain` remains for standalone and remote use where the full `otto` CLI is absent.

**Service model.** The service surface is the HTTP router (a reverse proxy in front of `llama-server`) plus the supervisor. It runs headless with a pid/lock file following the daemon's pattern, writing `$OTTO_HOME/otto-brain/otto-brain.pid` and `otto-brain.log`. The Otto daemon can spawn it as a managed child when opted in, passing `OTTO_HOME` and bind config on the child env. The same `otto brain start` works on a bare server, binding `--host/--port` (default `127.0.0.1`), requiring auth when exposed non-locally.

**Opt-in default.** Otto ships with the local brain disabled. A config key gates auto-start; the daemon only spawns and monitors brain when the user opts in. Standalone `otto brain start` is always explicit and therefore always allowed.

**Self-contained runtime.** "Where does `llama-server` come from" sits behind a runtime provider interface with two implementations: `lmstudio` discovers LM Studio's vendored runtimes as a zero-download fast path, and `managed` downloads a pinned llama.cpp build into `$OTTO_HOME/otto-brain/runtimes/<label>/` including the matching `vendor/` DLL directory, preserving the DLL-stub fix. Default prefers managed and falls back to LM Studio discovery. The `nvidia-smi` GPU probe stays discovery-only: it ships with the NVIDIA driver, is not software to install, and its absence returns `null`.

## Outcome

All nine phases landed, and step two (the physical move) completed. Verified on 2026-08-22: `packages/brain` is `@otto-code/brain`, `type: module`, AGPL-3.0-or-later, with `bin/otto-brain`, a TypeScript `src/` carrying `commands/`, `runtime/`, `service/`, `ops/`, `output/`, `models/`, `tui/`, colocated vitest specs, and registration in the root `workspaces` array. `config/profiles.json` is gone from the package, consistent with profile state moving under `$OTTO_HOME`.

## Resolved during the effort

Remote auth is a bearer token / API key. `auth.mode=token` gates every route but `/health`, accepting `Authorization: Bearer`, `x-api-key`, or `x-otto-brain-token`. Combined with built-in TLS (`files` / `self-signed` / `tailscale`), this retired the separate `otto-brain-relay`, because the brain terminates HTTPS itself.

## Handed onward, not closed here

- Whether the brain registers itself with the daemon or the daemon owns the child and the address. The lean was that the daemon owns the managed child while a standalone or remote brain is configured by address on the Otto side. Daemon-managed lifecycle and tray/Settings control are chartered separately; see [[brain-host-control]] and [[remote-brain-functionality-is-host-owned-and-connection-neutral]].
- The payload transform carried by the old relay, which lifted images out of Anthropic `tool_result` blocks because LM Studio's server rejected them. Because the brain fronts its own `llama-server` rather than LM Studio's, the quirk may not apply. The charter required running a real `/v1/messages` request with an image inside a `tool_result` against a supervised `llama-server` and porting the transform only if it returned 400.

Related: [[brain-managed-process-pool]], [[managed-model-server-runtimes]], [[brain-model-bundles]], [[managed-llama-runtime-build-selection]].

## Timeline

- time: "2026-08-23T03:02:59.281Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-23T03:02:59.281Z"
  kind: "evidence"
  summary: "Source document: `packages/brain/docs/integration-notes.md` (192 lines), added by commit b8fcc7bd1 (2026-08-03), last describing itself as \"in progress (Phase 0 complete)\" on branch `refactor/otto-code-brain` from baseline commit `6d1fe4c`. Removed from the package tree during the 2026-08-22 file-hygiene sweep because a stale in-progress charter inside a package docs directory contradicted the shipped state and sat outside the knowledge store.\n\nCompletion verified 2026-08-22 by direct inspection: `packages/brain/package.json` reports name `@otto-code/brain`, `type: \"module\"`, license `AGPL-3.0-or-later`, and `bin.otto-brain`; `packages/brain/src/` contains `cli.ts`, `run.ts`, `index.ts`, `main.ts`, and the `commands/`, `runtime/`, `service/`, `ops/`, `output/`, `models/`, `bench/`, `tui/`, `config/` directories with colocated `gguf.test.ts` and `sysmon.test.ts`; the root `package.json` `workspaces` array includes `packages/brain`. Every \"Target\" column value in the charter's conventions table is satisfied."

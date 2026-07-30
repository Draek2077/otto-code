# otto-brain → @otto-code/brain integration charter

**Status:** in progress (Phase 0 complete). **Branch:** `refactor/otto-code-brain`.
**Baseline commit:** `6d1fe4c` on `master`.

## Mission

Refactor otto-brain in place so it is designed and coded like a first-class Otto
product: a workspace package (`@otto-code/brain`) that installs, builds, deploys,
and is configured exactly like the rest of the suite. This is **step one — a
refactor in place**. Step two (a separate effort) physically moves the tree into
`repos/otto-code/packages/brain`. Everything here is chosen so that step two is a
`git mv` plus workspace wiring, not a rewrite.

The product promise: a user runs **local AI with no other software required** —
otto-brain provides its own llama.cpp runtime and downloads its own models. It can
be **managed by the Otto daemon** (brought up alongside Otto like the daemon
manages its own children) **or run standalone**, including on a separate server.
Local access is simple; remote access is the same design with a bind address and
auth. The local brain is **opt-in**: Otto does not start it by default.

## Target conventions (from surveying repos/otto-code)

| Axis              | Today                                                      | Target (otto convention)                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / module | CJS `.js`, `'use strict'`, `require`                       | TS `.ts`, ESM (`"type":"module"`), `import … from "./x.js"`, no `'use strict'`                                                                                                           |
| Package           | `otto-brain`, no deps                                      | `@otto-code/brain`, AGPL-3.0-or-later, `publishConfig.access: public`, standalone NodeNext `tsconfig` (mirrors `packages/relay`)                                                         |
| Entry             | `bin`-less, `main: src/index.js`                           | `bin/otto-brain → dist/index.js` for standalone dev; primary surface is a commander command group `createBrainCommand()` lifted into `packages/cli`                                      |
| CLI               | hand-rolled `parseArgs`; `cmd*` fns `console.log` directly | `commander` program; `src/commands/*`; handlers return `{type,data,schema}`; `withOutput` wrapper renders table/json/yaml; `@clack/prompts` for interactive; chalk only in renderers     |
| Config            | repo-local `config/profiles.json`                          | `$OTTO_HOME/otto-brain/` — resolve `OTTO_HOME` like otto (`~/.otto`, `0700`); zod schema `version:1`; camelCase keys; atomic private writes (`0600`); merge `CLI → env → file → default` |
| Env               | `OTTO_BRAIN_*`                                             | keep `OTTO_BRAIN_*` namespace (like `OTTO_RELAY_*`) + honor `OTTO_HOME`                                                                                                                  |
| Tooling           | none                                                       | oxlint + oxfmt (no eslint/prettier); `tsgo --noEmit` typecheck                                                                                                                           |
| Tests             | `node:test` in `test/`                                     | vitest, `src/*.test.ts` colocated                                                                                                                                                        |
| Scripts           | ad-hoc npm scripts                                         | `clean`/`build`/`build:clean`/`prepack`/`typecheck`/`test` matching every otto leaf                                                                                                      |

Reference sources: `packages/relay` (leaf-package template), `packages/cli`
(command structure + output layer), `packages/server/src/server/{otto-home,
private-files,persisted-config,config}.ts` (config), root `.oxlintrc.json` /
`.oxfmtrc.json` / `tsconfig.base.json`.

## Architecture

### Package & CLI shape

- `@otto-code/brain` exports its library modules **and** `createBrainCommand(): Command`.
- In `packages/cli`, `program.addCommand(createBrainCommand())` exposes it as
  `otto brain <verb>` (the chosen integration, mirroring `createDaemonCommand()`).
- A thin `bin/otto-brain` stays for standalone/remote use where the full `otto`
  CLI is not installed.
- Command verbs (map of today's commands):
  - `otto brain start` / `stop` / `status` / `restart` — **service lifecycle** (new).
  - `otto brain serve` — run the router+supervisor in the foreground (today's `serve`).
  - `otto brain scan` / `models` — list detected + downloadable models (with ranking).
  - `otto brain pull <model>` — download a model (new; wired to the catalog).
  - `otto brain runtime install` — fetch/vendor the llama.cpp runtime (new).
  - `otto brain calibrate` / `sweep` / `bench` / `rescore` / `report` — as today.
  - `otto brain ui` (or bare `otto brain`) — the full-screen TUI (kept, ported to TS).

### Service model (managed OR standalone, local OR remote)

otto-brain's service surface is the existing HTTP router (reverse proxy in front of
`llama-server`) plus the supervisor. As a service it must:

- **Run headless** with a pid/lock file and clean start/stop/status, following the
  daemon's pattern (`pid-lock.ts`, `otto.pid`). Brain writes
  `$OTTO_HOME/otto-brain/otto-brain.pid` (host/port/pid) and `otto-brain.log`.
- **Be daemon-manageable.** The Otto daemon can spawn otto-brain as a managed child
  when opted in, passing `OTTO_HOME` and bind config on the child env (mirrors how
  the CLI spawns the daemon in `local-daemon.ts`). The daemon tracks health and can
  stop it.
- **Be standalone / remote.** The same `otto brain start` works on a bare server: it
  binds `--host/--port` (default `127.0.0.1`; set to `0.0.0.0` for remote), and when
  exposed non-locally requires auth (shared secret / token, matching how the daemon
  gates remote access). Clients (Otto, otto-code providers) point at
  `http://host:port` regardless of where it runs.

### Opt-in default

- Otto ships with the local brain **disabled**. A config key gates auto-start, e.g.
  `brain.enabled: false` (and/or `brain.autoStart`). The daemon only spawns/monitors
  otto-brain when the user opts in. Standalone `otto brain start` is always explicit
  and therefore always allowed.

### Config (`$OTTO_HOME/otto-brain/`)

- `config.json` — service + defaults: `version:1`, `enabled`, `autoStart`,
  `listen` (`{host,port}`), `auth`, `runtime` (path/preference), `modelsDir`,
  `defaultModel`, per-field defaults (cache types, flashAttention, reasoningBudget…).
- `profiles.json` — per-model profiles + calibrations + geometry (today's
  `config/profiles.json`, migrated once on first run).
- `catalog.json` — the download catalog (today's `config/downloads.json`), the
  source of truth for `otto brain pull`.
- All zod-validated, camelCase keys, atomic private writes.

### Self-contained runtime + models (the "no other software" promise)

- **Runtime provider interface.** Abstract "where does `llama-server` come from"
  behind a source interface with two implementations:
  1. `lmstudio` — discover LM Studio's vendored runtimes (today's `backend.js`),
     kept as a zero-download fast path when present.
  2. `managed` — otto-brain downloads a pinned llama.cpp build into
     `$OTTO_HOME/otto-brain/runtimes/<label>/`, including the matching `vendor/`
     DLL dir, and puts both on `PATH` (preserving the DLL-stub fix documented in
     `backend.js`). This is what makes otto-brain need nothing else installed.
     Preference/resolution order is configurable; default prefers a managed runtime,
     falls back to LM Studio discovery.
- **Model provider.** `modelsDir` defaults under `$OTTO_HOME/otto-brain/models/`,
  with LM Studio's `~/.lmstudio/models` as an additional discovery source. `otto
brain pull` downloads from the catalog into the managed dir; `scan` unions both.
- GPU probe (`nvidia-smi`) stays a discovery-only dependency: it ships with the
  NVIDIA driver, is not "software to install," and its absence returns `null`
  (CPU/other GPUs still work).

## Module migration map

| Today (`src/*.js`)                                      | Target (`src/**/*.ts`)                           | Notes                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `index.js` (dispatch + arg parser)                      | `index.ts` + `run.ts` + `cli.ts` + `commands/*`  | Split; commander + output layer. **Touches models/scan — sequence after the other agent's ranking work lands.** |
| `backend.js`                                            | `runtime/{index,lmstudio,managed}.ts`            | Becomes the runtime provider interface.                                                                         |
| `models.js`                                             | `models/{scan,catalog}.ts`                       | **Other agent is adding ranking here — do last, rebase onto their change.**                                     |
| `gguf.js`                                               | `gguf.ts`                                        | Preserve bounded-reader header comments.                                                                        |
| `gpu.js`                                                | `gpu.ts`                                         | —                                                                                                               |
| `vram.js`                                               | `vram.ts`                                        | Preserve the "formula is a bound" header.                                                                       |
| `profiles.js`                                           | `config/profiles.ts`                             | Store moves under `$OTTO_HOME/otto-brain/`.                                                                     |
| `supervisor.js`                                         | `service/supervisor.ts`                          | —                                                                                                               |
| `router.js`                                             | `service/router.ts`                              | Add auth for remote.                                                                                            |
| `scheduler.js`                                          | `service/scheduler.ts`                           | —                                                                                                               |
| `calibrate.js` / `sweep.js`                             | `ops/{calibrate,sweep}.ts`                       | —                                                                                                               |
| `sysmon.js` / `report.js` / `results.js` / `archive.js` | `ops/*.ts`                                       | —                                                                                                               |
| `bench/*`                                               | `bench/*.ts`                                     | **Other agent just updated the bench system — port last, verbatim behavior.**                                   |
| `tui/{screen,app}.js`                                   | `tui/{screen,app}.ts`                            | Kept as the signature interactive experience.                                                                   |
| `config/profiles.json`, `config/downloads.json`         | seed data migrated into `$OTTO_HOME/otto-brain/` | One-time migration.                                                                                             |

## Phased plan

- **Phase 0 — Safety.** ✅ `.gitignore`, baseline commit `6d1fe4c`, branch
  `refactor/otto-code-brain`.
- **Phase 1 — Package & tooling.** `package.json` → `@otto-code/brain` + deps;
  `tsconfig.json`; `bin/otto-brain`; local `.oxlintrc.json` / `.oxfmtrc.json`;
  vitest. **Flipping `"type":"module"` is the breaking step — gated on the other
  agent finishing.**
- **Phase 2 — Config subsystem.** `src/config/*` (otto-home, private-files, config
  schema) + one-time migration. Additive; collision-free.
- **Phase 3 — Service layer.** pid/lock, `start/stop/status`, daemon-spawn
  contract, remote bind + auth, opt-in gate.
- **Phase 4 — CLI restructure.** commander + output layer + `commands/*`.
- **Phase 5 — Port core modules to TS/ESM.** Preserve the load-bearing header
  comments (DLL-stub trap, KV overestimate, reasoning-only failure). Runtime
  provider interface.
- **Phase 6 — Self-contained runtime + model download.** `managed` runtime fetch;
  `otto brain pull`; catalog wiring.
- **Phase 7 — TUI port to TS.**
- **Phase 8 — Tests → vitest.**
- **Phase 9 — Docs.** Rewrite `CLAUDE.md` to otto conventions; fold this charter's
  durable facts into a docs page at merge time.

## Merge-time wiring (step two, not now)

Add `packages/brain` to root `workspaces`; register in `release:check` /
`release:publish*` / `:beta` chains, `knip.json`, and (if consumed in tests)
`vitest.config.ts`; `program.addCommand(createBrainCommand())` in `packages/cli`;
`brain.*` config keys into the daemon's `PersistedConfigSchema` (or keep the brain's
own config file and have the daemon read `enabled`/`autoStart`).

## Coordination notes

- Another agent updated the **benchmark system** and is finishing a **model-ranking
  display** in the model list (sort by rank). Until confirmed done, do **not** edit
  `src/models.js`, the `scan` path in `src/index.js`, `src/bench/*`, or `results/`.
  Everything else is free.
- otto-brain is NOT a git repository under otto-code; it has its own `.git`. Keep it
  that way until step two.

## Open questions

- Auth mechanism for remote brain: **resolved — a bearer token / API key.**
  `auth.mode=token` gates every route but `/health`, accepting `Authorization:
Bearer`, `x-api-key`, or `x-otto-brain-token`. Combined with built-in TLS
  (`config.tls`), this retires `otto-brain-relay`: the brain terminates HTTPS
  itself (`files` / `self-signed` / `tailscale`). See `CLAUDE.md` "Built-in HTTPS".
- Does the brain register itself with the daemon (service discovery), or does the
  daemon own the child and the address? (Lean: daemon owns the managed child; a
  standalone/remote brain is configured by address on the Otto side.) The
  daemon-managed lifecycle + Otto tray/Settings control is chartered separately at
  `projects/brain-host-control/`.
- **Payload transform — verify before porting.** The relay existed partly to lift
  images out of Anthropic `tool_result` blocks, which **LM Studio's server**
  rejects. The brain fronts its **own** `llama-server` (llama.cpp) via the
  supervisor, not LM Studio's server, so the quirk may not apply. Before porting
  the ~200-line transform into `router.ts`, run a real `/v1/messages` request with
  an image inside a `tool_result` against a supervised `llama-server` and observe
  whether it 400s. Port only if it does.

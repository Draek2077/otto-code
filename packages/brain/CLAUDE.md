# CLAUDE.md

This file guides Claude Code when working in the otto-brain package.

## What this is

`@otto-code/brain` - a self-contained host for local GGUF models on llama.cpp's
`llama-server`, built as an Otto suite package. It runs as a service the Otto
daemon can bring up and manage (like the daemon manages its own children) **or**
standalone, including on a separate server. It is **opt-in**: Otto ships with the
local brain off and never auto-starts it.

Its reason for existing is two hard problems it solves empirically:

1. **VRAM budgeting** - the theoretical KV-cache formula overestimates badly (~4x
   on architectures that only keep a full cache on a subset of layers), so the tool
   _measures_ real bytes/token (`calibrate`) and refuses to start a model that won't
   fit.
2. **Reasoning-budget control** - thinking models default to an unrestricted budget
   (`-1`) and will spend an entire token allowance reasoning, returning zero
   content. The tool caps that budget (`sweep`), measures the best cap per model,
   and watches live traffic for the failure recurring (the router's telemetry).

**Self-contained**: it can download its own llama.cpp runtime (`otto brain runtime
install`) and its own models (`otto brain pull`), so nothing else needs installing.
LM Studio's runtime and model library are used as a zero-download fast path when
present, but are not required.

## History

This package began life as a standalone Node-stdlib tool ("otto-brain") and was
refactored into an Otto suite package, then merged here. The integration record -
architecture rationale, module map, and remaining follow-ups (daemon-managed
lifecycle, the full `vitest run` teardown) - lives in
[docs/integration-notes.md](docs/integration-notes.md). The download catalog is
seeded from [docs/candidate-models.md](docs/candidate-models.md).

## Commands

```bash
otto brain                     # interactive TUI (needs a TTY; see the Windows note)
otto brain scan                # list detected models
otto brain serve --model X     # host a model in the foreground
otto brain start [--model X]   # start the service detached
otto brain restart [--model X] # stop (if running) then start detached
otto brain stop | status       # lifecycle over the pid file
otto brain calibrate --model X # measure real KV bytes/token
otto brain sweep --model X     # find + save the best reasoning budget
otto brain pull <model>        # download a model from the catalog
otto brain runtime install     # download a self-contained llama.cpp runtime
otto brain config show | set <key> <value>
```

**Windows: the TUI cannot run under the desktop app's bundled `otto`.** That shim
executes the CLI inside `Otto.exe` with `ELECTRON_RUN_AS_NODE=1`, and `Otto.exe` is
an `IMAGE_SUBSYSTEM_WINDOWS_GUI` binary. Measured in a freshly allocated console,
it reports `stdout.isTTY=false` and `stdin.isTTY=false` where `node.exe` in that
same console reports `true` for both. `stdin` is the fatal half: `tui/screen.ts`
needs `setRawMode` and there is no console input to switch. This is not a PATH or
terminal problem and no launcher change fixes it while `Otto.exe` is the only Node
host in the installer. `commands/ui.ts` detects this case and points at the npm CLI
(`npm i -g @otto-code/cli`), which runs on console-subsystem `node.exe`. Every
non-interactive verb works fine through the bundled shim.

Standalone (no full CLI installed): the same verbs are on `bin/otto-brain`
(`otto-brain serve …`). Every non-interactive command supports `--format
table|json|yaml`, `--json`, `--quiet`, `--no-headers`, `--no-color`.

Dev/build:

```bash
npm run build --workspace=@otto-code/brain      # tsc -> dist/
npm run typecheck --workspace=@otto-code/brain  # tsgo --noEmit
npx vitest run packages/brain/src/vram.test.ts  # run one test file
npm run lint -- packages/brain                   # oxlint (root)
npm run format:files -- packages/brain           # oxfmt (root)
```

## Architecture

`src/main.ts` is the executable entry (runs the standalone CLI); `src/index.ts` is
the library barrel (`createBrainCommand()` mounts the group into the main `otto`
CLI). `src/cli.ts` builds the commander tree; `src/run.ts` is the standalone runner.

**CLI (`src/commands/`, `src/output/`)** - commander commands that return typed
`{type,data,schema}` results; `src/output/with-output.ts` renders table/json/yaml.
Handlers never print or call chalk directly (chalk lives only in
`src/output/render.ts`); they express color declaratively via `ColumnDef.color`.
Errors are thrown as `CommandError` and rendered to stderr.

**Config (`src/config/`)** - resolves `$OTTO_HOME` exactly like the daemon
(`otto-home.ts`), stores everything under `$OTTO_HOME/otto-brain/` (`config.json`,
`profiles.json`, `catalog.json`) with zod schemas, atomic private writes
(`private-files.ts`), and `CLI → env → file → default` precedence (`env.ts`, the
`OTTO_BRAIN_*` namespace). `profiles.ts` holds per-model profiles + the
measured-calibration lookup keyed by cache types and attention geometry.

**Discovery** - `gguf.ts` (bounded GGUF header reader), `models/` (walks the model
dirs, pairs vision projectors, sums shards; `scanModels` unions the managed dir and
LM Studio), `gpu.ts` (`nvidia-smi`, returns null when absent).

**Decision** - `vram.ts` (`budget()`/`maxContextThatFits()`/`fitToBudget()`; the
theoretical formula is a bound, calibration is preferred).

**Runtime (`src/runtime/`)** - a provider interface over "where does llama-server
come from": `lmstudio.ts` (discover an install; **the DLL-stub trap is documented
here - a runtime is always paired with its vendor dir**) and `managed.ts` (download
a pinned build into `$OTTO_HOME/otto-brain/runtimes/`, extracting with OS built-ins
only). `args.ts` builds the child args/env; `index.ts` resolves a runtime per config.

**Service (`src/service/`)** - `supervisor.ts` (owns the `llama-server` child as an
EventEmitter state machine, polls `/health`, samples VRAM at ready), `router.ts`
(HTTP reverse proxy: 503+retry-after while loading, tees completions and classifies
verdicts for both Anthropic and OpenAI shapes, `Telemetry`), `scheduler.ts` (queues
model switches in turns), `serve.ts` (binds the service, VRAM fit, remote auth +
non-loopback guard, TLS termination, pid file), `tls.ts` + `tailscale.ts`
(HTTPS in-process - see below), `pid-lock.ts` (`otto-brain.pid` lifecycle).

**Built-in HTTPS (`config.tls`)** - the brain terminates TLS itself so it can be
exposed securely with **no relay in front** (it supersedes the standalone
`otto-brain-relay`). Four modes: `off` (plain HTTP, the loopback-safe default),
`files` (bring your own cert/key), `self-signed` (generated + cached under
`$OTTO_HOME/otto-brain/certs`, via the `selfsigned` dep - the one non-stdlib
reason for it), and `tailscale` (a real Let's Encrypt cert for this machine's
MagicDNS name issued/renewed via `tailscaled`, hot-swapped on renewal without
dropping connections). `listen.host: "tailscale"` binds the tailnet IP only.
Auth is orthogonal to transport: a non-loopback bind still requires `auth.mode=token`
regardless of TLS, and `auth` accepts `Authorization: Bearer`, `x-api-key`, or
`x-otto-brain-token`. Config keys: `tls.mode`, `tls.certFile`/`keyFile`,
`tls.hostname`, `tls.certDir`, `tls.renewBeforeDays`, `tls.tailscaleExe`.

**Daemon-side trust (brain.mode=remote).** The daemon's `BrainManager` authenticates a
remote brain's certificate before sending it anything, because the auth token rides in
the request headers. By default the certificate must validate against the system trust
store (fits `files` and `tailscale` modes). For a `self-signed` brain, set
`brain.remote.certFingerprint` to the certificate's SHA-256 fingerprint (openssl's
colon form or bare hex); the daemon then pins the connection to exactly that
certificate and hands the socket to the request only after the fingerprint matches.
Never reintroduce a blanket `rejectUnauthorized: false` on the remote path: it lets
any on-path peer answer the handshake and read the token. Only the daemon's loopback
probe of its own local child keeps the relaxed check, since that traffic never leaves
the machine.

**Ops (`src/ops/`)** - `calibrate.ts`, `sweep.ts`, `results.ts`, `report.ts`,
`archive.ts`. **Bench (`src/bench/`)** - the agentic-coding benchmark suite.

**TUI (`src/tui/`)** - `screen.ts` is a dependency-free ANSI toolkit; `app.ts` wires
the discovery/decision/runtime modules to an editable config screen with an embedded
router+supervisor.

## Conventions

- Every module is ESM TypeScript. Relative imports carry `.js` extensions (NodeNext).
  No `'use strict'`. Interfaces (not `type`) for object shapes; no `any` (oxlint).
- **Preserve the header comments** - they carry hard-won empirical facts (the
  DLL-stub trap, the KV overestimate ratio, the reasoning-only failure). Do not
  paraphrase them away in a port.
- Discovery functions return `null`/empty on absence rather than throwing; the CLI
  layer decides whether absence is fatal (a `CommandError`).
- Byte quantities are raw bytes internally; format only at the edge
  (`vram.formatGiB`, `models.formatBytes`).
- Config lives at `$OTTO_HOME/otto-brain/`, never repo-local. Resolve `OTTO_HOME`
  through `src/config/otto-home.ts` so it tracks both the installed and dev homes.
- Tests are vitest, colocated as `src/**/*.test.ts`. They cover the pure logic
  (`vram`, `gguf`, `router.analyse`), not the process-spawning paths.
- The local brain is opt-in: never make Otto auto-start it. `config.enabled` /
  `config.autoStart` gate daemon management; standalone `start` is always explicit.

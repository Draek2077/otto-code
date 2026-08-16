# Configuration systems

Everything that drives Otto from outside its code boundary. Configuration is layered by _who
writes it_ and _where it lives_. From outermost to innermost: environment variables (operator),
persisted daemon config (operator + settings UI), per-workspace files (repo authors), and
device-local client settings (each user's device). A fifth family — build/deploy config — shapes
the binaries before they ever run.

The important asymmetry: daemon config is _shared truth_ pushed to every client; device settings
are _private per device_ and never sync to the daemon.

Precedence: _environment > persisted config > built-in default_.

## The five layers

| Layer                           | Who writes it          | Where it lives                                                               | Notes                                                              |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Environment variables        | Operator               | `OTTO_*` in the process env                                                  | The only layer that can precede config loading itself.             |
| 2. Daemon config                | Operator + settings UI | `$OTTO_HOME/config.json`                                                     | Strict versioned on-disk shape + runtime projection; hot-reloaded. |
| 3. Per-workspace files          | Repo authors           | `.claude/launch.json`, `otto.json`, provider-native files                    | Repo-scoped, not synced.                                           |
| 4. Device-local client settings | Each user's device     | AppSettings (AsyncStorage) + saved host connections                          | Never synced to the daemon.                                        |
| 5. Build & deploy config        | Maintainers            | `eas.json`, `electron-builder.yml`, `wrangler.toml`, `playwright*.config.ts` | Shapes the binaries.                                               |

## Layer 1 — Environment variables (`OTTO_*`)

The operator's override channel and the only layer that can precede config loading itself. The
appendix below is the complete per-variable index (purpose, value format, default, consumer).
Conventions: _booleans_ accept `1/true/yes/y/on` and `0/false/no/n/off`; paths may use `~`; unset
means "fall back to persisted config, then the stated default".

Domain groups give orientation (the appendix is the index): identity & paths (`OTTO_HOME`,
`OTTO_WEB_UI_DIST_DIR`); network (`OTTO_LISTEN`, `OTTO_PASSWORD`, `OTTO_URL` /
`OTTO_DAEMON_URL`); relay (`OTTO_RELAY_*`); service proxy (`OTTO_SERVICE_PROXY_*`); speech & voice
(`OTTO_DICTATION_*`, `OTTO_VOICE_MODE_ENABLED`, `OTTO_SPEECH_*`, `OTTO_LOCAL_MODELS_DIR`); desktop
/ Electron (`OTTO_WEB_PLATFORM`, `OTTO_FORCE_GPU`, `OTTO_ELECTRON_FLAGS`, `OTTO_DESKTOP_MANAGED`);
agent-process context (`OTTO_AGENT_ID`, `OTTO_WORKSPACE_ID`, `OTTO_WORKTREE_PATH`,
`OTTO_BRANCH_NAME` — injected _into_ spawned agent processes and terminal hooks so agents can call
home via `OTTO_ACTIVITY_TOKEN` / `OTTO_TERMINAL_ACTIVITY_URL`); diagnostics (`OTTO_DEBUG`,
`OTTO_LOG_LEVEL`, `OTTO_LOG_FORMAT`, `OTTO_NODE_INSPECT`).

## Layer 2 — Daemon config (`$OTTO_HOME/config.json`)

Two schemas, one file:

- **PersistedConfig** (`server/persisted-config.ts`) — the strict, versioned on-disk shape.
  Top-level sections: `daemon` (listen, allowed hosts, trusted proxies, relay, auth, CORS,
  service proxy, terminal profiles, browser tools, agent behaviors), `providers`, `worktrees`,
  `agents` (custom providers, personalities, teams, model tier overrides, metadata generation),
  `features` (dictation, voice mode, web UI), `gitHosting.providers`, `log`.
- **MutableDaemonConfig** (`packages/protocol`) — the runtime projection clients can read and patch
  over RPC. Hot-reloaded: a deep-merge patch triggers a `daemon_config_changed` push so every
  client converges without reconnecting.

This file is also where _server-side capability data_ lives that shapes agents at spawn time:
custom provider definitions (extending `openai-compatible` or ACP), agent personalities and teams
(snapshotted onto each agent at spawn — later edits don't mutate running agents).

## Layer 3 — Per-workspace files (repo-authored)

| File                   | Role                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/launch.json`  | Preview dev-server registry: named entries (`runtimeExecutable`, `runtimeArgs`, `port`) the preview subsystem may spawn and supervise. The only sanctioned way agents start dev servers.             |
| `otto.json`            | Per-project Otto config (schema in `packages/protocol/src/otto-config-schema.ts`).                                                                                                                   |
| Provider-native config | Files the _providers_ read from the workspace (e.g. `CLAUDE.md`, `~/.claude/settings.json` for model discovery). Otto deliberately does not own these — providers handle their own auth and context. |

## Layer 4 — Device-local client settings

- **AppSettings** — a Zustand store persisted to AsyncStorage (with validation, migration/backfill,
  and corrupt-blob reset). Holds UI preferences and the feature-gate map.
- **Host connections** — the saved list of daemons this device can reach (direct socket, named
  pipe, or relay + keys), the client-side root of trust.
- **Feature gates** (client-side) — `features/feature-catalog.ts` defines a `FeatureId` catalog
  with per-feature defaults; a sparse `featureEnabled` map on AppSettings overrides them. A
  disabled feature stays out of the JS heap via dynamic `import()` boundaries (Metro cannot
  tree-shake on runtime flags — see [feature-flags.md](feature-flags.md)). Never synced to the
  daemon.

> **Two flag systems, do not confuse them.** _Client feature gates_ (above) are per-device UX
> choices. _Daemon capability flags_ (`server_info.features.*`) are compatibility signals — a
> client detects whether the connected daemon supports a feature and either runs it or shows
> "update the host". Capability detection happens once per feature, in one place; there are no
> fallback code paths.

## Layer 5 — Build & deploy config

| File                                                             | Shapes                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/app/eas.json`                                          | Expo Application Services build/submit profiles (mobile) |
| `packages/desktop/electron-builder.yml`                          | Desktop packaging, installers, auto-update               |
| `packages/relay/wrangler.toml`, `packages/website/wrangler.toml` | Cloudflare Worker deploys                                |
| `packages/app/playwright*.config.ts`                             | E2E and demo-capture pipelines                           |
| Root `package.json` scripts + `scripts/`                         | The build graph and release pipeline                     |

## Appendix — `OTTO_*` environment variable reference

Built from an exhaustive sweep of `process.env.OTTO_*` consumers across all packages.

### Operator-facing — core daemon & network

| Variable                                         | Purpose                                                         | Value format                                       | Default when unset                                            |
| ------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `OTTO_HOME`                                      | Otto data/home directory                                        | absolute path or `~/…`                             | `~/.otto`                                                     |
| `OTTO_LISTEN`                                    | Daemon bind address                                             | `host:port`, `/path/socket`, `unix:///path/socket` | `127.0.0.1:6868` (`0.0.0.0:port` under WSL)                   |
| `OTTO_HOST`                                      | CLI's target daemon                                             | `host:port`, `tcp://…`, `unix://…`, `pipe://…`     | autodetect: configured listen → pid socket → `localhost:6868` |
| `OTTO_PASSWORD`                                  | Daemon auth password (hashed server-side); also CLI client auth | string                                             | unset = no password auth                                      |
| `OTTO_SERVER_ID`                                 | Override the daemon's server id                                 | string                                             | generated & persisted                                         |
| `OTTO_PAIRING_QR`                                | Print pairing QR to stdout on start                             | boolean                                            | on when stdout is a TTY                                       |
| `OTTO_PRIMARY_LAN_IP`                            | Override the LAN IP advertised in connection offers             | IP address                                         | auto-detected                                                 |
| `OTTO_HOSTNAMES` / `OTTO_ALLOWED_HOSTS`          | Allowed request hostnames                                       | comma-separated list                               | merged with persisted config                                  |
| `OTTO_TRUSTED_PROXIES`                           | Trusted reverse proxies                                         | `true`, `false`, or comma-separated list           | `loopback`                                                    |
| `OTTO_CORS_ORIGINS`                              | Allowed CORS origins                                            | comma-separated list                               | persisted / none                                              |
| `OTTO_APP_BASE_URL`                              | Base URL used in generated links                                | URL                                                | `https://app.otto-code.me`                                    |
| `OTTO_LOG_LEVEL`                                 | Log verbosity                                                   | `trace`/`debug`/`info`/`warn`/`error`              | persisted / `info`                                            |
| `OTTO_LOG_FORMAT`                                | Log output format                                               | `pretty` / `json`                                  | persisted                                                     |
| `OTTO_NODE_INSPECT`                              | Inspector flag for the supervised daemon                        | Node inspector arg                                 | `--inspect`                                                   |
| `OTTO_LOG_ROTATE_SIZE` / `OTTO_LOG_ROTATE_COUNT` | Supervisor log rotation                                         | size string / positive integer                     | supervisor defaults                                           |

### Operator-facing — relay, proxy & web UI

| Variable                             | Purpose                                                       | Value format                                 | Default when unset                            |
| ------------------------------------ | ------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| `OTTO_RELAY_ENABLED`                 | Enable the relay transport                                    | boolean                                      | `true`                                        |
| `OTTO_RELAY_ENDPOINT`                | Relay the daemon dials                                        | `host:port`                                  | `relay.otto-code.me:443`                      |
| `OTTO_RELAY_PUBLIC_ENDPOINT`         | Relay endpoint advertised to clients                          | `host:port`                                  | = `OTTO_RELAY_ENDPOINT`                       |
| `OTTO_RELAY_USE_TLS`                 | TLS when dialing the relay                                    | boolean                                      | `true` for the default endpoint, else `false` |
| `OTTO_RELAY_PUBLIC_USE_TLS`          | TLS flag advertised to clients                                | boolean                                      | = resolved `useTls`                           |
| `OTTO_RELAY_UPSTREAM`                | Cloudflare-worker cutover: forward all relay traffic upstream | URL                                          | unset = normal routing                        |
| `OTTO_SERVICE_PROXY_ENABLED`         | Enable optional service-proxy layers                          | boolean                                      | enabled                                       |
| `OTTO_SERVICE_PROXY_PUBLIC_BASE_URL` | Public base URL for proxied services                          | URL                                          | unset                                         |
| `OTTO_SERVICE_PROXY_LISTEN`          | Standalone service-proxy listen address                       | `host:port`                                  | unset                                         |
| `OTTO_WEB_UI_ENABLED`                | Serve the bundled web client from the daemon                  | boolean                                      | `false`                                       |
| `OTTO_WEB_UI_DIST_DIR`               | Web-UI dist directory                                         | path (absolute, or relative to `$OTTO_HOME`) | bundled dist                                  |

### Operator-facing — speech, desktop & tuning

| Variable                                                                                                                  | Purpose                                                        | Value format                                | Default when unset                                    |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `OTTO_VOICE_MODE_ENABLED` / `OTTO_DICTATION_ENABLED`                                                                      | Enable voice mode / dictation                                  | boolean                                     | persisted / `true`                                    |
| `OTTO_DICTATION_STT_PROVIDER`, `OTTO_VOICE_STT_PROVIDER`, `OTTO_VOICE_TTS_PROVIDER`, `OTTO_VOICE_TURN_DETECTION_PROVIDER` | Select speech providers                                        | speech provider id (e.g. `local`, `openai`) | `local`                                               |
| `OTTO_VOICE_LLM_PROVIDER`                                                                                                 | Voice-mode LLM provider                                        | agent provider id                           | unset                                                 |
| `OTTO_LOCAL_MODELS_DIR`                                                                                                   | Local speech-model directory                                   | path                                        | `$OTTO_HOME/models/local-speech`                      |
| `OTTO_DICTATION_LOCAL_STT_MODEL`, `OTTO_VOICE_LOCAL_STT_MODEL`, `OTTO_VOICE_LOCAL_TTS_MODEL`                              | Local model selection                                          | model id                                    | built-in defaults                                     |
| `OTTO_VOICE_LOCAL_TTS_SPEAKER_ID` / `OTTO_VOICE_LOCAL_TTS_SPEED`                                                          | Local TTS voice tuning                                         | integer / number                            | persisted / unset                                     |
| `OTTO_DICTATION_LANGUAGE` / `OTTO_VOICE_LANGUAGE`                                                                         | STT language                                                   | language code (`en`, …)                     | default STT language; voice falls back to dictation's |
| `OTTO_DICTATION_TRANSCRIPTION_PROMPT`                                                                                     | STT transcription prompt                                       | string                                      | built-in                                              |
| `OTTO_DICTATION_SILENCE_PEAK_THRESHOLD`                                                                                   | Silence detection threshold                                    | integer                                     | `300`                                                 |
| `OTTO_DICTATION_AUTO_COMMIT_SECONDS` / `OTTO_STT_BATCH_COMMIT_EVERY_SECONDS`                                              | Dictation/STT commit cadence                                   | seconds (number)                            | built-in                                              |
| `OTTO_DICTATION_DEBUG`                                                                                                    | Dictation debug logging + recordings                           | boolean                                     | off                                                   |
| `OTTO_DEBUG`                                                                                                              | Desktop debug mode                                             | `1`                                         | off                                                   |
| `OTTO_FORCE_GPU`                                                                                                          | Skip the desktop GPU-fallback path                             | `1`                                         | off                                                   |
| `OTTO_ELECTRON_FLAGS`                                                                                                     | Extra Chromium switches                                        | space-separated flags                       | none                                                  |
| `OTTO_ELECTRON_USER_DATA_DIR`                                                                                             | Force Electron userData dir                                    | path                                        | auto (per-worktree in dev)                            |
| `OTTO_DISABLE_SINGLE_INSTANCE_LOCK`                                                                                       | Allow multiple desktop instances                               | `1`                                         | off                                                   |
| `OTTO_WEB_PLATFORM`                                                                                                       | Web build target; `electron` selects `.electron.*` Metro files | `electron` or unset                         | plain web                                             |
| `OTTO_GIT_CONCURRENCY`                                                                                                    | Git command concurrency                                        | integer                                     | `8`                                                   |
| `OTTO_ARTIFACT_TIMEOUT_MS`                                                                                                | Artifact generation timeout                                    | integer ms                                  | built-in                                              |
| `OTTO_LINUX_WATCH_READDIR_CONCURRENCY`                                                                                    | Linux watcher readdir concurrency                              | integer                                     | `16`                                                  |

### Injected by Otto into child processes

Set by the daemon (never by operators) so agents, terminals, and workspace scripts can identify
themselves and call home.

| Variable                                                         | Purpose                                                                | Set by               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
| `OTTO_AGENT_ID`                                                  | The agent's own id, in its process env                                 | agent manager        |
| `OTTO_WORKSPACE_ID`                                              | Workspace id for workspace terminals                                   | terminal subsystem   |
| `OTTO_TERMINAL_ID`                                               | Terminal id in terminal child env                                      | terminal manager     |
| `OTTO_ACTIVITY_TOKEN` / `OTTO_TERMINAL_ACTIVITY_URL`             | Auth token + endpoint that shell hooks POST activity to                | terminal manager     |
| `OTTO_HOOK_CLI`                                                  | Path to the `otto` CLI used by shell hooks                             | terminal subsystem   |
| `OTTO_WORKTREE_PATH` / `OTTO_BRANCH_NAME` / `OTTO_WORKTREE_PORT` | Worktree context + per-worktree service port for setup/service scripts | worktree service     |
| `OTTO_PORT` / `OTTO_URL`                                         | A workspace service's own port and proxied URL                         | service env builder  |
| `OTTO_SERVICE_<NAME>_PORT` / `OTTO_SERVICE_<NAME>_URL`           | Peer service ports/URLs (name = uppercased script name)                | service env builder  |
| `OTTO_DESKTOP_MANAGED` / `OTTO_SUPERVISED` / `OTTO_NODE_ENV`     | Process-role markers; stripped from env passed to external children    | desktop / supervisor |
| `OTTO_DESKTOP_CLI`                                               | Marks a CLI invocation as desktop-launched                             | desktop              |

Test-, benchmark-, and capture-harness variables (`OTTO_*_E2E`, `OTTO_BENCHMARK_*`,
`OTTO_PROFILE_*`, `OTTO_CAPTURE_HARNESS_*`, `OTTO_CLI_TEST_*`, `OTTO_MAESTRO_*`, `OTTO_TEST_*`,
`OTTO_ENABLE_MOCK_SLOW`, `OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD`, …) are deliberately excluded from this
reference: they configure test harnesses, not the product. Find them where the harness lives.

## Audit note

`$OTTO_HOME` is the complete state boundary of a daemon: config, agent records, timelines,
accounting stores, keys, logs. Backing it up captures a host; diffing two snapshots of it is a
legitimate audit technique. All stores are schema-validated JSON with atomic writes and _no
migrations_ — see [data-model.md](data-model.md).

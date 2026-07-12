# Mobile daemon

**Status:** Charter — thought-experiment stage, drafted 2026-07-12. Not yet started. Two prerequisites gate the build: the [session-decomposition](../session-decomposition/session-decomposition-plan.md) core/host boundary work and (product pairing, not a hard blocker) [interface-modes](../interface-modes/interface-modes.md).

Run an Otto daemon **on the phone itself**, embedded in the app, so Otto works with no desktop machine at all: sessions, personalities, schedules, remote MCP connectors, speech — an everyday AI assistant powered by cloud APIs (Anthropic, OpenAI-compatible, and friends), talking to the same client UI through the same protocol. Paired with **User mode** from the interface-modes charter, this is Otto's consumer story: phone-only users get a full AI platform; connecting to a desktop host lights up the IDE.

This is the fork's mission read in reverse: instead of bringing frontier-harness tooling to every provider, bring the daemon to every device — and let the capability system express what each device can do.

**Naming (glossary when Phase 2 lands):** the embedded daemon's host entry is labeled **"This device"** in the host list and all UI copy. The extracted platform-agnostic package is **`daemon-core`**. Internal shorthand "mobile daemon" never appears in UI copy — the user sees a host like any other.

---

## The one hard fact this design starts from: the agent CLIs cannot run on phones

- **iOS forbids it outright.** Third-party apps cannot `fork`/`exec` subprocesses — there is no way to spawn Claude Code, Codex, or any CLI. JIT is also disallowed, hobbling a full Node runtime.
- **Android technically allows it, hostilely.** Since targetSdk 29, apps may only execute binaries packaged read-only inside the APK's native lib dir — nothing installed at runtime. Termux sidesteps this with an ancient targetSdk and sideloading; a Play Store app cannot. And the CLIs themselves spawn shells, git, ripgrep — the whole subprocess tree would have to exist.
- Beyond execution, the CLIs assume a dev machine: shells, git repos, `~/.claude` auth state. None of it has meaning on a phone.

So the mobile daemon is **API-native only**. The fork already built the engine: the openai-compat provider's daemon-owned tool loop (fetch-based, daemon-injected Otto tools, compaction, daemon-hosted MCP client, rewind) needs no subprocess. The mobile daemon is that architecture with the Node host stripped away and cloud SDK adapters added — not a degraded Otto, but the natively-tooled track standing alone.

---

## The UX north star

1. **Install the app, open it, and it works.** No host to pair, no QR code, no daemon install. The host list shows **This device** alongside any remote hosts. First launch on a phone with no hosts lands directly in a This-device workspace.
2. **Bring your key, start chatting.** Settings → This device → Providers takes an Anthropic key (or an OpenAI-compatible endpoint — the user's LM Studio over Tailscale works from day one) stored in the platform keychain. Create an agent, chat, use personalities, schedule things, connect remote MCP servers.
3. **It's a real host.** Sessions persist across app restarts. The timeline, compaction, rewind, effort, personalities — everything the openai-compat track does today — works identically. Switching between This device and a desktop host is just switching hosts.
4. **User mode is the natural default here** (open decision 5): a phone-only user gets the chat-first surface; the hidden dev surfaces (git, terminals, files, preview) don't exist on this host anyway, so the lens and the capability set agree.
5. **Honest about limits:** long agent turns pause when iOS suspends the app (a banner explains); anything unattended belongs on a remote host via schedules. The mobile daemon is for interactive use.

---

## Binding constraints (review-rejection criteria, not aspirations)

### 1. One protocol, one client — the embedded daemon is just another transport

The client already abstracts its connection behind `DaemonClientTransport` ([daemon-client-transport-types.ts](../../packages/client/src/daemon-client-transport-types.ts)) with two implementations: WebSocket and relay-E2EE. The embedded daemon is a **third implementation** — an in-memory duplex handing protocol messages directly to daemon-core in the same JS runtime. Concretely:

- **Zero forked client code.** Screens, stores, hooks, and the protocol package are shared byte-for-byte. `rg -i "mobiledaemon|thisdevice" packages/app/src` outside the host-list/transport wiring is a defect.
- **The reduced feature set is expressed only through `server_info.features.*`** — the existing feature-contract machinery. The embedded daemon simply doesn't advertise `terminal`, `checkout.*`, preview, worktrees; the client hides those surfaces the same way it does against an old desktop daemon. No `if (isEmbeddedHost)` branches in feature code, ever.
- **Wire schemas are shared, not duplicated.** The in-memory transport still passes validated protocol messages (Zod parse can be relaxed to a dev-only assertion later for perf, but the message shapes are the contract).

### 2. API-native only — no subprocess assumption anywhere in daemon-core

`daemon-core` never imports `child_process`, `node-pty`, or anything that spawns. Providers in the core are **HTTP-API adapters only** (Anthropic Messages API, OpenAI-compatible; Gemini later). CLI/ACP providers (Claude Code, Codex, Copilot, OpenCode, Pi, cursor/kiro/trae) live in the **node host**, registered by the desktop daemon on top of the core. MCP in the core is **HTTP/SSE remote servers only**; stdio MCP is a node-host registration. Grep is the test: `rg "child_process|node-pty" packages/daemon-core/src` returns nothing, ever.

### 3. Core/host split with enumerated seams — and the desktop daemon is the first host

The extraction is **strictly behavior-preserving for the desktop daemon**, which becomes the first (and initially only) consumer of daemon-core. Platform services the core needs are injected behind narrow interfaces — the complete seam list (anything else importing Node built-ins inside core fails review):

1. `FileStore` — atomic-write JSON persistence (node: `fs` as today; mobile: expo-file-system / react-native-fs).
2. `Fetch` — HTTP(S) + SSE streaming (node: undici; mobile: RN fetch + `react-native-sse`-class streaming, settled by the Phase 2 spike).
3. `SecretStore` — API keys (node: config file as today; mobile: expo-secure-store / Keychain / Keystore).
4. `Clock/Scheduler` — timers + cron evaluation for schedules (mobile fires only while the app is alive in v1).
5. `Logger` — pino on node; console/file ring buffer on mobile.
6. `Notifier` — optional; agent-finished notifications (node: no-op or existing push path; mobile: local notifications).

No seam for terminals, git, preview, browser-tools, speech-local (sherpa-onnx), or computer-use — those subsystems stay **entirely in the node host** and are never referenced by core code.

### 4. Zero regression, zero drag on the desktop daemon

The desktop daemon after extraction is byte-identical on the wire (the session-decomposition dispatch-seam test net is the proof harness). Package layering: `daemon-core` depends on `protocol` only; `server` depends on `daemon-core`. No `react-native` or Expo types anywhere near core. Core is plain TypeScript targeting ES2022 + fetch — runnable on Node, Hermes, or a browser, tested on Node in CI like any other package.

---

## What already exists (the rails we reuse)

| Capability                           | Where                                                                                                                                                | Reuse                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Pluggable client transport           | `DaemonClientTransport` + websocket + relay-E2EE implementations ([packages/client/src](../../packages/client/src/daemon-client-transport-types.ts)) | In-memory transport is a third implementation; client code above it unchanged      |
| Daemon-owned agentic loop, no CLI    | [openai-compat-agent.ts](../../packages/server/src/server/agent/providers/openai-compat-agent.ts) — fetch loop, tool injection, compaction, rewind   | The core's provider blueprint; port it, then add an Anthropic Messages API sibling |
| Otto tool catalog reaching providers | `OttoToolCatalog` in [otto-tools.ts](../../packages/server/src/server/agent/tools/otto-tools.ts), per-group gating                                   | Core registers only mobile-safe groups; node host registers the rest               |
| Daemon-hosted MCP client             | [openai-compat-mcp.ts](../../packages/server/src/server/agent/providers/openai-compat-mcp.ts)                                                        | HTTP/SSE servers work over plain fetch; stdio stays host-side                      |
| Capability flags gating features     | `server_info.features.*` COMPAT-tagged flags in [messages.ts](../../packages/protocol/src/messages.ts)                                               | The embedded daemon advertises its subset; client gating already exists            |
| File-based JSON persistence          | Zod schemas + atomic writes ([docs/data-model.md](../../docs/data-model.md))                                                                         | Same schemas over the `FileStore` seam                                             |
| Multi-host client model              | `h/[serverId]` routing, host list, per-host runtime stores                                                                                           | "This device" is one more host entry with a fixed local id                         |
| Session decomposition                | [session-decomposition-plan.md](../session-decomposition/session-decomposition-plan.md) — per-domain controllers with narrow Host seams              | The controller boundaries ARE the core/host sort; voice/checkout carves shipped    |
| User mode surface reduction          | [interface-modes.md](../interface-modes/interface-modes.md) — dev surfaces hidden, chat-first lens                                                   | The User-mode hidden set ≈ the capabilities the embedded daemon lacks anyway       |
| Personalities, schedules, effort     | Daemon-side, provider-agnostic ([docs/agent-personalities.md](../../docs/agent-personalities.md))                                                    | All core candidates — none of them touch subprocesses                              |

**What does NOT exist anywhere:** a runtime home for daemon code outside Node (Hermes has no `fs`/`net`/`Buffer`-complete surface); an Anthropic Messages API provider (the `@anthropic-ai/sdk` dependency exists but agents reach Claude via the Agent SDK/CLI today); any inventory of which daemon modules are Node-free; a host-list entry not backed by a socket.

---

## Architecture

### Runtime: Hermes in-process (recommended), nodejs-mobile as the fallback

Two ways to host daemon-core on the phone, settled by a **Phase 2 spike before any mobile UI work**:

| Option                              | How                                                                                       | Pros                                                                     | Cons                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Hermes in-process** (recommended) | daemon-core runs in the app's own JS runtime; in-memory transport; seams via Expo modules | No extra runtime, no binary size hit, one build system, trivially shared | Core must be genuinely Node-free; JS thread contention (mitigate: `react-native-worklets` / a worker thread) |
| nodejs-mobile embedded              | Real Node in a background thread; loopback WebSocket; daemon code nearly unmodified       | Minimal extraction pressure                                              | Community-maintained fork risk, ~10MB+, Expo build complexity, still suspended by iOS in background          |

The Hermes path is preferred because constraint 4 already forces the core to be platform-clean — at which point embedding a second runtime buys little. The spike's acceptance test: the ported openai-compat loop completes a streamed multi-turn tool-call round trip against the user's LM Studio endpoint on a real device (both iOS and Android), including SSE streaming and JSON persistence through the seams.

### Package shape

```
packages/daemon-core/            # NEW — platform-agnostic
├── src/
│   ├── platform/                # the six seam interfaces (constraint 3)
│   ├── agent/                   # agent state machine, timeline, storage (over FileStore)
│   ├── providers/
│   │   ├── openai-compat/       # ported loop, MCP-over-HTTP, compaction, rewind
│   │   └── anthropic/           # NEW — Messages API adapter, same tool loop skeleton
│   ├── personalities/ schedules/ …
│   └── transport/               # protocol dispatch core the hosts wrap
packages/server/                 # node host: wraps core; adds terminals, git, preview,
│                                # browser-tools, CLI/ACP providers, stdio MCP, speech, relay
packages/app/
└── src/embedded-daemon/         # mobile host: seam implementations (expo-file-system,
                                 # SecureStore, RN fetch/SSE), in-memory transport,
                                 # "This device" host registration
```

The sort of what moves into core follows the session-decomposition controller boundaries: chat/schedule/loop, provider catalog, and agent lifecycle are core candidates; workspace-git observer, checkout, voice (sherpa native dep), and terminals are host-bound. **Do not fork logic** — a module either moves to core whole or stays in the host whole; anything shared-but-divergent is a design smell to resolve at the seam.

### Providers on the phone

- **Anthropic** — new Messages API adapter in core. The `@anthropic-ai/sdk` runs on any fetch-capable runtime; the adapter reuses the openai-compat loop's skeleton (tool injection, permission flow, compaction hooks) with Anthropic wire shapes (tool_use/tool_result blocks, thinking, prompt caching). This is also a win for the desktop daemon: a native Anthropic provider without the Claude Code CLI — the fork's leveling-up doctrine applied to Anthropic itself.
- **OpenAI-compatible** — the ported loop; the user's remote LM Studio is the day-one verification target.
- **Gemini and others** — later, same pattern. One new file per wire format, not per feature.
- **CLI/ACP providers** — never in core (constraint 2). On the phone those providers simply aren't in the catalog; the client's existing provider-availability handling covers it.

### The mobile tool flavor

Core registers tool groups that make sense without a dev machine; descriptions carry guardrails per [docs/preview.md](../../docs/preview.md) principles:

| Group            | Tools                                               | Notes                                                                       |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `web`            | `web_search`, `web_fetch`                           | Reuses the openai-compat web-search work; engine selection per that charter |
| `mcp`            | user-connected remote MCP servers (HTTP/SSE)        | The main extensibility story on mobile — connectors instead of terminals    |
| `artifacts`      | existing artifacts tools                            | Rendering already client-side; verify the storage path rides `FileStore`    |
| `files`          | read/write inside an app-sandbox workspace folder   | Scoped to the This-device workspace dir; no absolute paths                  |
| `device` (later) | camera/photo attach (user-initiated), notifications | Vision input reuses the computer-use Phase 0 image-delivery plumbing        |

Not present, by construction: terminal, git/checkout, preview/browser-tools, worktrees, computer-use.

### Persistence, secrets, background

- **Persistence:** same Zod-validated JSON files, same atomic-write discipline, under the app sandbox (`Documents/otto-home/`). No migrations, per [docs/data-model.md](../../docs/data-model.md).
- **Secrets:** provider keys in `SecretStore` (Keychain/Keystore). The in-memory transport needs no auth at all — there is no socket to protect. Keys never enter the JSON files or the wire.
- **Background:** v1 is **foreground-only on iOS** — a suspended app pauses mid-turn; on resume the loop continues (the daemon-owned loop makes this tractable: the pending fetch fails/times out and the turn resumes or reports cleanly — define this state machine explicitly in the spike). Android may hold a foreground service (Phase 5). Long-running/unattended work is explicitly a remote-host feature; the UI should say so rather than pretend.

---

## Build sequence

Each phase lands typecheck/lint/test-green and independently valuable. The desktop daemon must be wire-identical after every phase (constraint 4).

### Phase 0 — inventory + prerequisite alignment (no code moves)

1. **Node-API census of `packages/server/src`:** a script/report classifying every module as core-candidate (no Node built-ins beyond the six seams) or host-bound, with the import chains that condemn it. This turns the extraction from archaeology into a checklist.
2. Reconcile with the session-decomposition slice plan — identify which remaining slices (chat-schedule-loop, provider-catalog, agent-lifecycle) double as core-boundary work, and sequence them first there.
3. **Acceptance:** a checked-in `core-boundary.md` in this folder listing every module's disposition; session-decomposition plan updated with the shared sequencing.

### Phase 1 — `daemon-core` extraction, desktop daemon as first host

1. Create `packages/daemon-core` with the six platform seams; node implementations live in `packages/server` and are injected at bootstrap.
2. Move the sorted core modules (agent storage/state machine, openai-compat loop + MCP-over-HTTP, personalities, schedules, protocol dispatch core) per the Phase 0 checklist. CI runs core's tests on Node.
3. **Acceptance:** desktop daemon behavior-identical (dispatch-seam test net + e2e green); `rg "child_process|node-pty|express|ws\"" packages/daemon-core/src` empty; core builds with `lib: es2022` and no `@types/node`.

### Phase 2 — embedded runtime spike + "This device" host (proof: chat works on a phone)

1. **Runtime spike first** (Hermes vs nodejs-mobile, per the table); decide, record rationale here.
2. Seam implementations in `packages/app/src/embedded-daemon/`; in-memory `DaemonClientTransport`; "This device" host entry with a fixed serverId.
3. Anthropic Messages API adapter in core (also registered by the desktop daemon — single-provider proof per fork convention, and desktop gets it for free).
4. **Acceptance:** on a real device with no remote host, create an agent on This device (Anthropic key from SecureStore), hold a streamed multi-turn conversation with a tool call (web_fetch), kill and relaunch the app, and the session restores from sandbox JSON.

### Phase 3 — the mobile platform surface

1. openai-compat provider registered on the embedded daemon (LM Studio over Tailscale verification); remote MCP connector management UI on the This-device host.
2. `web` + `files` + `artifacts` tool groups; sandbox workspace semantics.
3. Personalities and schedules on This device (schedules fire while app is alive; UI copy states the limit).
4. **Acceptance:** the user's daily-driver loop — personality-driven agents, a connected remote MCP server, artifacts — works phone-only.

### Phase 4 — product fit and polish

1. User mode pairing: on a This-device host, default interface mode User (respecting the per-device choice — open decision 5).
2. Foreground-resume state machine hardened (mid-turn suspend/resume/report); local notification when a turn completes in the brief background grace window.
3. Settings surface: This device → Providers / Storage usage / Clear data.
4. **Acceptance:** first-launch-to-first-chat with no desktop anywhere, in User mode, feels like a consumer AI app.

### Phase 5 — deferred (explicitly out of v1)

Android foreground-service background turns; speech on-device (sherpa is a native Node addon — would need an Expo module port or cloud STT/TTS via the existing speech provider abstraction); **on-device local models** (llama.rn / MLC-class runtimes as an openai-compatible localhost endpoint — the fork's local-model mission on the phone itself); iOS Shortcuts/share-sheet ingestion; sync/handoff of This-device sessions to a desktop host; Gemini + further API adapters.

---

## Open decisions

1. **Runtime** — Hermes in-process vs nodejs-mobile; Phase 2 spike decides (recommendation: Hermes).
2. **Workspace semantics on the phone** — proposal: one implicit "My device" project with app-sandbox folder workspaces (no git). Does the project/workspace hierarchy even surface in User mode, or is it sessions-first?
3. **Web platform** — daemon-core on Hermes implies it also runs in a browser tab. Do we ever want a browser-embedded daemon (Otto with zero installs at all)? Free option created by constraint 4; deliberately unscoped.
4. **SSE streaming on RN fetch** — RN's fetch lacks proper streaming in some configurations; the spike must settle the streaming primitive (expo/fetch streams vs react-native-sse vs a native module) before the provider port is declared done.
5. **User mode default** — auto-default User on This-device-only installs, or always ask? Interaction with the interface-modes first-launch picker needs one owner; decide when both charters are active.
6. **Anthropic adapter on desktop** — ships enabled as a peer provider, or behind a flag until battle-tested? (It changes the desktop provider catalog, which is user-visible.)

## Docs fold-in (when this ships)

Create `docs/mobile-daemon.md` (core/host architecture, the six seams, runtime choice + rationale, capability matrix vs desktop) and `docs/daemon-core.md` if the extraction warrants its own page; add glossary entries ("This device", "daemon-core"); update [docs/architecture.md](../../docs/architecture.md) package layering and [docs/providers.md](../../docs/providers.md) with the Anthropic adapter; then delete this folder.

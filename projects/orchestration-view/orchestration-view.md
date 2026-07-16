# Orchestration View — agent-flow integration charter

**Status:** planned, not started. Working name "Orchestration view" (final UI label open — see Decisions).

## Mission

Embed the visualization layer of [agent-flow](https://github.com/patoles/agent-flow) (Apache 2.0, by Simon Patole) as a new Workspace tab: a live, interactive node-graph of agent orchestration — agents, subagents, tool calls, message bubbles, timeline, file-attention heatmap — fed entirely by **Otto's own provider-neutral event stream**, not agent-flow's Claude/Codex ingestion. Every provider Otto supports gets it on day one, because the adapter consumes the already-normalized protocol stream.

Two hard requirements from the product owner:

1. **Keep the ability to merge upstream updates** while adapting it to Otto's providers. (Fallback accepted: if upstream diverges too far, freeze and own it.)
2. **Use none of agent-flow's own provider connectivity** — its Claude-hooks server, `~/.claude`/`~/.codex` watchers, JSONL tailing, relay, and VS Code extension are all discarded. Otto's daemon/client is the sole event source.

Also desired: choose which of its tooling panels are enabled, and (later) restyle its art/layout.

## What agent-flow is (verified against a clone of `main`, 2026-07-11 tip, v0.9.1)

pnpm monorepo with three consumers around one render core:

| Part         | What                                                                                                                                                                                                                                                                                          | Do we use it?                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `web/`       | The visualizer: React 19 + HTML canvas (all drawing in `web/components/agent-visualizer/canvas/draw-*.ts`), d3-force layout, Tailwind 4 for the DOM panels. Builds to a **single self-contained IIFE bundle** (`index.js` + `index.css`) via `vite.config.webview.ts`/`vite.config.shared.ts` | **Yes — this is the whole prize**                                                 |
| `extension/` | VS Code extension host: Claude hook server, session watchers, Codex rollout parser, webview provider                                                                                                                                                                                          | No (reference only, for bridge protocol semantics in `extension/src/protocol.ts`) |
| `app/`       | `npx agent-flow-app` standalone server (+ opt-out telemetry in `scripts/telemetry.ts`)                                                                                                                                                                                                        | No (telemetry never enters our build — we only compile `web/` with our own entry) |
| `scripts/`   | Relay/build/setup scripts                                                                                                                                                                                                                                                                     | No                                                                                |

### The seam: a tiny postMessage bridge

`web/lib/vscode-bridge.ts` is the only transport in the render layer, and it's pluggable (`configureWebviewApi(postMessage)`). The full contract:

- **Host → page:** `__vscode-bridge-init`, `agent-event` / `agent-event-batch` (`{time, type, payload, sessionId?}`), `config` (`{mode, autoPlay, showMockData, disable1MContext}`), `connection-status`, `reset`, `session-list` / `session-started` / `session-ended` / `session-updated`.
- **Page → host:** `ready`, `open-file` (`{filePath, line?}`).

Event types (`web/lib/agent-types.ts` `SimulationEvent`, handlers in `web/hooks/simulation/handle-*.ts`) and their payloads:

| Event                                   | Payload (all loosely typed, missing fields tolerated)                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `agent_spawn`                           | `{name, parent?, isMain?, task?, model?, runtime?}` — `name` is the node id; re-spawn of existing name reactivates |
| `agent_complete`                        | `{name}` — cascades completion to children + running tools                                                         |
| `agent_idle`                            | `{name}` — tool_calling/waiting_permission → thinking                                                              |
| `model_detected`                        | `{agent, model}` — drives context-window size + cost rate                                                          |
| `tool_call_start`                       | `{agent, tool, args, inputData?}` — `inputData.file_path` feeds the file-attention heatmap (Read/Edit/Write)       |
| `tool_call_end`                         | `{agent, tool, result?, tokenCost?, isError?, errorMessage?}`                                                      |
| `message`                               | `{agent, content, role: 'user'\|'assistant'\|'thinking'}` — first user message renames the main node               |
| `context_update`                        | `{agent, tokens, tokensMax?, breakdown?: {systemPrompt, userMessages, toolResults, reasoning, subagentResults}}`   |
| `subagent_dispatch` / `subagent_return` | `{parent, child, task/summary}` — particles along the parent-child edge                                            |
| `permission_requested`                  | `{agent}`                                                                                                          |

Multi-session: the page keeps per-`sessionId` event queues and renders session tabs; the host just streams tagged events + session lifecycle messages.

### License & trademark (constraints, not blockers)

- **Apache 2.0** — free to use/modify/redistribute. Obligations: retain `LICENSE`/copyright notices in the vendored tree (automatic), and state significant changes (we'll keep `vendor/agent-flow/OTTO-PATCHES.md` as the change statement + patch catalog).
- **`TRADEMARK.md`: the name "Agent Flow" and its logos are trademarked.** A derivative **must not** be named "Agent Flow" or confusingly similar, must not use its logos, and must state it derives from Agent Flow. So: our UI label is our own (see Decisions), upstream icons in `extension/media`/`web/public` are never shipped, and docs/about attribute "derived from Agent Flow (Apache 2.0)".

## Architecture

```
                       ┌────────────────────────────────────────────────┐
 Otto daemon           │ packages/app (client)                          │
 (any provider) ──WS──▶│ session-store / agent.stream (normalized)      │
                       │        │                                       │
                       │        ▼                                       │
                       │ flow-view adapter (src/flow-view/)             │
                       │  stream event → SimulationEvent mapping        │
                       │        │ postMessage (batched)                 │
                       │        ▼                                       │
                       │ Orchestration panel (workspace tab)            │
                       │  ├ web:      sandboxed iframe srcDoc           │
                       │  ├ electron: <webview> own partition           │
                       │  └ native:   react-native-webview {html}       │
                       │        ▲                                       │
                       │   self-contained HTML shell                    │
                       └────────┼───────────────────────────────────────┘
                                │ built bundle (committed, regenerated on vendor sync)
                       packages/flow-view (build pkg, our entry + vite config)
                                │ imports via alias
                       vendor/agent-flow/web (git subtree, upstream-pristine)
```

### 1. Vendoring: git subtree, squashed, upstream-pristine

```
git subtree add  --prefix vendor/agent-flow https://github.com/patoles/agent-flow.git main --squash
git subtree pull --prefix vendor/agent-flow https://github.com/patoles/agent-flow.git main --squash   # sync
```

- Whole repo vendored (subtree can't track a subdirectory of a remote without maintaining a split pipeline); only `web/` is compiled. `extension/`, `app/`, `scripts/` sit inert — they're small and keep `web/lib/bridge-types.ts` ↔ `extension/src/protocol.ts` context intact for future pulls.
- **Rule: no Otto code inside `vendor/`.** All integration lives outside. In-subtree edits are a last resort, each one logged in `vendor/agent-flow/OTTO-PATCHES.md` (which doubles as the Apache "changes" statement). This keeps `subtree pull` conflicts rare and predictable. Upstream ships in bursts (~56 commits Mar–Jul 2026), so expect a pull every month or two.
- Root `package.json` workspaces are an explicit list — the vendor tree stays out of npm/metro until we opt pieces in.
- Prefer upstreaming generalizations (theming hooks, logo registry — see Later) over carrying patches.

### 2. Build: `packages/flow-view` (new workspace package, build-time only)

- Declares agent-flow web's devDeps itself (react/react-dom 19.x, d3-force, vite, `@vitejs/plugin-react`, tailwindcss 4 + `@tailwindcss/vite`, tw-animate-css) — hoisting makes them resolvable from the vendor tree; nothing is installed inside `vendor/`.
- `src/otto-entry.tsx` — our replacement for `webview-entry.tsx`: mounts `AgentVisualizer` (imported from the vendor tree via vite alias `@` → `vendor/agent-flow/web`) and configures `vscodeBridge` for whichever transport it detects:
  - **iframe (web):** zero config — the bridge's dev path already listens on `window` messages and replies via `window.parent.postMessage`.
  - **react-native-webview:** replies via `window.ReactNativeWebView.postMessage`; host injects events with `injectJavaScript` dispatching `message` events.
  - **Electron `<webview>`:** host → guest via `executeJavaScript` dispatching `message` events; guest → host per browser-pane's established guest-messaging pattern.
- `vite.config.ts` — clone of upstream's `createBuildConfig` usage with our entry/defines (`AGENT_FLOW_STANDALONE="0"`, demo off ⇒ the SSE/EventSource path is compiled out; no relay, no telemetry).
- Output: one **HTML shell with inlined JS+CSS**, emitted as a generated module (e.g. `packages/app/src/flow-view/flow-bundle.generated.ts`, lazy-required). Committed like our icon codegen output, regenerated by `npm run build:flow-view` only when the vendor tree changes. The visualizer's React never touches the RN app's React — total isolation.

### 3. Embedding: the artifact tri-platform pattern

Reuse/generalize `components/artifacts/artifact-html-view.{web,electron,tsx}`:

- **Web:** sandboxed `<iframe srcDoc>` (`allow-scripts`, no `allow-same-origin`) — this is also the plain-iframe bridge path, so messaging is native `postMessage`.
- **Electron:** `<webview>` guest on its own partition (e.g. `otto-flow-view`) — mandatory, srcDoc/data iframes inherit the app shell's `script-src 'self'` CSP and would block the inline bundle (see docs/… CSP gotcha; same reason artifacts use a webview).
- **Native:** `react-native-webview` with `source={{html}}`, `originWhitelist=[]`.
- CSP inside the shell mirrors the artifact CSP (`connect-src 'none'` etc.) — the visualizer needs no network by design; everything arrives by postMessage. Audio effects (`use-audio-effects`) default muted in embed config.

**No daemon involvement, no capability flag:** all consumed data already reaches the client on existing protocol; the bundle ships in the app. The feature works against any daemon version — it's client-release-gated only.

### 4. Workspace tab: `{ kind: "orchestration" }` (one per workspace)

Follow the Git Log tab precedent end-to-end:

- Target union: `stores/workspace-tabs-store/state.ts` (+ persistence `coerceWorkspaceTabTarget`).
- Identity fns: `workspace-tabs/identity.ts` — normalize / equals / deterministic id (`orchestration`).
- `panels/orchestration-panel.tsx` + registration in `panels/register-panels.ts`; descriptor label/icon.
- `openOrchestrationTab()` helper à la `git/open-git-log-tab.ts`; entry point in the workspace header/actions (visibility respects interface mode — Developer lens).
- agent-flow's own **session tabs** map to the workspace's agents: each attended root agent in the workspace = one visualizer session (`session-started` with the agent's title as label; observed subagents ride along inside that session via `parent`/`agent_spawn`).
- `open-file` messages from the page route to `usePaneContext().openFileInWorkspace` — its file nodes become clickable straight into Otto's editor.

### 5. Event adapter: `packages/app/src/flow-view/` (client-side, provider-neutral by construction)

Source: `host-runtime` client `agent.stream` (`AgentStreamEventPayload`, protocol `messages.ts` L904) + agent snapshot leaves (`session-store`). Mapping:

| Otto (normalized)                                                   | → SimulationEvent                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| agent snapshot appears (attended, in workspace)                     | `session-started` + `agent_spawn {name, isMain:true, model, runtime}`                                           |
| snapshot `attend:"observed"` + `parentAgentId` (observed subagents) | `agent_spawn {name, parent, task}`                                                                              |
| timeline `tool_call` status `running`                               | `tool_call_start {agent, tool:name, args: detail summary, inputData: {file_path} from read/edit/write details}` |
| timeline `tool_call` `completed`/`failed`/`canceled`                | `tool_call_end {result, isError, errorMessage}`                                                                 |
| timeline `tool_call` `sub_agent` detail start/end                   | `subagent_dispatch` / `subagent_return {parent, child, task/summary}`                                           |
| timeline `user_message` / `assistant_message` / `reasoning`         | `message {role: user/assistant/thinking}`                                                                       |
| `turn_completed.usage` / snapshot `lastUsage`                       | `context_update {tokens: contextWindowUsedTokens, tokensMax: contextWindowMaxTokens}`                           |
| stream `permission_requested` / `permission_resolved`               | `permission_requested` / `agent_idle`                                                                           |
| `turn_completed`                                                    | `agent_idle`                                                                                                    |
| agent terminal (archived/exited; subagent finished)                 | `agent_complete`                                                                                                |
| model change / snapshot `model`                                     | `model_detected`                                                                                                |

- **Backfill:** on tab open, replay the workspace's existing timeline (same path chat backfill uses — see docs/timeline-sync.md) as one `agent-event-batch` with original timestamps; the visualizer's built-in replay/seek/timeline then works over history, then live events append. Batch live events on a short tick (~100–250 ms) — the page throttles UI to 4 Hz internally anyway.
- `runtime` field only picks the node's brand logo (`draw-agents.ts`); map claude→`claude`, codex-family→`codex`, rest default. Extending the logo set for Copilot/OpenCode/Pi/openai-compat is a Later item (ideally an upstream PR making the mapping data-driven).
- `contextBreakdown` (per-category token split) has no Otto source today — omit; the page tolerates it. Candidate later leaf if we want the composition donut.

### 6. Panel/tooling selection & restyling (product owner asks)

- **Tooling choice:** the visualizer's control bar already toggles its panels (timeline, file attention, transcript, message feed, cost overlay, hex grid, audio). Phase 3 adds an Otto settings surface that seeds defaults via the `config` bridge message (extend `VisualizerConfig` — small, upstreamable).
- **Art/layout restyle:** ladder, cheapest first — (1) CSS overrides appended after `index.css` in our shell (DOM panels are Tailwind); (2) canvas palette/layout live almost entirely in `web/lib/colors.ts` + `web/lib/canvas-constants.ts` — small, stable files; patch + log in OTTO-PATCHES.md; (3) best long-term: upstream a theme object on the `config` message so our theme is pure data, zero drift.

## Phases

- **Phase 0 — Vendor + build proof.** Subtree add; `packages/flow-view` package; bundle builds; open the shell standalone in a browser with `showMockData` config on → the built-in mock scenario animates. _(Requires a clean working tree for `git subtree add` — coordinate with in-flight work.)_
- **Phase 1 — Tab + embed proof.** `orchestration` tab kind wired (union, identity, persistence, registration, opener); tri-platform embed shows mock scenario inside Otto on web, Electron, and at least one native platform.
- **Phase 2 — Live adapter.** Event mapping + backfill; sessions per workspace agent; proof on Claude incl. observed subagents; then verify Codex/OpenCode/Copilot/openai-compat streams (should be free — same normalized schema).
- **Phase 3 — Product polish.** `open-file` → editor tab; panel-toggle settings via `config`; provider logo mapping; mute-by-default audio; naming/attribution sweep (UI label, about-credits, no upstream logos); i18n for our chrome only (page stays English — Build first, translate last).
- **Phase 4 — Upstream relationship (ongoing).** Documented `subtree pull` playbook + OTTO-PATCHES.md discipline; candidate upstream PRs: themeable palette, data-driven runtime→logo registry, panel-visibility config.

## Decisions

**Locked (per product owner):**

- Use only the visualization; Otto is the sole event source. No agent-flow ingestion/relay/telemetry compiled in.
- Mergeability preserved via subtree + no-edits-in-vendor rule; if upstream drift makes pulls uneconomical, freeze the subtree and own it.

**Open:**

1. **UI label** — must not be "Agent Flow" (trademark). Recommendation: **"Orchestration"** (tab label), internal kind `orchestration`. Alternatives: "Flow view" (riskier — arguably confusingly similar), "Swarm", "Mission Control".
2. **Committed generated bundle vs CI-built** — recommendation: commit it (icon-codegen precedent; keeps app builds hermetic; regenerated only on vendor sync).
3. Native phones in scope for Phase 1, or web+Electron first with native fast-follow? (Canvas+d3 in a phone WebView should hold up — all animation is inside the guest — but low-end devices unproven.)

## Risks / gotchas

- **Electron CSP:** inline-script bundle dies in srcDoc/data iframes under the app-shell CSP — `<webview>` + own partition is load-bearing, not a preference.
- **Dual-source dedup is already handled page-side** (3 s tool-call dedup window, bubble dedup) — the adapter should still avoid double-feeding backfill + live overlap (use the timeline cursor the same way chat does).
- **Node identity:** the page keys agents by `name` — the adapter must send stable unique names (agent title + short id suffix on collision), and observed-subagent ids (`parent::sub::key`) need the same special-casing every lifecycle verb needed (see subagents-cleanup gotcha).
- **Bundle weight** in the app JS (likely high-hundreds of KB): lazy-require the generated module so it loads only when a tab opens.
- **React/tailwind version drift** between vendor and `packages/flow-view` devDeps on subtree pulls — the build package pins must follow upstream's `web/package.json`; make the sync playbook include a diff of it.
- Upstream velocity is bursty; each pull may touch `bridge-types`/handlers — the adapter's event surface is small and loosely typed, which is the shock absorber.

# Visualizer — agent-flow integration charter

**Status:** Phase 0 (vendor + build pipeline) **shipped**. Phases 1–3 are broken into self-contained task files in [tasks/](tasks/) for follow-up agents. UI label: **"Visualizer"** (locked).

## Mission

Embed the visualization layer of [agent-flow](https://github.com/patoles/agent-flow) (Apache 2.0, by Simon Patole) as a new Workspace tab: a live, interactive node-graph of agent orchestration — agents, subagents, tool calls, message bubbles, timeline, file-attention heatmap — fed entirely by **Otto's own provider-neutral event stream**, not agent-flow's Claude/Codex ingestion. Every provider Otto supports gets it on day one, because the adapter consumes the already-normalized protocol stream.

Scope (product owner): visualize **any agent chat** — attended agents, provider workflows, observed/native subagents — and eventually attach to the existing **Orchestration module** (`features.agentOrchestration`, Runs/Teams) so team runs get the same live graph. The generic agent-chat visualization ships first; the Runs hookup is a later phase that reuses the same adapter with the Run's agent set as the session list.

Hard requirements:

1. **Keep the ability to merge upstream updates** while adapting to Otto's providers. (Fallback accepted: if upstream diverges too far, freeze the vendor tree and own it.)
2. **Use none of agent-flow's own provider connectivity** — its Claude-hooks server, `~/.claude`/`~/.codex` watchers, JSONL tailing, relay, and VS Code extension are all discarded. Otto's daemon/client is the sole event source.
3. Choose which of its tooling panels are enabled; later restyle its art/layout.

## What shipped in Phase 0 (foundations)

- **`vendor/agent-flow/`** — upstream `main` (v0.9.1, commit `84cd2fb`) vendored as a **git-subtree-format squash + merge commit pair**, so stock `git subtree pull --prefix vendor/agent-flow https://github.com/patoles/agent-flow.git main --squash` works for updates. Remote `agentflow` is configured. See [upstream-sync.md](upstream-sync.md) for the playbook and the no-edits-in-vendor rule.
- **`packages/visualizer/`** — new workspace package (build-time only) that compiles the vendor render layer with an Otto entry:
  - `src/otto-entry.tsx` replaces upstream's `webview-entry.tsx`: binds the vendor bridge to the host transport (Electron `window.__ottoVisualizerPost` → RN `window.ReactNativeWebView.postMessage` → iframe `window.parent.postMessage`), resolved lazily per call so late-injected transports win.
  - `vite.config.ts` mirrors upstream's `createBuildConfig` (IIFE, single `index.js`/`index.css`), demo/SSE/telemetry paths compiled out (`AGENT_FLOW_STANDALONE=0`, `NEXT_PUBLIC_DEMO=0`, relay port empty).
  - `scripts/emit-bundle.mjs` wraps the build into one self-contained HTML shell (artifact-style CSP, `connect-src 'none'`, dark shell matching upstream's webview) and emits **`packages/app/src/visualizer/visualizer-bundle.gen.ts`** (committed; `.gen.ts` is oxfmt-ignored). `npm run build:visualizer` / `build:visualizer:demo` from the root.
- **Config guards:** `vendor/**` added to `.oxfmtrc.json` + `.oxlintrc.json` ignorePatterns — the formatter must never touch the vendor tree.
- **Verified:** bundle builds (356 KB JS / 110 KB gzip); page boots (React mounts, canvas renders, control bar + panels present); bridge messages are consumed end-to-end (`config` cleared the waiting overlay, `connection-status` → CONNECTED HUD). Full animation could not be exercised in the harness because a hidden browser pane never fires `requestAnimationFrame` (see Risks) — first visible-pane host (task 02) must re-verify with the demo scenario.

## The seam (verified against the vendored code)

`web/lib/vscode-bridge.ts` is the only transport in the render layer, and it's pluggable. The full contract:

- **Host → page:** `__vscode-bridge-init`, `agent-event` / `agent-event-batch` (`{time, type, payload, sessionId?}`), `config` (`{mode, autoPlay, showMockData, disable1MContext}`), `connection-status`, `reset`, `session-list` / `session-started` / `session-ended` / `session-updated`.
- **Page → host:** `ready`, `open-file` (`{filePath, line?}`).

Event types (`web/lib/agent-types.ts` `SimulationEvent`, handlers in `web/hooks/simulation/handle-*.ts`):

| Event                                   | Payload (loosely typed, missing fields tolerated)                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `agent_spawn`                           | `{name, parent?, isMain?, task?, model?, runtime?}` — `name` is the node id; re-spawn of an existing name reactivates it |
| `agent_complete`                        | `{name}` — cascades completion to children + running tools                                                               |
| `agent_idle`                            | `{name}` — tool_calling/waiting_permission → thinking                                                                    |
| `model_detected`                        | `{agent, model}` — drives context-window size + cost rate                                                                |
| `tool_call_start`                       | `{agent, tool, args, inputData?}` — `inputData.file_path` feeds the file-attention heatmap (Read/Edit/Write)             |
| `tool_call_end`                         | `{agent, tool, result?, tokenCost?, isError?, errorMessage?}`                                                            |
| `message`                               | `{agent, content, role: 'user'\|'assistant'\|'thinking'}` — first user message renames the main node                     |
| `context_update`                        | `{agent, tokens, tokensMax?, breakdown?}`                                                                                |
| `subagent_dispatch` / `subagent_return` | `{parent, child, task/summary}`                                                                                          |
| `permission_requested`                  | `{agent}`                                                                                                                |

Multi-session: the page keeps per-`sessionId` event buffers and renders session tabs; the host streams tagged events + session lifecycle messages. Sessions map to Otto agents (one visualizer session per attended root agent; observed subagents ride inside via `parent`).

## License & trademark (constraints, not blockers)

- **Apache 2.0** — obligations: retain `LICENSE`/copyright in the vendored tree (automatic) and state significant changes (`vendor/agent-flow/OTTO-PATCHES.md` is created on first in-vendor patch; none exist yet).
- **`TRADEMARK.md`: the name "Agent Flow" and its logos are trademarked.** Never use "Agent Flow" as the feature name or ship its icons (`extension/media/`, `web/public/`). UI label is **"Visualizer"**; docs/about attribute "derived from Agent Flow (Apache 2.0)".

## Remaining work → [tasks/](tasks/)

| Task                                                   | What                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [tasks/01-workspace-tab.md](tasks/01-workspace-tab.md) | `{ kind: "visualizer" }` tab: target union, identity fns, persistence, panel registration, opener                             |
| [tasks/02-embed-views.md](tasks/02-embed-views.md)     | Tri-platform embed of `VISUALIZER_HTML` + host-side bridge transport; re-verify demo scenario in a visible pane               |
| [tasks/03-event-adapter.md](tasks/03-event-adapter.md) | Otto `agent.stream` → SimulationEvent adapter with backfill, sessions per agent, all providers                                |
| [tasks/04-polish.md](tasks/04-polish.md)               | open-file routing, panel-toggle settings, provider logos, audio default-mute, attribution, Orchestration-module (Runs) hookup |
| [upstream-sync.md](upstream-sync.md)                   | Subtree pull playbook + patch discipline (read before touching `vendor/`)                                                     |

Suggested order: 01 → 02 → 03 → 04. 01 and 02 can land together behind nothing (client-only feature, no daemon flag needed); the tab entry point can stay hidden until 03 makes it useful.

## Risks / gotchas (some discovered the hard way in Phase 0)

- **Electron CSP:** the app-shell CSP (`script-src 'self'`) is inherited by srcDoc/data iframes and kills the inline bundle — Electron embedding **must** use `<webview>` on its own partition (artifact pattern, `artifact-html-view.electron.tsx`).
- **Hidden panes stop the world:** the page processes events only inside `requestAnimationFrame`, and hidden/occluded webviews don't fire rAF. Events keep buffering (per-session buffers are authoritative) and flush on session re-selection — but the adapter/host should re-flush or force a session re-select when a Visualizer tab regains visibility.
- **Paused-player event drop (upstream quirk):** in `use-agent-simulation.ts`, pending external events are captured and consumed _before_ the `isPlaying` check — events arriving while paused are dropped from the live view (still recoverable from the session buffer). Don't fight it in the adapter; rely on session re-flush semantics.
- **Node identity:** the page keys agents by `name`. The adapter must send stable unique names, and observed-subagent ids (`parent::sub::key`) need the same special-casing every other lifecycle verb needed.
- **`config {showMockData:true, mode:'replay', autoPlay:true}`** is how a host shows the built-in demo scenario (upstream's own demo command); production shells boot with mock off because `configureWebviewApi` marks the page as hosted.
- **Formatter/linter:** `vendor/**` is ignore-listed in both oxfmt and oxlint configs — keep it that way; a formatted vendor tree destroys mergeability. The emitted bundle uses the `.gen.ts` suffix, which oxfmt already ignores.
- **lefthook + subtree pulls:** pre-commit jobs run format-check/lint on staged files, which a subtree merge would fail; run subtree pulls with `LEFTHOOK=0` (see upstream-sync.md).
- **React pinning:** `packages/visualizer` pins react/react-dom to the app's exact version (19.1.0) so npm hoists one copy and the vendor code resolves a matched react/react-dom pair. On subtree pulls, diff upstream's `web/package.json` and bump our devDeps to match (keeping the react pin rule).
- **Bundle weight:** `visualizer-bundle.gen.ts` is ~360 KB of string — consumers must lazy-require it (task 02) so it never loads before a Visualizer tab opens.
- **knip:** `knip.json` has per-workspace config and doesn't know `packages/visualizer` yet; add an entry if knip starts complaining.

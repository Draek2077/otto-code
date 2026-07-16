# Visualizer

The **Visualizer** (Workspace tab, `{ kind: "visualizer" }`) is a live, interactive node-graph of agent orchestration — agents, subagents, tool calls, message bubbles, timeline, file-attention heatmap — rendered by the vendored render layer of [Agent Flow](https://github.com/patoles/agent-flow) (Apache 2.0, by Simon Patole) and fed entirely by **Otto's own provider-neutral event stream**. It ships for every provider on day one because the adapter consumes the already-normalized protocol stream, never the vendor's own Claude/Codex ingestion.

**Opening:** the Visualizer is a companion view — the user watches it alongside the chat or orchestration that's beginning — so `openVisualizerTab` (`packages/app/src/visualizer/open-visualizer-tab.ts`, the single entry point for the header button and the Runs "Visualize" action) opens it in a **split to the right of the focused pane**, never covering the pane the user is in. It falls back to opening/focusing in place when splits are unsupported (native), the tab is already split out into another pane, the focused pane has nothing else to watch alongside, or the split tree is at max depth.

**Trademark:** the vendor project's name and logos are trademarked (`vendor/agent-flow/TRADEMARK.md`). Never use "Agent Flow" as a UI label — the feature name is **"Visualizer"**, locked. Never ship the vendor's own icons. Attribution lives in Settings → About ("Visualizer is derived from Agent Flow (Apache 2.0) by Simon Patole", see `packages/app/src/utils/visualizer-attribution.ts`).

## Vendor tree (`vendor/agent-flow/`)

A **git subtree** (squashed) of `https://github.com/patoles/agent-flow` (remote `agentflow`), imported in stock subtree format so standard tooling works. Only `web/` is compiled; `extension/`, `app/`, `scripts/` are inert reference (`extension/src/protocol.ts` carries the canonical bridge protocol upstream itself compiled against).

Rules:

1. **No Otto code inside `vendor/`.** All integration lives in `packages/visualizer/` (build) and `packages/app/src/visualizer/` (embed + adapter).
2. **In-vendor patches are a last resort**, logged in `vendor/agent-flow/OTTO-PATCHES.md` (file, what changed, why) — this file doubles as the Apache 2.0 "state changes" notice. Prefer upstream PRs over carrying patches; the carried set (runtime→logo mapping, host-seedable panel config, always-visible session tabs, `config.render` layer toggles, `otto-code` font markers, host-seedable color palette) is enumerated in that file with full rationale.
3. **Never format or lint the vendor tree** — `vendor/**` is ignore-listed in `.oxfmtrc.json` / `.oxlintrc.json`. The emitted bundle uses the `.gen.ts` suffix, which oxfmt already ignores.
4. **React pinning:** `packages/visualizer` pins react/react-dom to the app's exact version so one hoisted copy serves both.

### Pulling upstream updates

```bash
git fetch agentflow main --no-tags
LEFTHOOK=0 git subtree pull --prefix vendor/agent-flow https://github.com/patoles/agent-flow.git main --squash
```

`LEFTHOOK=0` matters — pre-commit format-check/lint would fail on vendor code. If the pull conflicts with local patches, resolve inside `vendor/`, keeping `OTTO-PATCHES.md` accurate.

Then: diff upstream's build inputs (`web/package.json`, `web/vite.config.shared.ts`, `web/webview-entry.tsx`, `web/lib/bridge-types.ts`) against what `packages/visualizer/` mirrors; re-apply any `OTTO-PATCHES.md` patch upstream's diff clobbered; rebuild (`npm run build:visualizer`, which regenerates the committed `packages/app/src/visualizer/visualizer-bundle.gen.ts`); verify the demo scenario in a visible pane, then a live agent session; `npm run typecheck && npm run lint`.

**Escape hatch:** if upstream drift makes pulls uneconomical, stop pulling — the vendor tree freezes and Otto owns it. Nothing else changes.

## Build pipeline

`packages/visualizer/` is a build-time-only workspace package:

- `src/otto-entry.tsx` replaces upstream's `webview-entry.tsx`: binds the vendor bridge to whichever host transport is present (Electron `window.__ottoVisualizerPost` → RN `window.ReactNativeWebView.postMessage` → iframe `window.parent.postMessage`), resolved lazily per call so late-injected transports win.
- `vite.config.ts` mirrors upstream's `createBuildConfig` (IIFE, single `index.js`/`index.css`; demo/SSE/telemetry compiled out).
- `scripts/emit-bundle.mjs` wraps the build into one self-contained HTML shell (artifact-style CSP, `connect-src 'none'`) and emits `packages/app/src/visualizer/visualizer-bundle.gen.ts` (committed, ~975 KB string — mostly the two embedded font faces, see Fonts & type scale). `npm run build:visualizer` / `build:visualizer:demo` from the root.

Consumers `import()` the bundle lazily (`load-visualizer-html.ts`) — never at module top level — so it's only fetched once a Visualizer tab actually mounts.

## Embed (tri-platform)

`packages/app/src/visualizer/visualizer-view.{web,electron,tsx}` — Metro-split per `CLAUDE.md`'s platform-gating convention:

- **Web:** sandboxed `<iframe srcDoc={VISUALIZER_HTML} sandbox="allow-scripts">`, no `allow-same-origin`. Needs zero page cooperation — the entry falls back to `window.parent.postMessage`.
- **Electron:** `<webview>` on its own non-persistent partition (`otto-visualizer`). **Not an iframe** — the app-shell CSP (`script-src 'self'`) is inherited by same-document srcDoc iframes and blocks the inline bundle; a `<webview>` guest on its own session escapes it. Page → host has no other IPC, so the guest logs a prefixed JSON string (`__OTTO_VIS__...`) and the host parses `console-message`. The partition being fresh per app run is also why the vendor page's sound effects default muted (`web/hooks/use-audio-effects.ts` only unmutes when `localStorage[agent-viz-sound] === "on"`, and this partition's storage starts empty every run).
- **Native:** `react-native-webview`, `source={{ html: VISUALIZER_HTML }}`.

All three keep the WebView/webview mounted for the tab's lifetime (no unmount on blur) so accumulated page state survives tab switches.

**Resource sleep (off-screen tabs cost nothing):** a Visualizer that isn't on screen renders zero frames. The guest advances state only inside `requestAnimationFrame`, and `rAF` doesn't fire for a `display:none` (or occluded) WebView — so the whole canvas pipeline (bloom, particles, the graph) halts with no CPU/GPU cost. Two layers put an off-screen Visualizer behind `display:none`: a **non-frontmost tab** in its pane (`RetainedPanel active={isVisible}` in `split-container.tsx`), and a **background workspace** (`WorkspaceDeck` mounts up to `WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES = 3` workspaces, each a `RetainedPanel active={isActive}`; beyond the cap the workspace — and its WebView — is fully unmounted). The Otto-side adapter is independently gated off whenever the pane isn't on screen (`usePaneFocus().isVisible`, i.e. workspace focused **and** frontmost tab), so it does no backfill/streaming work either. The one deliberate exception is a **visible companion split** — a Visualizer sharing the focused workspace with the pane you're typing in is on screen and stays live (that's the whole point of the companion view). Bringing an asleep Visualizer back into view flips `isVisible` true, whose reset+replay rehydrates the graph from the session buffers (see "Backfill + liveness").

## The bridge contract

`web/lib/vscode-bridge.ts` is the render layer's only transport, and it's pluggable — this is the seam Otto's embed drives instead of the vendor's VS Code extension.

- **Host → page:** `__vscode-bridge-init`, `agent-event` / `agent-event-batch` (`{time, type, payload, sessionId?}`), `config` (`{mode, autoPlay, showMockData, disable1MContext, panels, render, soundVolume, hudHidden}`), `connection-status`, `reset`, `session-list` / `session-started` / `session-ended` / `session-updated`.
- **Page → host:** `ready`, `open-file` (`{filePath, line?}`), `sound-muted` (`{muted}`), `hud-hidden` (`{hidden}`).

### `config.render` (Otto patch)

An optional `render: Partial<{bloom, stars, backdrop}>` field toggles the canvas's decorative layers, applied live on every `config` message that carries it: `bloom` is the blurred additive glow pass (three full-canvas blur passes per frame — the single most expensive draw stage; disabling it also removes the "blurry echo" of bright elements), `stars` the 80 parallax depth particles, `backdrop` the void fill + ambient spotlight. Omitted keys keep the layer on. Sourced from `visualizerRender*` device-local settings in the dedicated **Settings → Visualizer** section (developer mode only), sent by `visualizer-panel.tsx` together with `panels` — on the page's `ready` handshake and re-sent live whenever a setting changes.

The same settings section owns **Sharpness** (`visualizerRenderQuality`: Fast 1x / Balanced 1.25x / Sharp 1.5x / Native): it substitutes the shell's `__OTTO_DPR_CAP__` placeholder via `applyVisualizerRenderScale` (load-visualizer-html.ts). The page reads dpr once at boot, so a quality change rebuilds the html string, which remounts the guest — the panel resets its handshake state on the change so the fresh `ready` re-runs config + adapter replay.

### `config.soundVolume` (Otto patch)

An optional `soundVolume: number` (0..1) sets the vendor page's master audio volume for its procedural sound effects (agent spawn, tool start/end, completion chord, error tone). It's **authoritative** in the page: `0` mutes, `> 0` is audible at that level and unmutes (driving the in-page mute toggle's icon so it stays truthful). Sent live on every `config` message that carries it, applied via `AudioEngine.setVolume`. Sourced from the `visualizerSoundVolume` device-local setting (stored as a 0-100 percent, ÷100 on the way out), surfaced as the Volume slider in the **Settings → Visualizer "Sound"** section. The effective value is gated by the `visualizerSoundMuted` setting (`muted ? 0 : volume/100`); the defaults are volume 50, unmuted — so first-time users hear the feature at 50%, and the in-page speaker button is the mute switch (persisted host-side, since the vendor page's own localStorage mute pref resets every run on Otto's fresh webview partition).

### `config.panels` (Otto patch)

An optional `panels: Partial<{timeline, fileAttention, transcript, messageFeed, costOverlay, hexGrid}>` field seeds which page panels start visible — applied on every `config` message that carries it, not just the first. `fileAttention`/`transcript`/`costOverlay` are mutually exclusive in the vendor page itself (`toggleExclusivePanel`); a config setting more than one true is resolved by priority (files > transcript > cost). Sourced from device-local settings (`packages/app/src/hooks/use-settings/storage.ts` `visualizerPanel*` fields, Settings → Appearance → Visualizer, developer mode only) and sent once by `visualizer-panel.tsx` on the page's `ready` handshake.

### `config.hudHidden` (Otto patch)

An optional `hudHidden: boolean` collapses the **HUD chrome** — the top bar and the bottom control bar — leaving the canvas graph, every informational surface (message feed, agent/tool/discovery popups, chat panel, slide-in panels — hiding the HUD clears chrome, it doesn't blind the user), and a single always-visible bottom-left toggle button (so the HUD is recoverable). Authoritative when present, applied on every `config` message that carries it (same shape as `config.panels`). The button reports its flip back via the `hud-hidden` (`{hidden}`) page→host message; the panel persists it into the `visualizerHudHidden` device-local setting and re-seeds it as `config.hudHidden`. Because all tabs read that one setting, the toggle is **shared by every Visualizer tab at once** and survives restarts. Like the mute toggle, the in-page button is the whole control — there is no Settings row.

### Provider logos (Otto patch)

`Agent['runtime']` is widened from upstream's `'claude' | 'codex'` to also include `'copilot' | 'opencode' | 'pi' | 'openai-compat'`. Only Claude and Codex have real brand marks (trademark rule); every other known runtime draws a generic hollow-diamond mark instead of silently falling back to the Claude spark. `packages/app/src/visualizer/visualizer-event-adapter.ts` `resolveVisualizerRuntime` maps Otto's provider ids (`claude`, `codex*`, `copilot`, `opencode`, `pi`, `omp` → `'openai-compat'`) to these literals; a user-defined custom openai-compatible provider (arbitrary id) still omits `runtime` and gets the Claude-spark default.

### Event types (`SimulationEvent`)

| Event                                   | Payload (loosely typed, missing fields tolerated)                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_spawn`                           | `{name, parent?, isMain?, task?, model?, runtime?}` — `name` is the node id; re-spawn of an existing name reactivates it             |
| `agent_complete`                        | `{name}` — cascades completion to children + running tools                                                                           |
| `agent_idle`                            | `{name, resting?}` — tool_calling/waiting_permission → thinking; `resting: true` (Otto patch) → the dim `idle` state (real turn end) |
| `model_detected`                        | `{agent, model}` — drives context-window size + cost rate                                                                            |
| `tool_call_start`                       | `{agent, tool, args, inputData?}` — `inputData.file_path` feeds the file-attention heatmap (Read/Edit/Write)                         |
| `tool_call_end`                         | `{agent, tool, result?, tokenCost?, isError?, errorMessage?}`                                                                        |
| `message`                               | `{agent, content, role: 'user'\|'assistant'\|'thinking'}` — first user message renames the main node                                 |
| `context_update`                        | `{agent, tokens, tokensMax?, breakdown?}`                                                                                            |
| `subagent_dispatch` / `subagent_return` | `{parent, child, task/summary}`                                                                                                      |
| `permission_requested`                  | `{agent}`                                                                                                                            |

Multi-session: the page keeps per-`sessionId` event buffers and renders session tabs; the host streams tagged events plus session lifecycle messages.

## Fonts & type scale

The page renders in **Otto's fonts at Otto's chat text size**, not the vendor's mono-everywhere Geist look. Ownership is split between the shell and one small vendor patch:

- **Shell stylesheet** (`emit-bundle.mjs`, emitted _after_ the bundle CSS so equal-specificity selectors win by order): maps `body`/`.font-sans`/`.font-mono` to `--otto-ui-font` and `.otto-code` to `--otto-code-font`, and scales the vendor's authored 9/10/11/12px DOM type ramp by `--otto-font-scale` so its 10px content size lands exactly on Otto's chat prose size (`theme.fontSize.sm`). Upstream uses `font-mono` as its general interface voice, which is why it maps to the _interface_ font — only genuinely-code surfaces (tool diff/command blocks, file paths) keep a monospaced face, via the `otto-code` marker class the vendor patch adds (see `OTTO-PATCHES.md`).
- **Why class overrides, not CSS variables:** the vendor's `globals.css` uses Tailwind v4 `@theme inline`, which bakes the Geist stacks directly into the emitted utilities — overriding `--font-mono`/`--font-sans` does nothing.
- **Embedded fonts:** the shell inlines Inter and JetBrains Mono 400 as `data:` `@font-face` (CSP already allows `font-src data:`) under the app's registered family names (`Inter_400Regular`/`JetBrainsMono_400Regular`), because the guest document is isolated from the app shell and can't see its webfonts. 400 only — same as the app registers — so browsers synthesize bolder weights identically.
- **Canvas text** (node labels, context bars, cost overlays, timeline ticks): the vendor hardcodes `"<size>px monospace"` in every `ctx.font` assignment, so a shell script patches the `CanvasRenderingContext2D.prototype.font` setter to rewrite the trailing `monospace` family onto the interface font. Sizes are left untouched — canvas glyphs are HUD elements sized to their boxes.
- **Live values:** `visualizer-panel.tsx` sends a shell-level `otto-appearance` message (`{uiFontFamily, codeFontFamily, chatFontSize}`, resolved by `packages/app/src/visualizer/visualizer-appearance.ts`, mirroring `applyAppearance` incl. the compact +2 bump) on the `ready` handshake and live on appearance-settings changes. The shell script consumes it (sets the CSS vars, `--otto-font-scale = chatFontSize / 10`); the vendor bridge ignores the unknown type. User-custom families resolve if installed on the machine and fall back to the embedded defaults.

## Theme colors

The page follows **the active app theme variant** (all 13, light and dark) instead of the vendor's fixed near-black/cyan hologram. Design intent, locked by `visualizer-theme.test.ts`:

- **The stage is always darker than the app background** — a step below even the sidebar — so the graph reads as its own space (user-locked). Dark variants go near-black (55% mix toward black); light variants stay unmistakably light (5% deepened paper) with **dark nodes and glyphs**.
- **The vendor's holographic cyan becomes the variant's accent** — glow, chrome, idle/thinking states, links — so every theme keeps a unique identity that matches the app.
- **Semantic hues ride the theme's own semantic tokens**: `statusWarning` for tool activity, `statusSuccess` for completion/cost, `statusDanger` for errors/live, `statusMerged` (purple) for thinking/reasoning/dispatch, `diffAddition`/`diffDeletion` for diffs.

Mechanics:

- **The seam is the vendor's own `COLORS` registry** (`web/lib/colors.ts`, ~130 tokens — upstream deliberately centralized it). A vendor patch (`OTTO-PATCHES.md`) merges `window.__OTTO_THEME__.colors` over it at module init; `packages/app/src/visualizer/visualizer-theme.ts` builds the full overlay from the variant palette (`buildVisualizerPalette`, per-scheme `darkProfile`/`lightProfile`).
- **Format rules are load-bearing:** vendor draw/component code appends 2-digit hex alphas to solid tokens (`COLORS.holoBase + '80'`, `stateColor + '90'`) and `withAlpha` appends to partial `rgba(r, g, b,` bases — every overlay value must keep its vendor token's exact shape. The theme test parses the vendor registry from source and asserts key-set + shape-for-shape coverage, so an upstream pull that adds/renames tokens fails loudly.
- **Baked per load, not live:** the palette is substituted into the shell's `__OTTO_THEME_JSON__` placeholder (`applyVisualizerTheme`, double-encoded for the shell's `JSON.parse("...")`) because the page consumes COLORS at module init and React renders — there is no repaint path. A theme change therefore **remounts the guest** (same contract as the dpr cap), and the panel's handshake-reset effect keys on the palette JSON.
- **Variant resolution avoids `useUnistyles()`:** the panel resolves the active variant from `settings.colorSchemeMode`/`lightTheme`/`darkTheme` plus RN `useColorScheme()` — exactly mirroring `applyColorScheme` (whose variant tables `apply-color-scheme.ts` now exports) — and builds from the static variant theme objects.
- **Stylesheet-level chrome** the registry can't reach (glass-card fills/borders/inputs/scrollbars in the vendor `globals.css`) is themed by shell CSS overrides reading `--otto-vis-*` variables, set by the shell script from the palette's `css` map; every var falls back to the vendor value so the demo shell keeps the upstream look.
- **Host-side containers** (iframe/webview backgrounds) paint the palette's stage color via the views' `themeBackground` prop, so guest load/resize never flashes black on light themes.

## The Otto → SimulationEvent adapter

`packages/app/src/visualizer/`: `visualizer-event-adapter.ts` holds the pure, unit-tested mapping functions (Otto timeline/stream shapes → `SimulationEvent`); `use-visualizer-event-adapter.ts` owns the stateful side — node-name registry, backfill fetch, live-stream cursor dedup, batching (~200ms tick, matching the page's own UI throttle).

**Sessions:** one visualizer session per **root** agent in the workspace (`session-started {session:{id: agentId, ...}}`). Any agent spawned by another tracked agent — observed Task children (`attend:"observed"`, `parent::sub::key` ids) AND attended `create_agent` children alike — does NOT get its own session: it rides inside the parent's session as a child node (`agent_spawn {parent}`), mirroring the subagents track. An observed child whose parent isn't in the tracked set yet is deferred (not registered as an orphan session) until a reconcile sees the parent.

**Time base:** the page's simulation clock runs in **seconds** from ~0 (rAF dt accumulation), and every lifetime constant (`TOOL_MAX_RUNNING_S` etc.) plus the control bar's m:ss readout assumes that scale. The adapter therefore stamps every event `time` as `(epochMs - adapterEpochMs) / 1000` (anchor = adapter activation; backfilled history clamps to 0). Feeding raw epoch-ms slammed the sim clock ~1.7e12 ahead per event — two events 200ms apart aged 200 "seconds", so running tools blew past max-running age between batches and faded while still active. Session-message fields (`startTime`/`lastActivityTime`) stay epoch-ms — the page mixes those with its own `Date.now()`.

**One `tool_call_start` per callId:** a long-running tool call streams repeated in-place updates of the same running item as output grows; re-emitting a start for each made every progress update spark a fresh outward-firing tool node on the page. The stateful adapter drops running updates for already-started callIds.

**Completion / when a node fades:** `reconcileAgents` emits `agent_complete` (which the page fades out non-main nodes on) from the pure `isVisualizerAgentTerminal` predicate, which **mirrors the subagents track's `isSubagentRowTidyEligible`** (`subagents/track-presentation.ts`) so a node leaves the graph exactly when the track collapses the row into "Completed": `closed`/archived always (roots included); for an `observed` subagent, also `idle` or `error` unless it's attention-flagged. This is load-bearing — a Claude Task ends its run at **`idle`** (not `closed`), so the old `closed || archived`-only test left completed Task nodes stuck active forever, and clearing them was flaky because the fade never fired. Terminal detection runs for freshly-registered nodes too, so a backfill that first sees an already-idle observed subagent still completes it. Attended/native agents idle between turns and are never faded on `idle`.

**Backfill + liveness:** on activation the adapter does a full `reset` + replay — fetches each new node's timeline via `client.fetchAgentTimeline(agentId, {direction:"tail", limit:0})` as one `agent-event-batch`, then streams live `agent_stream` events, using an epoch/seq cursor to avoid double-feeding the backfill/live overlap. **Every transition to active (page ready AND pane visible) triggers this same reset+replay** — that's also how the adapter recovers from the hidden-webview rAF stall (below), since `active` flips to `true` again on tab refocus.

**Node names must be stable and unique per session** — the page keys agents by `name`; `resolveAgentNodeName` disambiguates collisions with a short id suffix.

**Synthesized `tool_call_start` for coalesced fast tools:** the daemon's `agent-stream-coalescer.ts` replaces a buffered running tool-call entry in place (by `callId`) when the terminal status lands inside its ~60ms flush window, so a fast tool call reaches the client — live AND persisted-for-backfill — as a **single terminal item with no preceding running item**. The page silently drops a `tool_call_end` with no running match, which would hide most quick Reads/greps/small edits from the graph. The stateful adapter therefore tracks per-node `startedToolCallIds` and asks the pure mapper (`synthesizeToolCallStart`) to prepend the start (and, for `sub_agent` calls, the `subagent_dispatch`) when a terminal item's `callId` was never seen running.

## Runs (orchestration) scoping

An orchestration Run's "Visualize" action (`runs-screen.tsx` `RunCard`) opens a Visualizer tab scoped to that run's agent set instead of the workspace's general one. This is a **separate tab per run**, not the singleton workspace tab:

- Tab target: `{ kind: "visualizer", runId?: string }` — `runId` absent = the general, workspace-wide tab (still one per workspace); present = one tab per run, mirroring the `gitLog` target's one-per-operation shape (`packages/app/src/stores/workspace-tabs-store/state.ts`, `packages/app/src/workspace-tabs/identity.ts`).
- `collectRunAgentIds(run)` (`packages/app/src/hooks/use-runs.ts`) builds the agent-id set: the conductor plus every phase's spawned candidates. Also backs the existing token-cost rollup (`sumRunTokens`).
- `use-visualizer-event-adapter.ts`'s `agentIdFilter` (a `ReadonlySet<string>`, compared by reference — callers must memoize it **on membership, not on the runs query array**: every `runs.updated` push replaces the array even when membership didn't change, so `visualizer-panel.tsx` derives a sorted-joined id-string key first and only rebuilds the Set when that key changes; a fresh Set per push would reset + re-backfill the page on every status/progress update of a live run) restricts `selectWorkspaceAgents` to agents in the set OR whose resolved root (the same observed-subagent walk `ensureNode` already does) is in the set, so a run's spawned agents keep correct parent/child wiring even when the parent itself isn't literally one of the run's own ids.

## Open-file routing

The page's `open-file {filePath, line?}` message (sourced from tool-call telemetry's `inputData.file_path` — could be absolute or workspace-relative depending on which tool reported it) is routed through `normalizeWorkspaceFileLocation` (mapping `line` → `lineStart`/`lineEnd`) into `usePaneContext().openFileInWorkspace`, opening in the main pane.

## Risks / gotchas

- **Electron CSP:** the app-shell CSP is inherited by srcDoc/data iframes — Electron embedding must use `<webview>` on its own partition (see Embed above).
- **`will-attach-webview` allowlist:** the desktop main process (`packages/desktop/src/main.ts`) blocks every webview attach whose partition it doesn't recognize — silently: no error anywhere, the guest just never loads and `dom-ready` never fires (`executeJavaScript`/`openDevTools` then throw "must be attached to the DOM and dom-ready emitted"). Any new webview partition needs its own attach/harden/lockdown module (`features/visualizer-webview.ts`, mirroring `features/artifact-webview.ts`) wired into both `will-attach-webview` and `did-attach-webview`. Main-process change ⇒ full app restart, not hot reload.
- **No-GPU machines can show a blank tab — and it used to be silent.** On Linux hosts running the GPU software-rendering fallback (`--ozone-platform=x11 --use-gl=disabled`, `packages/desktop/src/gpu-fallback.ts`), the visualizer `<webview>` guest has been observed never loading/painting. A guest that never loads emits nothing (no `dom-ready`, no `ready`), and the panel's opaque load cover only fades post-`ready` — so the failure presented as a solid stage-colored tab with zero evidence anywhere. Diagnostics now make it loud: the desktop main process logs `[visualizer-webview]` attach / dom-ready / did-fail-load / renderer-gone lines plus a 20s never-reached-dom-ready watchdog (electron-log), and the panel shows a "couldn't start" state when the `ready` handshake doesn't arrive within 15s of the pane being visible (or the Electron view forwards `load-failed`). When triaging such a machine, check first whether browser-pane/artifact webviews render there (same `<webview>` mechanism), then try software GL instead of GL fully disabled: launch the binary with `--ozone-platform=x11 --use-gl=angle --use-angle=swiftshader` as **real process argv** plus `OTTO_FORCE_GPU=1` (to skip the marker relaunch that would append the default fallback flags) — `OTTO_ELECTRON_FLAGS`/`appendSwitch` is too late for the browser process's Ozone platform selection, which is why the CLI passthrough allowlist (`packages/desktop/src/daemon/cli/passthrough.ts`) lets these switches through. The render layer itself needs no GPU — it's all 2D canvas + DOM. When software rendering is active, the app **force-disables bloom** (the three-blur-passes-per-frame layer a CPU rasterizer can't afford): the desktop shell reports `softwareRendering` via `desktop_get_runtime_info` (`isSoftwareRenderingActive`, gpu-fallback.ts — marker or software argv), `useIsSoftwareRendering` caches it app-side, `visualizer-panel.tsx` sends `config.render.bloom: false` regardless of the setting, and the Settings → Visualizer bloom toggle shows off + disabled without clobbering the stored preference.
- **Electron `<webview>` guests freeze `vh`/`vw` units** at the initial guest viewport size — `window.innerHeight` updates on resize but `100vh` never recomputes. The vendor root is Tailwind `h-screen w-screen`, so without countermeasures the whole UI lays out in a phantom initial-size box. Two-part fix, both required: `autosize="on"` on the webview element (else the guest viewport itself can stick at its pre-attach size), and the shell CSS remapping `.h-screen`/`.w-screen` to the `html→body→#root` 100% chain, which does track resizes (`emit-bundle.mjs`).
- **Tailwind v4 source scanning misses the vendor tree:** the vendor's `globals.css` does `@import 'tailwindcss'`, and v4's auto-detection only scans the package it builds in (`packages/visualizer`) — not `vendor/agent-flow/web`. Without the `@source` directive in `packages/visualizer/src/otto-globals.css`, the build "succeeds" with ~9 KB of CSS and **zero layout utilities**: every `absolute`/`flex`/`h-full` in vendor markup silently no-ops and the HUD collapses into document flow. If the page ever looks structurally broken after a build change, check the emitted `dist/index.css` size (~24 KB healthy) before debugging anything else.
- **devicePixelRatio is capped in the shell via a placeholder** (`emit-bundle.mjs` `__OTTO_DPR_CAP__`, substituted per the Sharpness setting — see "`config.render` (Otto patch)" above): the vendor sizes its canvas backing store and bloom blur buffers by dpr, and at native 2× a maximized pane is a ~6M-pixel store with a 3-pass blur every frame — measured 14 FPS vs 52 at cap 1 and 25 at cap 1.5. Unsubstituted (the `--demo` build) the placeholder parses NaN and falls back to 1. Tune with the dev-only in-guest FPS meter (`visualizer-view.electron.tsx`); disabling bloom (`config.render`) is the other big lever.
- **The Electron view loads the shell as a `data:` URL, which Chromium caps at 2 MB.** With the embedded fonts the encoded URL is ~1.2 MB; anything that grows the shell meaningfully (more font faces, more weights) must re-check `encodeURIComponent(html).length` against that cap or the guest silently never loads.
- **`executeJavaScript` before `dom-ready` throws** — even once the element is DOM-attached (`isConnected` is not enough). The Electron view queues `postMessage` payloads until `dom-ready` and flushes them there; keep that queue when refactoring.
- **Hidden panes stop the world:** the page processes events only inside `requestAnimationFrame`, and hidden/occluded webviews don't fire rAF. Events keep buffering (per-session buffers are authoritative) and flush on session re-selection — the adapter's reset+replay-on-reactivation handles this; don't try to "fix" a frozen hidden pane, it's expected.
- **Paused-player event drop (upstream quirk):** in `use-agent-simulation.ts`, pending external events are captured and consumed _before_ the `isPlaying` check — events arriving while paused are dropped from the live view (still recoverable from the session buffer via reset+replay). Don't fight it in the adapter.
- **`config {showMockData:true, mode:'replay', autoPlay:true}`** is how a host shows the built-in demo scenario — the dev-only "Load demo scenario" button in `visualizer-panel.tsx` sends exactly this.
- **knip:** `knip.json` has per-workspace config; add an entry for `packages/visualizer` if knip starts complaining about it.

# Otto patches to vendor/agent-flow

Apache 2.0 requires stating significant changes made to the licensed work.
This file is that notice. `vendor/**` is otherwise pristine upstream — see
`docs/visualizer.md` for the no-edits rule and why patches
here (rather than a fork-wide diff) are the exception, logged one entry per
patch, oldest first. Each entry should be small enough to re-apply by hand
after a `git subtree pull` if the upstream diff conflicts with it.

## 2026-07-15 — widen the agent-runtime brand mapping (projects/visualizer/tasks/04-polish.md item 4)

Upstream only recognizes `runtime: 'claude' | 'codex'` — every other value
(including Otto's `copilot`/`opencode`/`pi`/`openai-compat` providers)
collapsed to `undefined` and rendered the Claude spark by default. Patched to
give each of Otto's five providers a visually distinct main-agent mark
without adding any new brand assets (TRADEMARK.md forbids shipping
non-Claude/Codex logos):

- `web/lib/agent-types.ts` — `Agent['runtime']` widened to `'claude' | 'codex' | 'copilot' | 'opencode' | 'pi' | 'openai-compat'`.
- `web/hooks/simulation/handle-agent-events.ts` — `handleAgentSpawn` now passes through any of the six known literals instead of only `'codex'`.
- `web/components/agent-visualizer/canvas/draw-agents.ts` — `drawAgentBrand` still draws the real Claude spark / OpenAI mark for `claude`/`codex`; every other known runtime gets a new generic hollow-diamond mark (`drawGenericRuntimeMark`, reusing the sub-agent glyph style) instead of silently falling back to the Claude spark.

Otto-side counterpart: `packages/app/src/visualizer/visualizer-event-adapter.ts`
`resolveVisualizerRuntime` maps Otto's provider ids (`claude`, `codex*`,
`copilot`, `opencode`, `pi`, `omp` → `'openai-compat'`) to these literals.
User-defined custom openai-compatible providers (arbitrary ids) still map to
`undefined` and get the Claude-spark default — acceptable per the task doc.

## 2026-07-15 — host-seedable initial panel visibility (projects/visualizer/tasks/04-polish.md item 2)

Upstream's panel-visibility booleans (`showStats`/`showHexGrid`/`showCostOverlay`/
`showTimeline`/`showFileAttention`/`showTranscript` in
`web/components/agent-visualizer/index.tsx`) were pure internal `useState`
with no external config hook, and the message-feed panel had no visibility
toggle at all (always rendered). A host embed (Otto) had no way to seed which
panels start open. Patched to add an optional `panels` field to the bridge
`config` message, applied on every config message that carries it:

- `web/lib/vscode-bridge.ts` — new exported `PanelsConfig` type (`Partial<{timeline, fileAttention, transcript, messageFeed, costOverlay, hexGrid}>`), added to `ConfigCallback`'s config union.
- `web/hooks/use-vscode-bridge.ts` — new `panelsConfig` state/return field, set from `config.panels` in the existing `onConfig` handler.
- `web/components/agent-visualizer/index.tsx` — new `showMessageFeed` state (default `true`, matching the prior always-on behavior) gating `<MessageFeedPanel>`; a `useEffect` on `bridge.panelsConfig` applies `hexGrid`/`timeline`/`messageFeed` directly and resolves the pre-existing mutually-exclusive trio (`fileAttention`/`transcript`/`costOverlay`, see `toggleExclusivePanel`) by priority (files > transcript > cost) instead of allowing more than one true at once.

Otto-side counterpart: device-local settings in
`packages/app/src/hooks/use-settings/storage.ts` (`visualizerPanel*` fields)
surfaced in Settings → Appearance (developer mode only), sent as the initial
`config.panels` message from `packages/app/src/panels/visualizer-panel.tsx`
on the page's `ready` handshake.

## 2026-07-15 — always show the session tabs bar

Upstream's top bar hides the session tabs entirely below two sessions
(`sessions.length > 1`), leaving a single-session view with no indication of
WHICH chat the graph is visualizing — in Otto's embed (one visualizer session
per attended root agent) that made the tab feel unlabeled and unswitchable.
Patched to render from one session up:

- `web/components/agent-visualizer/top-bar.tsx` — `sessions.length > 1` → `sessions.length > 0` around `<SessionTabs>`.

Otto-side counterpart: `packages/app/src/visualizer/use-visualizer-event-adapter.ts`
orders replayed session messages so the most-recently-active chat's
`session-started` is sent last — the page auto-selects the last `started` it
receives, so selection lands on the chat the user actually used last instead
of an arbitrary replay-order artifact.

## 2026-07-15 — host-toggleable render layers (`config.render`)

The canvas pipeline unconditionally rendered every decorative layer — the
bloom post-process (three full-canvas blur passes + additive composite per
frame, the single most expensive draw stage), the 80 parallax depth
particles, and the void-fill backdrop with its ambient spotlight. A host
embed had no way to trade them for frame rate or a calmer look. Patched to
add an optional `render` field to the bridge `config` message, mirroring the
`panels` patch:

- `web/lib/vscode-bridge.ts` — new exported `RenderConfig` type (`Partial<{bloom, stars, backdrop}>`), added to `ConfigCallback`'s config union.
- `web/hooks/use-vscode-bridge.ts` — new `renderConfig` state/return field, set from `config.render` in the existing `onConfig` handler.
- `web/components/agent-visualizer/index.tsx` — passes `renderOptions={bridge.renderConfig ?? undefined}` to `<AgentCanvas>`.
- `web/components/agent-visualizer/canvas.tsx` — new optional `renderOptions` prop threaded through `drawPropsRef`; `bloom: false` skips the `BloomRenderer.apply` call, `stars: false` skips `updateDepthParticles` and passes an empty particle list, `backdrop: false` is forwarded to `drawBackground`. Omitted keys keep every layer on (upstream behavior unchanged).
- `web/components/agent-visualizer/background-layer.ts` — `drawBackground` gains a trailing `showBackdrop = true` param wrapping the void fill + ambient spotlight.

Otto-side counterpart: `visualizerRender*` device-local settings surfaced in
the dedicated Settings → Visualizer section, sent as `config.render` from
`packages/app/src/panels/visualizer-panel.tsx` (on ready and live on change).

## 2026-07-15 — semantic code-font markers (`otto-code`) + drop the splash's hardcoded mono stack

Upstream's DOM styling uses `font-mono` as its *general interface voice*, not
as a code marker — nearly every label, badge, and message renders monospaced.
Otto restyles the page to its own interface font (the shell stylesheet in
`packages/visualizer/scripts/emit-bundle.mjs` overrides `.font-sans`/
`.font-mono`; see docs/visualizer.md "Fonts & type scale"), which erases the
mono-everywhere look — but a few surfaces genuinely ARE code and must keep a
monospaced (code-font) face. Since `font-mono` can't distinguish them, patched
to add an `otto-code` marker class (defined only in the Otto shell CSS; inert
under upstream's own build) to the genuinely-code surfaces:

- `web/components/agent-visualizer/tool-content-renderer.tsx` — the `FilePath` row, the Edit diff block, the Bash command block, the Write content block, the Grep/Glob pattern rows, and the WebFetch URL row.
- `web/components/agent-visualizer/file-attention-panel.tsx` — the file-path span in each heatmap row.
- `web/components/agent-visualizer/index.tsx` — the empty-state splash dropped its inline `'SF Mono', 'Fira Code', monospace` style for a plain `font-mono` class, so it follows the page-wide font overrides instead of pinning its own stack.

Otto-side counterpart: `emit-bundle.mjs` defines `.otto-code { font-family:
var(--otto-code-font) }` and the host seeds/updates that variable (plus the
interface font and type scale) via the shell-level `otto-appearance` message
sent from `packages/app/src/panels/visualizer-panel.tsx`.

## 2026-07-15 — host-seedable color palette (`window.__OTTO_THEME__`)

Upstream ships one fixed holographic palette (near-black void, cyan glow) in
`web/lib/colors.ts` — remarkably centralized (the COLORS registry carries
~130 tokens precisely to avoid scattered rgba literals), but with no external
hook. An embedding host had no way to make the page follow its own theme.
Patched to make the registry seedable at boot:

- `web/lib/colors.ts` — after the `COLORS` literal (and before `ROLE_COLORS`
  or any importer reads it), an optional `window.__OTTO_THEME__.colors`
  overlay is merged over the defaults via `Object.assign`. The global must be
  set BEFORE the bundle executes (Otto's shell script does, from a build-time
  placeholder); absent, nothing changes. Overlay values must keep each
  token's exact shape — 6-digit hex for solids (draw/component code appends
  2-digit hex alphas), partial `rgba(r, g, b,` bases for `withAlpha`, etc.
- `web/components/agent-visualizer/file-attention-panel.tsx` — the one stray
  hardcoded row background (`rgba(10, 15, 30, 0.5)`) now routes through
  `withAlpha(COLORS.toolCardBase, 0.5)` so it themes with everything else.
- `web/components/agent-visualizer/index.tsx` — the empty-state splash's two
  hardcoded `#66ccff` text colors now derive from `COLORS.holoBase`.

Otto-side counterpart: `packages/app/src/visualizer/visualizer-theme.ts`
builds the full overlay from the active app theme variant (all 13 variants,
light and dark) and `packages/visualizer/scripts/emit-bundle.mjs` bakes it
into the shell via the `__OTTO_THEME_JSON__` placeholder; a `visualizer-theme`
unit test parses this file's COLORS registry from source and fails when an
upstream pull adds or renames tokens the overlay misses.

## 2026-07-16 — host-controlled master audio volume (`config.soundVolume`)

Upstream's `AudioEngine` master volume was a fixed private `_volume = 0.5`,
reachable only via the in-page mute toggle (on/off, persisted in
`localStorage[agent-viz-sound]`, which resets every run on Otto's fresh
webview partition — so sound effectively always started muted). A host embed
had no way to set the level. Patched to add an optional `soundVolume` field to
the bridge `config` message, mirroring the `panels`/`render` patches:

- `web/lib/audio-engine.ts` — new `setVolume(volume: number)` (clamps 0..1, ramps the master gain live when unmuted, otherwise stores it for the next lazy `ensureContext`).
- `web/lib/vscode-bridge.ts` — `soundVolume: number` added to `ConfigCallback`'s config union.
- `web/hooks/use-vscode-bridge.ts` — new `soundVolume` state/return field (`number | null`), set from `config.soundVolume` in the existing `onConfig` handler.
- `web/hooks/use-audio-effects.ts` — new optional `hostVolume` param; when non-null it's authoritative: applies the level via `setVolume` and drives the mute state (`volume <= 0` ⇒ muted) so the in-page mute toggle's icon stays truthful.
- `web/components/agent-visualizer/index.tsx` — threads `bridge.soundVolume` into `useAudioEffects`.

Otto-side counterpart: `visualizerSoundVolume` device-local setting (0-100
percent, the LEVEL used when unmuted) surfaced as a Volume slider in the
Settings → Visualizer "Sound" section, and `visualizerSoundMuted` (default true
— sound stays opt-in) driven by the in-page speaker button. The panel sends the
effective master volume as `config.soundVolume` (`muted ? 0 : volume/100`) from
`packages/app/src/panels/visualizer-panel.tsx` on ready and live on change.

The in-page mute toggle reports back so the preference is durable (the page's
own `localStorage[agent-viz-sound]` resets every run on Otto's fresh webview
partition). Additional patch surface:

- `web/lib/vscode-bridge.ts` — new `setSoundMuted(muted)` posting a `sound-muted` page->host message (mirrors `openFile`).
- `web/hooks/use-vscode-bridge.ts` — new `bridgeSetSoundMuted` passthrough (mirrors `bridgeOpenFile`).
- `web/hooks/use-audio-effects.ts` — new optional `onMuteChange` param, fired from `handleToggleMute` alongside the localStorage write.
- `web/components/agent-visualizer/index.tsx` — threads `bridge.bridgeSetSoundMuted` into `useAudioEffects`.

Otto host: `packages/app/src/panels/visualizer-panel.tsx` handles the
`sound-muted` message by persisting `visualizerSoundMuted`, which re-seeds the
page via the `config.soundVolume` effect. Unmuting therefore restores exactly
the current slider level.

## 2026-07-16 — whole-HUD visibility toggle (`config.hudHidden`)

Upstream has per-panel toggles (Files/Chat/Cost/Timeline/mute) but no way to
collapse the entire HUD at once — a host embed had no lever to give the user a
clean, chrome-free view of just the graph. Patched to add an optional
`hudHidden` field to the bridge `config` message and a single always-visible
in-page toggle button, mirroring the `soundVolume`/`sound-muted` round-trip:

- `web/lib/vscode-bridge.ts` — `hudHidden: boolean` added to `ConfigCallback`'s config union; new `setHudHidden(hidden)` posting a `hud-hidden` page->host message (mirrors `setSoundMuted`).
- `web/hooks/use-vscode-bridge.ts` — new `hudHidden` state/return field (`boolean | null`), set from `config.hudHidden` in the existing `onConfig` handler; new `bridgeSetHudHidden` passthrough (mirrors `bridgeSetSoundMuted`).
- `web/components/agent-visualizer/index.tsx` — new local `hudHidden` state, applied from `bridge.hudHidden` on every config that carries it (authoritative, like the panels seed). All HUD chrome (message feed, agent/tool/discovery popups, chat panel, context menu, control bar, file-attention/transcript/timeline panels, top bar) is wrapped in `{!hudHidden && (…)}`; only the `<AgentCanvas>` and a new bottom-left toggle button survive. The button reports the flip via `bridge.bridgeSetHudHidden` so it persists. Icons are inline eye / eye-off SVGs (same style as the mute icons); colors/glass come from the themed `COLORS` registry.

Otto-side counterpart: `visualizerHudHidden` device-local setting (default
false) in `packages/app/src/hooks/use-settings/storage.ts`. The panel sends it
as `config.hudHidden` on ready and live on change, and persists the
`hud-hidden` page->host message back into it — so the toggle is shared by every
Visualizer tab at once (they all read the one device-local setting) and
survives restarts. There is intentionally no Settings row: like the mute
toggle, the in-page button is the whole control.

## 2026-07-16 — stabilize the node label against the breathe pulse

Idle/thinking/waiting agent nodes "breathe" — their draw radius `r` oscillates
each frame (`radius * breathe * agent.scale` in `drawAgents`). Upstream passed
that pulsing `r` straight into `drawAgentLabel`, which used it for both the
label's truncation width (`maxLabelW = r * labelWidthMultiplier`) and its Y
position. So the available label width oscillated every frame, `truncateText`
re-solved its binary search, and the ellipsis on a truncated name visibly
crawled in and out (and the label bobbed vertically) in time with the pulse.
Patched to give the label a radius that excludes the breathe factor:

- `web/components/agent-visualizer/canvas/draw-agents.ts` — `drawAgents` now
  computes `labelR = radius * agent.scale` (base size + one-time spawn/entry
  scale, but NOT `breathe`) and passes it to `drawAgentLabel` in place of the
  pulsing `r`. `drawAgentLabel`'s param is renamed `labelR` and used for both
  the truncation width and the Y offset, so the label's bounding box stays a
  fixed size and position while the node pulses. The node glyph/rings/glow keep
  using the pulsing `r` — only the label is stabilized.

No Otto-side counterpart; purely a vendor-local rendering fix. Upstream-PR
candidate.

## 2026-07-16 — reword the empty-state splash for Otto's embed

Upstream's empty-state copy ("WAITING FOR AGENT SESSION" / "Start a Claude
Code session to see activity") is shouty and Claude-Code-specific — in Otto's
embed the visualizer covers every provider and sessions are "agent chats".
Reworded to sentence case and Otto vocabulary:

- `web/components/agent-visualizer/index.tsx` — empty-state title →
  "Waiting for chat activity", subtitle → "Create a new agent chat to
  visualize".

No Otto-side counterpart; copy-only.

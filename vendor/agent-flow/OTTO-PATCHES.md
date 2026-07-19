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
Settings → Visualizer "Sound" section, and `visualizerSoundMuted` (default
false — first-time users hear the feature at the default 50% level) driven by
the in-page speaker button. The panel sends the
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
- `web/components/agent-visualizer/index.tsx` — new local `hudHidden` state, applied from `bridge.hudHidden` on every config that carries it (authoritative, like the panels seed). The HUD *chrome* — the top bar and the bottom control bar — is wrapped in `{!hudHidden && (…)}`; informational surfaces (message feed, agent/tool/discovery popups, chat panel, context menu, slide-in panels) stay visible, because hiding the HUD means clearing the chrome, not blinding the user (originally the gate wrapped everything; narrowed 2026-07-16 on user feedback). The `<AgentCanvas>` and a bottom-left toggle button always survive. The button reports the flip via `bridge.bridgeSetHudHidden` so it persists. Icons are inline eye / eye-off SVGs (same style as the mute icons); colors/glass come from the themed `COLORS` registry.

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

## 2026-07-16 — top-bar copy tweaks for Otto's embed

Label rewording in the top bar:

- Upstream labels the cost-overlay toggle "$Cost"; the dollar prefix reads as
  a stray template placeholder rather than a currency hint.

- `web/components/agent-visualizer/top-bar.tsx` — `$Cost` → `Cost` in the
  cost-overlay `ToggleButton`.

(The same day this entry briefly also renamed the node counter "N agents" →
"N chats"; reverted on user feedback — the count is graph nodes in the
selected session, not session tabs, so "chats" was the misleading label.)

No Otto-side counterpart; copy-only.

## 2026-07-16 — top bar: drop the connection indicator, shrink-safe right block

Upstream's top bar renders a LIVE/CONNECTED/OFFLINE dot when embedded
(`isVSCode`), and its right-side info/controls block is `flex-shrink-0` — on a
narrow pane it overflows past the right edge (the bottom control bar, by
contrast, is bounded by `maxWidth` + internal `flex-1` shrink and adapts).
In Otto's embed the page is always connected to its own host, so the
indicator read as an optional link that could drop:

- `web/components/agent-visualizer/top-bar.tsx` — `ConnectionIndicator`
  removed along with the `isVSCode`/`connectionStatus` props; the right-side
  block becomes `flex-shrink min-w-0 flex-wrap justify-end gap-x-4 gap-y-1`
  with `whitespace-nowrap` stat spans, so it wraps/shrinks on narrow panes
  instead of going off-page.
- `web/components/agent-visualizer/index.tsx` — stops passing the two props.

No Otto-side counterpart.

## 2026-07-16 — session tabs: vertical left-edge column, above the toolbar

Upstream's top bar lays the session tabs and the right-side info/controls out
as a single horizontal flex row. In Otto's embed the tabs shared that row and
z-index (`Z.info`) with the toolbar, so on a narrow pane the toolbar squeezed
and clipped the tab labels. User wants the sessions stacked as a column down
the side, and never cut off by the toolbar:

- `web/components/agent-visualizer/top-bar.tsx` — the single flex row becomes a
  fragment of two independently-anchored absolute blocks: the session tabs at
  `top-3 left-3` with `zIndex: Z.info + 1` (so the toolbar can never overlap
  them) and `maxHeight: calc(100% - 6rem)` + `overflow-y-auto` (percentage, not
  `vh` — `vh` is frozen in the Electron webview guest); the info/controls block
  at `top-3 right-3` with `zIndex: Z.info` and `maxWidth: calc(100% - 6rem)`.
  The old flex spacer is dropped.
- `web/components/agent-visualizer/session-tabs.tsx` — the tab container
  `flex gap-1` → `flex flex-col items-start gap-1` so the pills stack vertically
  and stay shrink-wrapped to their labels.

No Otto-side counterpart.

## 2026-07-16 — `agent_idle` learns a `resting` flag (true idle vs thinking)

Upstream's `agent_idle` event means "tool finished — back to reasoning": it
transitions `tool_calling`/`waiting_permission` → `thinking`, and nothing ever
sets the (visually distinct, dimmer) `idle` state after spawn. In Otto's
embed an agent that finished its turn therefore pulsed "thinking" forever —
idle and working looked identical:

- `web/hooks/simulation/handle-agent-events.ts` — `handleAgentIdle` reads an
  optional `resting: true` payload flag: when set, any non-complete state
  transitions to `idle` (and `currentTool` clears). Without the flag the
  upstream behavior is unchanged.

Otto-side counterpart: `packages/app/src/visualizer/visualizer-event-adapter.ts`
sends `resting: true` on `turn_completed`/`turn_failed`/`turn_canceled` and
keeps the plain form for `permission_resolved` (the agent resumes reasoning).

## 2026-07-16 — center the node depth shadow

`drawDepthShadow` used `shadowOffsetX: 3 / shadowOffsetY: 5`, but canvas
shadow offsets apply in untransformed device space while the node is drawn
inside the camera transform — at typical zoom the offset smeared the blurred
disc to one side (read as a shadow only on the top/left) instead of reading
as depth:

- `web/lib/canvas-constants.ts` — `AGENT_DRAW.shadowOffsetX/Y` → `0`, so the
  15px blur halos the node evenly on all sides.

No Otto-side counterpart. Upstream-PR candidate.

## 2026-07-16 — bloom on light stages + downsample smoothing

The bloom pass blurs the whole frame and composites it back with additive
(`'lighter'`) blending — correct on the upstream near-black stage, but on
Otto's light theme variants it adds brightness to an already-bright frame:
values clamp toward white and the glow vanishes ("bloom not working in light
mode"). The half-res buffer also temporal-aliases 1–2px features (the
parallax stars) as they cross pixel boundaries, which reads as flicker:

- `web/components/agent-visualizer/bloom-renderer.ts` — reads the themed
  stage background (`COLORS.void`, host-seeded via `window.__OTTO_THEME__`);
  when its relative luminance is light (> 0.5), composites with `'multiply'`
  at `intensity * BLOOM_LIGHT_STAGE_ALPHA` instead — dark glyphs bleed a soft dark halo, the
  light-stage analog of bloom. Also sets `imageSmoothingQuality = 'high'` on
  both work buffers to soften the half-res shimmer.

No Otto-side counterpart (the theme overlay already carries the stage color).

## 2026-07-16 — re-engage camera auto-fit when a new agent spawns

Manual pan/zoom sets `userHasNavigatedRef` and permanently disengages the
camera's per-frame auto-fit — only the zoom-to-fit button or a selection
change re-arms it. In a live orchestration a subagent that spawns outside the
current viewport therefore stayed invisible, with nothing on screen hinting a
new node existed ("the connection appeared but the agent was off screen"):

- `web/hooks/use-canvas-camera.ts` — an `agentCount` increase clears
  `userHasNavigatedRef` (and the in-flight lerp target), re-engaging auto-fit
  so the fresh node lerps into frame. A selected non-main agent keeps its
  focused-subtree fit (`computeFitTransform`'s focus scope is unaffected).

No Otto-side counterpart. Upstream-PR candidate.

## 2026-07-16 — don't cascade agent_complete to child agents

`handleAgentComplete` marked every child of the completed agent complete too.
Otto emits a real per-agent lifecycle for every node, and a parent can
legitimately finish while its spawned children keep running (Claude's
background Task handoff: the parent's tool_result returns while the child
continues, settling later via task_notification) — the cascade faded live
child nodes out of the graph mid-run:

- `web/hooks/simulation/handle-agent-events.ts` — `handleAgentComplete` no
  longer touches children; it completes only the named agent and its own
  running tool calls. Children complete on their own `agent_complete`.

Otto-side counterpart: the adapter re-emits `agent_spawn` when a settled row
revives (`use-visualizer-event-adapter.ts` resurrection branch), so even a
prematurely-completed node returns to the graph.

## 2026-07-16 — honest token/cost totals via cumulativeTokens

The top bar's token count and ~$ cost summed each live agent's `tokensUsed`
— which is context OCCUPANCY, not spend: subagents (whose context never
reaches the page) contributed nothing, and a completed child's share vanished
entirely when `cleanupFaded` deleted its node. The number read as "cost of
the chat's context" instead of the run's total:

- `web/lib/agent-types.ts` — `Agent.cumulativeTokens?: number`, the host
  -reported honest lifetime total for that agent's whole run.
- `web/hooks/simulation/handle-message-events.ts` — `context_update` accepts
  an optional `cumulativeTokens` payload field; `tokens` is optional now so a
  cumulative-only update can't clobber the occupancy reading to 0.
- `web/hooks/simulation/types.ts` + `animate.ts` — `SimulationState.
  retiredTokens` banks `cumulativeTokens ?? tokensUsed` of agents deleted by
  `cleanupFaded`, so completed children keep counting. (Seek/replay rebuilds
  from the event log and does not reconstruct retired totals — acceptable for
  the live view the readout serves.)
- `web/components/agent-visualizer/index.tsx` — `totalTokens = retiredTokens
  + Σ (cumulativeTokens ?? tokensUsed)`.
- `web/components/agent-visualizer/canvas/draw-cost.ts` — per-agent cost
  pills and the cost summary panel prefer `cumulativeTokens` the same way.

The context ring/composition bar still read `tokensUsed` — occupancy is the
right meaning there. Otto-side counterpart: the adapter sends
`cumulativeTokens` on `context_update` from the agent snapshot's universal
token accumulator (`use-visualizer-event-adapter.ts` reconcile).

## 2026-07-16 — remove the chat-transcript & message-feed panels from Otto's embed

The visualizer is a companion to the real chat the user already has open, so
reproducing chat message content inside the graph is pure duplication (user
feedback). Removed the two message-content surfaces that duplicated the
transcript — the "Chat" transcript panel and the top-left message feed — while
keeping the per-node chat panel (click a node to see that one agent's
messages), the Files heatmap, and the Cost overlay:

- `web/components/agent-visualizer/index.tsx` — dropped the
  `SessionTranscriptPanel` and `MessageFeedPanel` imports + render sites, the
  `showTranscript`/`showMessageFeed` state, the `sessionConversation` memo, and
  the transcript/messageFeed branches of the `config.panels` seed effect. The
  mutually-exclusive panel group (`toggleExclusivePanel`) is now just
  files/cost. The `AgentChatPanel` render (and its `selectedConversation` /
  `sessionRuntime` inputs) is untouched.
- `web/components/agent-visualizer/top-bar.tsx` — dropped the "Chat"
  `ToggleButton` and the `showTranscript` prop; `onTogglePanel`'s type narrows
  to `'files' | 'cost'`.
- `web/hooks/use-keyboard-shortcuts.ts` — dropped the `toggleTranscript`
  (`c`/`C`) and `closeTranscript` (`Escape`) actions.
- `web/lib/vscode-bridge.ts` — `PanelsConfig` drops `transcript` and
  `messageFeed`.

The `session-transcript-panel.tsx` and `message-feed-panel.tsx` component files
are left in the tree (now unimported, tree-shaken out of the bundle) to keep the
subtree-pull diff small; only the wiring was removed.

Otto-side counterpart: `visualizerPanelTranscript` / `visualizerPanelMessageFeed`
device-local settings removed (`packages/app/src/hooks/use-settings/storage.ts`),
their Settings → Visualizer "Panels" rows removed (`visualizer-section.tsx`),
the `config.panels` payload + host→page type trimmed (`visualizer-panel.tsx`,
`visualizer-view-types.ts`), and the now-orphaned i18n keys removed across all
locales.

## 2026-07-16 — host-selectable agent-node shape (`config.render.nodeShape`)

The agent nodes were hardcoded to a hexagon silhouette — every body layer
(depth shadow, glow fill + ambient ring, scanline clip, state ring, waiting
ripples) called `drawHexagon` directly. Patched to let the host pick the node
shape (square / hexagon / octagon / circle), threaded through the same
`config.render` seam as the render-layer toggles:

- `web/lib/agent-types.ts` — new exported `NodeShape` type (`'square' | 'hexagon' | 'octagon' | 'circle'`).
- `web/components/agent-visualizer/canvas/draw-misc.ts` — new `drawNodeShape(ctx, x, y, radius, shape)` dispatcher (plus a private `tracePolygon` helper); `drawHexagon` kept as-is (the hexagon case, and still used elsewhere).
- `web/components/agent-visualizer/canvas/draw-agents.ts` — the five node-body helpers (`drawDepthShadow`, `drawAgentGlow`, `drawScanline`, `drawStateRing`, `drawWaitingRipples`) take a `NodeShape` and call `drawNodeShape` instead of `drawHexagon`; `drawAgents` gains a trailing `shape: NodeShape = 'hexagon'` param. The center brand/glyph icon and the circular context ring are shape-agnostic and unchanged.
- `web/lib/vscode-bridge.ts` — `RenderConfig` gains an optional `nodeShape: NodeShape` (omitted → historical hexagon).
- `web/components/agent-visualizer/canvas.tsx` — `renderOptions` type gains `nodeShape?`; the draw loop reads `renderOptions?.nodeShape ?? 'hexagon'` and passes it to `drawAgents`.

The transient spawn/complete burst ring in `draw-effects.ts` follows the
selected shape too (see the follow-up patch below). Otto-side counterpart: the
`visualizerNodeShape` device-local setting (Settings → Visualizer "Rendering",
**default `circle`**), sent as `config.render.nodeShape` from
`packages/app/src/panels/visualizer-panel.tsx` (on ready and live on change —
applied per-frame, no guest reload).

## 2026-07-16 — node-shape follow-ups: burst ring follows the shape, default circle

Two tweaks to the node-shape patch above:

- `web/components/agent-visualizer/canvas/draw-effects.ts` — `drawEffects` gains
  a trailing `nodeShape: NodeShape = 'hexagon'` param; the spawn ring (was
  `drawHexagon`) and the completion ring (was a bare `ctx.arc` circle) now trace
  the host-selected silhouette via `drawNodeShape`, so the ring emitted from a
  node matches the node's shape instead of always being a hexagon. The soft
  radial glow behind the completion ring stays circular (it's a blur, not a
  silhouette). The shatter effect is particles — shape-agnostic, unchanged.
- `web/components/agent-visualizer/canvas.tsx` — passes `nodeShape` into
  `drawEffects`.

Otto-side counterpart: the `visualizerNodeShape` device-local default flipped
from `hexagon` to `circle` (`packages/app/src/hooks/use-settings/storage.ts`) —
new users get circular nodes. The vendor-side `?? 'hexagon'` fallbacks (canvas
draw loop, `drawAgents`, `drawEffects`) are unchanged: they only apply when the
host sends no shape at all, which the panel never does.

## 2026-07-16 — settle backfilled history on attach instead of replaying it (`hydrate`)

Bringing a Visualizer into view (initial attach, tab refocus, workspace switch)
makes the host do a full `reset` + replay — it refetches each node's entire
timeline and ships it as one batch. The page fed those historical events
through the live animate path (`use-agent-simulation.ts` bumps every incoming
event's time to *now*), so opening an existing chat replayed the whole run at
once: every spawn burst, tool spark, and message bubble fired again, with
sound, as if it were all happening live. The user expects to see the state they
came into, not watch it re-play. Patched to let the host mark a batch as
backfilled history and have the page jump to the settled end state:

- `web/lib/agent-types.ts` — `SimulationEvent.hydrate?: boolean`.
- `web/lib/bridge-types.ts` — `AgentEvent.hydrate?: boolean`.
- `web/lib/vscode-bridge.ts` — the `agent-event-batch` handler stamps
  `hydrate: true` onto each event when the batch message carries `hydrate: true`.
- `web/hooks/use-vscode-bridge.ts` — carries the flag onto the constructed
  `SimulationEvent`. Hydrate events flow through the normal per-session buffer +
  pending paths; the settle keys on the per-event flag, so it works whether an
  event reaches the sim live or via a buffered session replay.
- `web/hooks/simulation/settle-visual-state.ts` (new) — `settleVisualState`, a
  time-independent counterpart to `snapVisualState` (the scrubber's seek snap):
  the replayed history is all stamped ~t0, so an age-based drop keeps
  everything, so this hard-settles instead — drops every finished tool card,
  message bubble, and particle/discovery, keeps only still-*running* tools,
  sets node opacities to their settled values (>= `MIN_VISIBLE_OPACITY`, so the
  canvas frame-diff detector fires no spawn burst), and banks dropped completed
  sub-agents' tokens into `retiredTokens` (mirroring `animate.ts` `cleanupFaded`).
- `web/hooks/use-agent-simulation.ts` — the animate loop flags a frame that
  processed any `hydrate` event and, after `computeNextFrame`, runs
  `settleVisualState` on the result and raises `suppressAudioRef`; the frame
  bypasses the UI-update throttle so the settled state reaches the audio effect
  the same tick. New `suppressAudioRef` option (`UseAgentSimulationOptions` in
  `web/hooks/simulation/types.ts`).
- `web/hooks/use-audio-effects.ts` — new `suppressRef` param (read-and-cleared)
  mutes a hydrate-settle frame's spawn/tool sounds. The transition-diff now
  *always* advances `prevAgentStatesRef`/`prevToolStatesRef` (previously it
  early-returned before updating them when muted), so a muted window
  (seek/review/hydrate) no longer leaves the baseline stale and burst every
  accumulated sound on the next audible frame.
- `web/components/agent-visualizer/index.tsx` — owns the `suppressAudioRef` and
  threads it into both hooks.

The event *content* still lands in `conversations` / `timelineEntries` (the
handlers run during the settle), so the per-node chat panel and the timeline
keep the full history — only the transient canvas animation + sound are skipped.
Live batches after the initial backfill window animate normally.

Otto-side counterpart: `packages/app/src/visualizer/use-visualizer-event-adapter.ts`
carries a `hydrating` flag on the adapter state (true until the one-shot
backfill flush resolves) and tags every batch flushed in that window
`hydrate: true` (`flush`); `packages/app/src/visualizer/visualizer-view-types.ts`
adds the optional field to the `agent-event-batch` host→page message.

## 2026-07-16 — center the execution-timeline legend

The timeline panel's legend row was left-aligned behind a `LABEL_WIDTH` spacer
(so the swatches lined up under the timeline's label column). Otto centers the
legend in the panel instead:

- `web/components/agent-visualizer/timeline-panel.tsx` — dropped the leading
  `LABEL_WIDTH` spacer `<div>` and added `justify-center` to the legend row so
  the swatch/label group is centered in the view. `LABEL_WIDTH` is still used
  by the canvas draw code.

## 2026-07-16 — personality-colored agent nodes (idle muted / thinking vivid)

Upstream draws every node's fill and border purely from `getStateColor(agent.state)`
(a theme color per state), with a flat `COLORS.nodeInterior` interior — there is
no per-agent color. Otto spawns agents from named **Agent Personalities**, each
with a two-color identity (its spinner glowA/glowB pair); this patch lets a
personality-backed node render in those colors. The rule (host-decided): the
personality colors override ONLY the `idle` state (shown MUTED) and the
`thinking` state (shown VIVID); every other state (`tool_calling`,
`waiting_permission`, `complete`, `error`) keeps its prescribed state color, and
an agent with no personality (e.g. one not started by Otto) is unchanged.

- `web/lib/agent-types.ts` — `Agent` gains optional `personaColor?: { a: string; b: string }`.
- `web/lib/utils.ts` — new `mixHex(from, to, t)` (plus internal `parseHex`) blends two hex colors; used to derive the muted/vivid accent and the darkened interior stops.
- `web/hooks/simulation/handle-agent-events.ts` — `handleAgentSpawn` reads `payload.colorA`/`payload.colorB` and stores `personaColor` on both the fresh-spawn and the reactivate (resume/re-color) branches (both strings required).
- `web/components/agent-visualizer/canvas/draw-agents.ts` — new `resolveNodeAppearance(agent)` returns `{ accent, fill }`; `accent` (used everywhere the old single `color` was: glow sprite, ambient/outer ring, scanline, state ring, brand glyph) is the muted/vivid personality color for idle/thinking else `getStateColor`; `fill` is a non-null `{a,b}` gradient pair only for a personality idle/thinking node. `drawAgentGlow` takes the `fill` arg and paints a top→bottom two-stop gradient interior when present, else the neutral `COLORS.nodeInterior`.

Otto-side counterpart: the agent snapshot already carries the personality's
colors as `personalitySpinner {glowA, glowB}` (no new protocol). The adapter
threads them into the `agent_spawn` payload as `colorA`/`colorB`:
`packages/app/src/visualizer/visualizer-event-adapter.ts` (`personaColorPayload`
+ `personalityColors?` on both spawn builders) and
`packages/app/src/visualizer/use-visualizer-event-adapter.ts` (`personaColorsOf`,
`buildReSpawnEvent`, and a `lastPersonaColorKey` on the tracked node so a live
personality switch re-emits the spawn with the new tint).

## 2026-07-16 — host-toggleable bottom-right FPS meter (`config.render.showFps`)

Otto's Electron view used to inject a raw host-side FPS `<div>` into the guest
(dev-only, hardcoded colors, pinned above the on-canvas debug buttons). Those
buttons are gone and the meter is now a first-class, cross-platform HUD element
seeded like the other render toggles:

- `web/lib/vscode-bridge.ts` — `RenderConfig` gains `showFps: boolean`.
- `web/components/agent-visualizer/fps-meter.tsx` — new `FpsMeter` component.
  Counts the page's own `requestAnimationFrame` ticks (the same clock the canvas
  draw loop rides), themed with the HUD holo palette (`holoBg03`/`holoBorder06`,
  state-palette tint on the number), pinned to the true bottom-right corner
  (`bottom-3 right-3`, clear of the per-agent chat panel which sits 64px up).
- `web/components/agent-visualizer/index.tsx` — renders `<FpsMeter />` when
  `bridge.renderConfig?.showFps` is set. Mounted only while enabled, so the rAF
  loop costs nothing when off. Independent of the HUD-visibility toggle — it's a
  perf diagnostic, useful even in clean view.

Otto-side counterpart: `visualizerShowFps` device-local setting (Settings →
Visualizer → Rendering → "FPS meter"), sent as `config.render.showFps`;
`packages/app/src/visualizer/visualizer-view.electron.tsx` drops the old
`INJECT_FPS_METER_SCRIPT`. Reaches the guest on every platform (web iframe /
native webview postMessage, Electron message dispatch), unlike the old
Electron-only injection.

## 2026-07-16 — session-state mirror + HUD trim for the native Otto toolbar

Otto moved the visualizer's chat switcher and the Files/Cost/Audio/HUD-eye
controls OUT of the in-webview HUD and into a native Otto toolbar at the top of
the tab (`packages/app/src/panels/visualizer-toolbar.tsx`). The vendor side:

- `web/lib/vscode-bridge.ts` — new `select-session` / `close-session` host→page
  commands (routed to `onSessionCommand` listeners) and a `reportSessionState`
  page→host sender (`{type:"session-state", sessions, selectedId, activityIds}`).
- `web/hooks/use-vscode-bridge.ts` — exposes `bridgeReportSessionState` and
  `subscribeSessionCommand`.
- `web/components/agent-visualizer/index.tsx` — an effect mirrors the live
  session list/selection/activity to the host on change; another runs incoming
  select/close commands through the SAME `selectSession` / `handleCloseSession`
  paths a HUD tab click used. The bottom-left HUD-eye button was removed (the
  toolbar owns it now; `hudHidden` stays config-driven), and `isMuted` is no
  longer read (mute moved to the toolbar; audio stays config-driven).
- `web/components/agent-visualizer/top-bar.tsx` — dropped the session-tab column,
  the Files/Cost toggle group, and the Mute button; keeps only the top-right
  stats readout and the Timeline toggle (both still under the HUD-eye).
- `web/components/agent-visualizer/session-tabs.tsx` — now unused (kept in-tree,
  no longer imported).

Otto-side counterpart: `visualizer-panel.tsx` mirrors `session-state` into React
state for the toolbar, drives selection via `select-session`, and flips the
existing device-local settings (`visualizerPanelFileAttention` /
`…CostOverlay` / `…SoundMuted` / `…HudHidden`) for the toggles — reusing the
`config.panels`/`soundVolume`/`hudHidden` effect, so the page stays a single
config-driven follower. FPS is unchanged (bottom-right, Settings-only).

## 2026-07-16 — move the Timeline toggle to the native Otto toolbar too

Follow-up to the HUD trim above: the Timeline toggle was the last control button
left in the HUD top bar, out of place now that every other toggle lives in the
native Otto toolbar. Moved it there too, leaving the top bar as a pure stats
readout:

- `web/components/agent-visualizer/top-bar.tsx` — dropped the Timeline
  `ToggleButton` (and the now-unused `ToggleButton` helper); `TopBarProps` loses
  `showTimeline`/`onToggleTimeline`. The component is now just the top-right
  agents/tokens/cost readout, still gated by the HUD-eye.
- `web/components/agent-visualizer/index.tsx` — `<TopBar>` no longer passes the
  timeline props. The page's `showTimeline` state, its `TimelinePanel` gate, the
  `config.panels.timeline` seed, and the `t`-key keyboard shortcut are all
  unchanged — the toolbar drives visibility through the existing
  `config.panels.timeline` seam, so the page stays a config-driven follower.

Otto-side counterpart: a new Timeline `ToolbarToggle` in
`packages/app/src/panels/visualizer-toolbar.tsx` (new `Timeline` UI icon →
Material `timeline`) flips the pre-existing `visualizerPanelTimeline` device-local
setting via `visualizer-panel.tsx` (`handleToggleTimeline`), which the
`config.panels` effect already pushes to the page.

## 2026-07-16 — `formatTokens` renders millions as `M`

The per-agent context-bar label (`draw-agents.ts`) and other token readouts
(`top-bar.tsx`, `agent-detail-card.tsx`) share `formatTokens`, which only knew
`k`, so a 1M context budget read `1000k` (e.g. `66k / 1000k tokens`).

- `web/lib/utils.ts` — `formatTokens` now formats `>= 1_000_000` as `M` (`1M`,
  `1.5M`), keeping `k` below that. The bar now reads `66k / 1M tokens`.

## 2026-07-16 — `agent_rename` relabels a node in place (chat title follows the writer)

The agents map is keyed by a node's spawn `name` (`agent.id`), and every event,
edge, timeline, and conversation reference keys on that string — so the drawn
label (`draw-agents.ts` reads `agent.name`) was frozen at spawn. When the chat
auto-title writer rewrote a root chat's provisional first-line title after
spawn, the toolbar dropdown updated (via `session-updated`) but the graph node
kept the old title.

- `web/lib/agent-types.ts` — new `SimulationEvent` type `'agent_rename'`.
- `web/hooks/simulation/handle-agent-events.ts` — `handleAgentRename` updates
  ONLY the display label: `agent.name` (keeping `agent.id` as the key) and the
  timeline entry's `agentName`. Lookups stay keyed on the unchanged
  `payload.agent`, so no re-keying / edge churn.
- `web/hooks/simulation/process-event.ts` — dispatch the new case.

Otto-side counterpart: `packages/app/src/visualizer/visualizer-event-adapter.ts`
`buildAgentRenameEvent` (payload `{ agent: <stable node key>, label: <new full
title> }`); `use-visualizer-event-adapter.ts` emits it alongside the existing
`session-updated` when a root node's `agent.title` changes. A reset+replay
re-spawns nodes from the current title, so no rename is needed there.

## 2026-07-16 — closing the last session clears the canvas (archived-chat empty state)

When the host archives the visualized chat it sends `close-session`; the page's
`handleCloseSession` removed the session from the list but, with no session left
to auto-select, never cleared `selectedSessionId` or the simulation — so the
final agent stayed frozen in the center and the "Waiting for chat activity"
empty state never returned (the dropdown emptied, the canvas did not):

- `web/components/agent-visualizer/index.tsx` — `handleCloseSession` now
  `selectSession(null)` when no session remains (previously only re-selected when
  one did). The session-switch `useLayoutEffect` gains an `else if
  (selectedSessionId === null && prevSelectedRef.current !== null)` branch that
  cold-`restart()`s the simulation (empties agents → `isEmpty` true → empty
  state) and resets `prevSelectedRef`.

No Otto-side counterpart — the host already drives `close-session`. General
correctness fix (any last-session close, not just archive). Upstream-PR candidate.

## 2026-07-16 — split the per-node glow halo from the whole-viewport bloom pass (`config.render.nodeGlow`)

The visualizer produced two glow-ish effects that users read as separate but
that the single `bloom` toggle conflated: (1) the whole-viewport `BloomRenderer`
post-process (a blurred additive echo of the entire scene) and (2) the per-node
soft halo sprite drawn by `drawAgentGlow`, which was *always on* with no control.
Turning `bloom` off left the node halos, and there was no way to keep the bloom
haze while dropping the per-node glow (or vice-versa). Gave the per-node halo its
own host toggle, independent of `bloom`:

- `web/lib/vscode-bridge.ts` — `RenderConfig` gains `nodeGlow: boolean` (omitted
  → on, matching the historical always-on halo).
- `web/components/agent-visualizer/canvas.tsx` — `renderOptions` type gains
  `nodeGlow?`; the draw loop reads `renderOptions?.nodeGlow !== false` and passes
  it to `drawAgents`.
- `web/components/agent-visualizer/canvas/draw-agents.ts` — `drawAgents` gains a
  trailing `showNodeGlow: boolean = true`; `drawAgentGlow` takes a `showGlow` arg
  and gates **only** the radial halo sprite. The ambient outer ring and the
  node-body fill (also drawn inside `drawAgentGlow`) always render, so a node with
  glow off is still fully drawn — just without the surrounding halo. The
  `BloomRenderer` pass is untouched (still its own `bloom` toggle, unchanged
  behavior).

Otto-side counterpart: `visualizerRenderNodeGlow` device-local setting (default
`true`), a "Node glow" toggle in Settings → Visualizer → Rendering (above the
renamed "Bloom" toggle), sent as `config.render.nodeGlow` from
`packages/app/src/panels/visualizer-panel.tsx`. The "Bloom glow" settings row was
renamed to "Bloom" and its hint reworded to describe the whole-viewport echo, so
the two effects are named distinctly.

## 2026-07-16 — make the bloom offset "echo" deterministic (top/left drop-shadow)

The bloom composite drew the blur buffer at `sourceCanvas.width/height`
(physical backing-store pixels) while the caller's `ctx` still carried the
`scale(dpr, dpr)` set in `canvas.tsx` (never reset before the bloom apply). That
magnified the bloom by an extra dpr factor anchored at the top-left origin,
pulling a soft ghost of bright elements toward the bottom-right — which reads as
a directional "shadow" along the top and left against the additively-lifted
interior. Upstream's screenshots show this look, so we keep it — but its
strength tracked the display's dpr (≈2× on retina, absent at dpr 1 / Sharpness
Fast), so it appeared/disappeared per monitor and per Sharpness setting.

Reworked into a deliberate, display-independent effect:

- `web/components/agent-visualizer/bloom-renderer.ts` — `apply` resets to
  device-pixel space (`setTransform(1, 0, 0, 1, 0, 0)`) so the composite no
  longer depends on the caller's dpr scale, then draws the buffer scaled up from
  the origin by a fixed `BLOOM_ECHO_SCALE` (= 2, matching the retina-2× look the
  upstream screenshots came from). Because it scales from the origin, every
  feature's ghost displaces by a constant *fraction* of its distance from the
  top-left — dpr-independent — so the shadow lands on the top and left on every
  display and Sharpness setting. `echoScale = 1` collapses it to an aligned
  glow with no shadow; `setEchoScale(n)` (clamped 1–4) lets a future host toggle
  flip between the two without further renderer changes. A separate
  `BLOOM_ECHO_OPACITY` (= 0.7) multiplies the composite alpha so the offset
  ghost can be made fainter over the crisp graph independently of its offset
  distance (1 = full strength).

No Otto-side counterpart yet. A `config.render` toggle (aligned glow vs.
drop-shadow) could drive `setEchoScale` if we want it user-selectable — the
renderer is already wired for it.

## 2026-07-16 — depth-of-field blur on the backdrop star field

The parallax star field (`drawBackground`'s depth particles) was drawn sharp.
To make the backdrop read as soft/out-of-focus depth behind the crisp node
graph, blur just the particle draws:

- `web/components/agent-visualizer/background-layer.ts` — a `BACKDROP_BLUR_RADIUS`
  constant (CSS px, = 4) wraps the depth-particle loop in a save/`ctx.filter =
  blur(...)`/restore. Scoped so the filter can't leak onto later node/tool
  draws; the solid void fill above is left unblurred so the stage keeps clean
  edges (blurring a full-canvas fill would fade its rim toward transparency).
  Particles draw in screen space under only the dpr scale, so the radius is
  display-stable. 0 restores the historical sharp stars. The hex grid (rarely
  on) is intentionally left crisp. Per-frame cost is one filtered pass over the
  80 small particle fills — cheap next to the bloom's 3 full-canvas blurs.

No Otto-side counterpart. Tunable via the constant; could become a
`config.render` value if we want it user-adjustable.

## 2026-07-16 — background grid follows the node shape

The optional background grid (`showHexGrid`) always tiled hexagons, so with a
non-hexagon node shape the backdrop no longer echoed the nodes. Now the grid
tiles the host-selected shape:

- `web/components/agent-visualizer/background-layer.ts` — `drawBackground` gains
  a trailing `nodeShape: NodeShape = 'hexagon'` param. `drawHexGrid` is renamed
  `drawShapeGrid` and takes the shape; the batched stroke traces the selected
  silhouette instead of hard-coded hexagons. Vertex offsets for each polygonal
  shape are precomputed once (`SHAPE_OFFSETS`, mirroring `drawNodeShape`'s
  rotations — square axis-aligned, octagon flat-topped, hexagon pointy-topped) so
  the no-trig-per-vertex-per-frame batching survives; `circle` has no vertices and
  is traced as an arc subpath per cell (`moveTo` before `arc` keeps each circle a
  separate subpath). The hex tiling geometry (offset rows) is unchanged — only the
  glyph drawn at each grid point changes.
- `web/components/agent-visualizer/canvas.tsx` — passes the already-resolved
  `nodeShape` into `drawBackground`.

No new Otto-side wiring: it reuses the existing `config.render.nodeShape` value.
The `showHexGrid`/`hexGrid` names are kept as-is (renaming them would ripple
through the bridge/panels config for no functional gain).

## 2026-07-16 — move the right-click menu's actions to the toolbar, remove the menu

The in-canvas right-click `GlassContextMenu` offered exactly four actions (Zoom
to Fit / Toggle Stats / Toggle Grid / Restart). Otto moved all four into the
native Otto toolbar (left side, grouped with `ToolbarSeparator`s like the menu
was: `{Zoom, Stats, Grid} | {Restart}`), so the menu had nothing left to show
and was removed. Split by kind:

- **Toggle Grid** already had a config seam (`config.panels.hexGrid` ←
  `visualizerPanelHexGrid`), so the toolbar button just flips that setting — no
  vendor change beyond what already existed.
- **Toggle Stats** was page-only state (`showStats`). Promoted to a config-driven
  follower like the other panels: `web/lib/vscode-bridge.ts` adds `stats` to
  `PanelsConfig`; `web/components/agent-visualizer/index.tsx`'s `bridge.panelsConfig`
  effect seeds `setShowStats(panels.stats)`. Host side adds a device-local
  `visualizerPanelStats` (default off) pushed via the existing `config.panels`
  effect.
- **Zoom to Fit / Restart** are stateless one-shot actions with no setting to
  persist, so they use a new host→page `viewport-command` message
  (`{type:"viewport-command", action:"zoom-to-fit"|"restart"}`):
  `web/lib/vscode-bridge.ts` routes it to `onViewportCommand` listeners;
  `web/hooks/use-vscode-bridge.ts` exposes `subscribeViewportCommand`;
  `index.tsx` runs the command (`setZoomToFitTrigger` / `handleRestart`) —
  mirroring how `select-session` remote-drives the session switcher.
- **Menu removal** — `index.tsx` drops the `GlassContextMenu` import + render and
  the `contextMenuItems` array. `onContextMenu` is now a no-op (`handleContextMenu`);
  `use-canvas-interaction.ts` still calls `preventDefault()` so the browser's own
  menu stays suppressed. `pauseAutoFit` is hard-`false` (nothing pauses auto-fit
  now). `selection.contextMenu`/`setContextMenu`/`handleContextMenu` remain on the
  hook, just unused. `glass-context-menu.tsx` is now dead (kept in-tree, no longer
  imported).

Otto-side counterpart: `visualizer-toolbar.tsx` gains the four controls (a new
`ToolbarButton` for the momentary Zoom/Restart actions, which are disabled when
no chat is selected; `ToolbarToggle` gains a `disabled` prop);
`visualizer-panel.tsx` adds the four handlers, the `stats` panels leaf, and four
new UI icons (`FitScreen`, `BarChart`, `Hexagon`, `Restart`).

## 2026-07-16 — second, farther star layer (two-depth parallax)

The backdrop had a single parallax star field. Added a second, farther layer so
the stage reads with two depths:

- `web/lib/agent-types.ts` — `DepthParticle` gains an optional `far?: boolean`
  tagging a particle as belonging to the far layer.
- `web/components/agent-visualizer/background-layer.ts` —
  `createDepthParticles` now also emits `NUM_FAR_PARTICLES` (= 150) far stars:
  smaller (size 0.3–0.8 vs the near layer's 0.5–2.0), a higher brightness floor
  (0.12–0.32) so they stay visible / slightly less transparent, and a slower
  autonomous drift (`speed` 0.015–0.045). The single draw loop is replaced by
  `drawStarLayer`, called twice — far first (behind, lighter blur
  `FAR_BACKDROP_BLUR_RADIUS` = 1.5 so the tiny points aren't erased), then near
  (existing `BACKDROP_BLUR_RADIUS` = 4). The far layer uses a reduced
  camera-parallax factor (0.1–0.3 vs the near layer's 0.3–1.0), so distant stars
  scroll strictly slower than the near layer and never outpace it; far stars
  also skip the depth-based size/alpha shrink so they keep their authored
  brightness. Two passes over ~230 particles/frame; no per-frame allocation.

No Otto-side counterpart. Counts/blur/parallax are tunable via the constants;
could become `config.render` values if we want them user-adjustable.

## 2026-07-16 — stars twinkle

Both star layers now twinkle independently:

- `web/lib/agent-types.ts` — `DepthParticle` gains optional `twinklePhase` +
  `twinkleSpeed`.
- `web/components/agent-visualizer/background-layer.ts` — `createDepthParticles`
  assigns each star a random phase (0–2π) and angular speed (near 1.6–4.6,
  far 2.4–6.4 rad/s, so the far layer sparkles a touch livelier). `drawStarLayer`
  takes `time` (already tracked in `canvas.tsx`'s `timeRef`, advanced every rAF
  frame) and multiplies alpha by `0.7 + 0.3*sin(time*speed + phase)` — a per-star
  factor in [0.4, 1.0], so stars dim/brighten but never fully vanish. Free when a
  star has no twinkle phase (guard on `twinkleSpeed !== undefined`).

## 2026-07-16 — star field perf: pre-blurred sprites instead of per-frame ctx.filter

The star field was the dominant visualizer cost. Root cause: `drawStarLayer` ran
a live `ctx.filter = blur(...)` gaussian pass PER LAYER PER FRAME (two passes over
~230 particles). `ctx.filter` blur recomputes a separable gaussian over the whole
scattered bounding box every frame — expensive — while the blur is actually
constant. Fixed by baking the blur once:

- `web/components/agent-visualizer/background-layer.ts` — each layer's blurred
  star is rendered ONCE into an offscreen canvas (`buildStarSprite`, cached at
  module scope in `nearStarSprite`/`farStarSprite`). The sprite is built at the
  layer's max on-screen radius (`NEAR_STAR_MAX_RADIUS` = 2.0 / `FAR_STAR_MAX_RADIUS`
  = 0.8) with the blur (`BACKDROP_BLUR_RADIUS` = 4 / `FAR_BACKDROP_BLUR_RADIUS` =
  1.5) baked in, and supersampled ×`SPRITE_SUPERSAMPLE` (=3) so the ctx's dpr
  upscale stays crisp. `drawStarLayer` now blits the sprite per star with
  `drawImage`, scaled DOWN to the star's size (`size / sprite.radius` ≤ 1, so no
  upscale mush; the baked blur scales with it) and `ctx.globalAlpha` = brightness ×
  twinkle. No per-frame `ctx.filter`; the twinkle/parallax/two-layer behavior is
  unchanged. `alphaHex` import dropped (globalAlpha replaces the per-fill alpha).
  Guarded on `typeof document` for SSR; sprites lazily built on first draw.

Per-frame cost drops from two full gaussian passes to ~230 cheap image blits.
Tradeoff: blur is now size-proportional (a scaled sprite) rather than a fixed CSS
radius — imperceptible for background stars, and the soft look is preserved.

## 2026-07-16 — star look tuning: pointier, smaller, brighter sparkle

Appearance-only pass over `background-layer.ts` (current values supersede the
numbers in the three entries above):

- **Pointier / less blurry:** `BACKDROP_BLUR_RADIUS` 4 → 1.5, `FAR_BACKDROP_BLUR_RADIUS`
  1.5 → 0.5. Stars read as crisp points rather than soft blobs.
- **Smaller, big ones rare:** star `size` now uses a squared random
  (`Math.random() ** 2 * span + base`) so the distribution is skewed toward the
  small end — near 0.4–2.0 (was linear 0.5–2.0), far 0.3–0.8 — with large stars
  uncommon and the same max radii, so the sprite constants are unchanged.
- **Brighter sparkle, less opaque baseline:** brightness ceilings raised (near
  0.05–0.35 → 0.15–0.55, far 0.12–0.32 → 0.20–0.50) and the twinkle multiplier
  widened from `0.7 + 0.3*sin` (range [0.4, 1.0]) to `0.55 + 0.45*sin` (range
  [0.1, 1.0]) — brighter peaks, near-transparent (never fully) troughs, so the
  field sparkles with more contrast.

## 2026-07-17 — light-stage backdrop tuning (stars + mirrored bloom echo)

On light theme variants the backdrop layers were tuned for the near-black
upstream stage and read wrong: the accent-colored parallax stars nearly
vanished against the near-white void, and the whole-frame bloom "echo" (the
mirrored blur layer) composited too faint. Two vendor edits, both gated on the
stage being light (`COLORS.void` relative luminance > 0.5, host-seeded via
`window.__OTTO_THEME__`), so dark stages are byte-for-byte unchanged:

- `web/components/agent-visualizer/background-layer.ts` — a module-level
  `STAR_ALPHA_BOOST` (= `STAR_LIGHT_ALPHA_BOOST` = 3 on light stages, else 1)
  multiplies each star's final alpha in `drawStarLayer`, clamped to 1 at blit.
  Most stars go near-opaque so they're legible on almost-white, while the
  twinkle still swings the dim ones. Both layers (near + far) share the boost.
- `web/components/agent-visualizer/bloom-renderer.ts` — the light-stage
  `'multiply'` composite alpha, previously a bare `intensity * 0.6`, is now
  `intensity * BLOOM_LIGHT_STAGE_ALPHA` (= 0.85), so the mirrored blur echo
  registers a bit more strongly. Dark stages still use `intensity` directly.

Host counterpart (no vendor build): the light-scheme shape-grid color
(`hexGrid`) in `packages/app/src/visualizer/visualizer-theme.ts` `lightProfile`
was biased from `mix(voidBg, foreground, 0.08)` (near-white, invisible at the
grid's ~0.2 stroke alpha) to `0.55` so the grid draws as dark lines.

## 2026-07-17 — remove the background shape grid entirely

The optional background grid (`showHexGrid` / `config.panels.hexGrid`, most
recently tiling the selected node shape — see the 2026-07-16 entry above) was
cut: it never earned its place in the backdrop. The whole feature chain is
gone, not just disabled. Vendor edits:

- `web/components/agent-visualizer/background-layer.ts` — deleted `drawShapeGrid`
  and its helpers (`HEX_OFFSETS`, `polygonOffsets`, `SHAPE_OFFSETS`,
  `HEX_GRID_SIZE`); `drawBackground` dropped its `showHexGrid` and `nodeShape`
  params (the grid was the only consumer — nodes still get `nodeShape` via
  `renderOptions` in `canvas.tsx`).
- `web/components/agent-visualizer/canvas.tsx` — removed the `showHexGrid` prop
  and its threading through `drawPropsRef` into the `drawBackground` call.
- `web/components/agent-visualizer/index.tsx` — removed the `showHexGrid` state,
  the `panels.hexGrid` seed, and the `toggleHexGrid` action.
- `web/hooks/use-keyboard-shortcuts.ts` — removed the `toggleHexGrid` action and
  its `g`/`G` shortcut.
- `web/lib/vscode-bridge.ts` — removed `hexGrid` from `PanelsConfig`.
- `web/lib/colors.ts` — removed the now-unused `hexGrid` palette color.

Otto-side counterpart: dropped the `visualizerPanelHexGrid` device-local
setting (`hooks/use-settings/storage.ts`), its Settings toggle row
(`screens/settings/visualizer-section.tsx`), the `panels.hexGrid` config send
(`panels/visualizer-panel.tsx`), the `hexGrid` view-config type
(`visualizer/visualizer-view-types.ts`), the `hexGrid` palette token
(`visualizer/visualizer-theme.ts`), and the `settings.appearance.visualizer.hexGrid`
i18n strings across every locale.

## 2026-07-17 — longer agent-name labels before the ellipsis

Node name labels truncated aggressively: `drawAgentLabel` caps label width at
`radius × AGENT_DRAW.labelWidthMultiplier` (was 3), which at 10px monospace
left main agents (radius 28 → 84px) only ~14 visible characters and subagents
(radius 20 → 60px) ~10 — well short of the 24-char label the Otto host adapter
already sends (`truncateSessionLabel`). Vendor edit:

- `web/lib/canvas-constants.ts` — `AGENT_DRAW.labelWidthMultiplier` 3 → 4
  (main ~18–19 chars before the ellipsis), plus a new
  `labelWidthMultiplierSub` (5.6) so sub-agent labels get the same ~112px cap
  as main nodes (20×5.6 = 28×4) instead of scaling down with their smaller
  radius.
- `web/components/agent-visualizer/canvas/draw-agents.ts` — `drawAgentLabel`
  picks the multiplier by `agent.isMain`.

No Otto-side counterpart; the host's 24-char cap is unchanged and still the
outer bound.

## 2026-07-17 — completed tool card centers its label when there's no token line

`drawToolCalls` sizes a completed card at `collapsedHeight` when it has no
`tokenCost`, but the completed branch always drew the label at
`y - twoLineOffset` — as if a second line existed — leaving the text pinned to
the top edge of the collapsed card. Vendor edit:

- `web/components/agent-visualizer/canvas/draw-tool-calls.ts` — the completed
  branch draws the two-line layout (label up, dim `N tok` below) only when
  `tokenCost` is set; otherwise the single label is drawn centered at `tool.y`.

Otto-side counterpart: the host adapter now actually populates `tokenCost` on
`tool_call_end` (`packages/app/src/visualizer/visualizer-event-adapter.ts`
`estimateToolCallTokenCost` — ~4 chars/token over the serialized detail
payload, the same heuristic as `timeline/turn-time.ts`), so completed cards
show the token line; the centered fallback covers empty-detail calls.

## 2026-07-17 — keyboard panel toggles defer to the host (`panel-toggle`)

With the native Otto toolbar owning panel visibility (host settings seed
`config.panels`, the page is a config-driven follower — see the session-state
mirror entry above), the page's keyboard shortcuts (`t` timeline / `f` files /
`$` cost / `s` stats) still flipped page-LOCAL state: a keyboard-opened panel
showed the toolbar button off and got snapped closed by the very next config
push. Host settings are the source of truth now, so the shortcuts defer to the
host when a bridge host is attached:

- `web/lib/vscode-bridge.ts` — new exported `TogglablePanel` type
  (`'timeline' | 'files' | 'cost' | 'stats'`) and `togglePanel(panel)` posting a
  page→host `panel-toggle` message (`{type:'panel-toggle', panel}`, mirrors
  `setSoundMuted`; a no-op when no host is attached — `postToExtension` guards).
- `web/hooks/use-vscode-bridge.ts` — new `bridgeTogglePanel` passthrough.
- `web/components/agent-visualizer/index.tsx` — the four panel keyboard actions
  call `bridgeTogglePanel` when `bridge.isVSCode` (a host is attached), and keep
  the old local `setShow*`/`toggleExclusivePanel` flip ONLY as the
  standalone/demo fallback where no host exists.

Otto-side counterpart: `packages/app/src/visualizer/visualizer-view-types.ts`
adds the `panel-toggle` page→host message;
`packages/app/src/panels/visualizer-panel.tsx` handles it by invoking the SAME toggle handlers the
toolbar buttons use (flipping `visualizerPanelTimeline` /
`…FileAttention` / `…CostOverlay` / `…Stats`, files/cost staying mutually
exclusive), which round-trips back to the page via the `config.panels` push.

## 2026-07-17 — remove the dead `hud-hidden` report chain and the orphaned context-menu remnants

Two dead-code sweeps behind the native-toolbar move (both paths lost their last
caller when the in-page HUD-eye button and the right-click menu were removed —
see the session-state mirror and right-click-menu entries above, whose
"kept/remain unused" notes this entry supersedes):

- **Page→host `hud-hidden` chain removed.** The in-page HUD-eye was the only
  caller of `setHudHidden` / `bridgeSetHudHidden`; with the toolbar's eye
  driving the device-local setting directly, the report path could never fire.
  Removed `setHudHidden` (`web/lib/vscode-bridge.ts`) and `bridgeSetHudHidden`
  (`web/hooks/use-vscode-bridge.ts`). The host→page `config.hudHidden` path —
  still used by the toolbar eye — is untouched. Otto-side: the `hud-hidden`
  message type (`visualizer-view-types.ts`) and the panel's handler
  (`visualizer-panel.tsx`) removed.
- **Orphaned context-menu code removed.**
  `web/components/agent-visualizer/glass-context-menu.tsx` deleted (no
  importers); `web/hooks/use-selection-state.ts` drops `ContextMenuState`, the
  `contextMenu`/`setContextMenu` state, and `handleContextMenu` (zero readers);
  `index.tsx` drops the empty no-op `onContextMenu` callback and the
  `pauseAutoFit={false}` hardcode (both props are optional);
  `web/components/agent-visualizer/canvas.tsx` and
  `web/hooks/use-canvas-interaction.ts` make `onContextMenu` optional —
  right-click still `preventDefault()`s there, so the browser's native menu
  stays suppressed.

## 2026-07-17 — stop renaming the main agent from the first user message

Upstream's `handleMessage` renamed the main agent to a slice of the first user
message ("more recognizable than 'orchestrator'") whenever the agent's display
name still equaled its spawn key. In Otto the host is authoritative for node
names — `agent_spawn.name` IS the chat title and `agent_rename` tracks title
changes — so this block clobbered the AI-written chat title with the first
prompt on every history replay (refresh backfill, session-switch cold start),
and nothing ever healed it: the host's rename is edge-triggered on title
*change*, and a settled title never changes again. Symptom: the toolbar's chat
dropdown showed the correct title (session labels ride a separate path) while
the graph node reverted to the first prompt.

- `web/hooks/simulation/handle-message-events.ts` — the rename-on-first-user-
  message block in `handleMessage` removed outright (with the now-unused
  `LABEL_LEN_NAME`/`LABEL_LEN_TASK` imports). `task` was written only here for
  main agents and is not read by any Otto-embedded surface.
- `web/hooks/use-vscode-bridge.ts` — sibling nit in the same title-freshness
  family: the `session-started` branch for an already-known session (un-archive
  re-add) kept the stale entry label; it now takes the incoming `session.label`.

## 2026-07-17 — file-attention panel: open workspace-relative and Windows paths

The File Attention panel gated a file's clickability on
`file.path.startsWith('/')`. Combined with Otto now feeding **workspace-relative**
file paths (see below), that gate made every listed file non-clickable — and it
had already made every Windows absolute path (`C:\…`, never `/`-prefixed)
non-clickable. Relaxed to open any non-empty path when the host wired an open
handler; the open-file route resolves both relative and absolute paths.

- `web/components/agent-visualizer/file-attention-panel.tsx` — `canOpen` is now
  `Boolean(onOpenFile) && file.path.trim().length > 0`.

Otto-side counterpart (no vendor dependency, host-only): the
`packages/app/src/visualizer/visualizer-event-adapter.ts` tool-call mapping now
displays each read/edit/write file path **relative to the agent's own working
directory** (`AgentNodeContext.workspaceRoot`, sourced from the tracked agent's
`cwd` in `use-visualizer-event-adapter.ts`), via the existing
`resolveWorkspaceFilePaths` helper — so the file heatmap and tool-node labels
read `src/foo.ts` instead of an absolute host path the width-limited label
truncates to `C:\…`. Files outside the workspace keep their verbatim path.

## 2026-07-17 — gap between the execution timeline and the bottom control bar

The Execution Timeline panel sat at `bottom: 72`, but the bottom control bar
(Live / Review-Play) is anchored at `bottom-4` (16px) and stands ~62px tall in
review mode (its 36px play button + `py-3` padding + border) — top edge ~78px —
so the timeline's bottom edge overlapped it with no visible gap. Raised the
timeline's bottom offset to clear the control bar by ~12px (≥10px requested).

- `web/components/agent-visualizer/timeline-panel.tsx` — `SlidingPanel`
  `position.bottom` 72 → 90.

## 2026-07-17 — Files/Timeline lose their ✕; Cost summary becomes a DOM panel matching Files

Otto's toolbar carries the Files / Cost / Timeline toggle buttons, so the
in-panel ✕ close buttons were redundant. Separately, the Files panel is a DOM
`glass-card` while the Cost summary was drawn on the `<canvas>` — so the
mutually-exclusive Files/Cost pair looked nothing alike. Reworked so both are
DOM panels sharing one top-right anchor, title, width, and font ramp; the ✕ is
gone from the two toggle-driven panels.

- `web/components/agent-visualizer/shared-ui.tsx` — `PanelHeader.onClose` is now
  optional; the `CloseButton` (and the actions cluster) render only when there's
  something to show. Node-tethered popups (agent/tool/discovery detail, chat)
  still pass `onClose` and keep their ✕.
- `web/components/agent-visualizer/file-attention-panel.tsx` — dropped the
  `onClose` prop + ✕; moved the panel up to `top: 42` (from 48).
- `web/components/agent-visualizer/timeline-panel.tsx` — dropped the `onClose`
  prop + ✕.
- `web/components/agent-visualizer/cost-panel.tsx` — NEW. A DOM re-implementation
  of the former canvas cost summary (`drawCostSummaryPanel`), mirroring
  `FileAttentionPanel`'s glass-card layout / fonts / 260px width / `{top:42,
  right:12}` anchor, with a "TOKEN COST" title and no ✕. Per-agent and by-tool
  breakdown rows reuse `agentCost` / `toolTypeColor` from `canvas/draw-cost`.
- `web/components/agent-visualizer/canvas/draw-cost.ts` — removed
  `drawCostSummaryPanel` (and its now-unused `formatTokens` / `truncateText` /
  `COST_PANEL` imports). The on-node cost pills (`drawCostLabels`) stay on the
  canvas; `agentCost` / `toolTypeColor` stay exported and now also feed the DOM
  panel. (`COST_PANEL` in `lib/canvas-constants.ts` is left in place, unused.)
- `web/components/agent-visualizer/canvas/index.ts` + `canvas.tsx` — dropped the
  `drawCostSummaryPanel` re-export and its per-frame call.
- `web/components/agent-visualizer/index.tsx` — render `<CostPanel>` (fed the
  reactive `agents` / `toolCalls` state) beside `<FileAttentionPanel>`; removed
  the `onClose` wiring from both toggle panels.

## 2026-07-17 — cache persona node tints and fill gradients (per-frame allocation churn)

For personality-backed agents, idle/thinking is the steady state, so
`resolveNodeAppearance` paid 3× `mixHex` (regex hex parse + string rebuild) plus
two fresh objects per persona node per frame, and the persona inner fill
allocated a `CanvasGradient` per node per frame — pure GC/CPU churn in the loop
the glow-sprite cache was built to avoid. Both inputs are pure in (persona
colors, state) / (fill colors, radius):

- `web/components/agent-visualizer/canvas/draw-agents.ts` —
  `resolveNodeAppearance` memoizes the persona tint result in a module-level
  `appearanceCache` keyed `` `${persona.a}|${persona.b}|${state}` `` (size-capped
  at 256, cleared on overflow). The persona inner fill now draws origin-centered
  under a `translate` and takes its gradient from `getPersonaFillGradient`, a
  cache keyed by color pair + half-pixel-quantized radius (the breathe animation
  varies the radius by fractions of a pixel; the sub-half-pixel endpoint error is
  invisible for a soft two-stop gradient, and the fill path itself still uses the
  exact radius). Non-persona nodes are untouched; the time-animated scanline
  gradient is inherently uncacheable and stays per-frame.

## 2026-07-17 — panel titles to Title Case

Otto renders the visualizer's panel/popup header titles in Title Case rather
than upstream's ALL CAPS.

- `file-attention-panel.tsx` — "FILE ATTENTION" → "File Attention".
- `cost-panel.tsx` — "TOKEN COST" → "Token Cost"; "BY TOOL" → "By Tool".
- `timeline-panel.tsx` — "EXECUTION TIMELINE" → "Execution Timeline".
- `chat-panel.tsx` — the per-node chat header showed `agentName.toUpperCase()`;
  now shows the agent name in its natural case.

Deliberately left as-is (not header titles): the control bar's LIVE status
badge, the per-message role labels (USER/THINKING/CLAUDE/CODEX) in the chat
panel, and the discovery type chips (FILE/PATTERN/FINDING/CODE).

## 2026-07-17 — stack the per-node cost pill above the stats box (no overlap)

When both the Toggle Stats overlay and the Cost overlay were on, a node's stats
box (`N tools · Ns`) and its cost pill (`$0.723`) both anchored just above the
node radius and drew on top of each other — unreadable. They're independent draw
passes (`drawStatsOverlay` inside `drawAgents`, `drawCostLabels` after). Now the
stats box keeps its normal spot (just above the node) and the cost pill lifts to
sit fully above it — the pill also owns the mini tool-type bar that hangs below
it, so the lift reserves that bar's full height too.

- `web/lib/canvas-constants.ts` — `STATS_OVERLAY` gains `stackGap: 3` (vertical
  clearance between the stats box and the cost pill).
- `web/components/agent-visualizer/canvas/draw-cost.ts` — `drawCostLabels` gains
  a trailing `showStats = false`. Per node it lifts when `showStats &&
  agent.state !== 'complete'` (mirroring where `drawAgents` draws the stats box)
  by anchoring `pillY` at `STATS_OVERLAY.yOffset + STATS_OVERLAY.stackGap +
  COST_DRAW.pillHeight + miniBarReserve` instead of `COST_DRAW.pillYOffset`.
  `miniBarReserve` is the mini bar's `miniBarGap + miniBarHeight` only when the
  bar actually draws (the node has token-costed tools), so a node without one
  isn't pushed needlessly far from the stats box — the pill sits a consistent
  `stackGap` above whatever is directly below it.
- `web/components/agent-visualizer/canvas.tsx` — the `drawCostLabels` call
  forwards `showStats`.

Host-only otherwise; no protocol or settings change. Needs `npm run build:visualizer`.

## 2026-07-17 — `context_update` stops forcing `thinking` (idle nodes stayed "Thinking" forever)

Companion to the 2026-07-16 `resting` patch above. Even with `resting`, a node
that finished its turn snapped straight back to a permanent "Thinking" pulse.
Upstream's `handleContextUpdate` set `state: agent.state === 'complete' ?
'complete' : 'thinking'` on every token update, assuming a context update only
arrives mid-reasoning. Otto's host pushes a `context_update` from a store
reconcile (`use-visualizer-event-adapter.ts` `reconcileNodeTokens`) whenever
usage moves — and the final turn usage lands right AFTER `turn_completed` has
already rested the node at `idle`. That trailing update flipped the just-rested
node back to `thinking`, and nothing idled it again. Reproduced on every
provider (Claude and openai-compat alike) since the trailing usage push is
provider-agnostic.

- `web/hooks/simulation/handle-message-events.ts` — `handleContextUpdate` no
  longer writes `state`; it updates only the token/breakdown fields and
  preserves `agent.state`. Lifecycle transitions into `thinking`/`tool_calling`
  are already owned by real activity (`handleMessage`, `handleToolCallStart`,
  `handleToolCallEnd`), so the removed write was redundant during a live turn
  and destructive at rest.

No Otto-side counterpart. Needs `npm run build:visualizer`.

## 2026-07-17 — wire discovery cards (consume payload.discovery)

The whole discovery-card subsystem — `draw-discoveries.ts`, hit-detection,
`discovery-detail-popup.tsx`, the four themed types, the `DISCOVERY_HOLD_S` fade,
and `settle-visual-state` hydrate handling — shipped in upstream's `web/`, and
the mock scenario emits `discovery:{type,label,content}` on `tool_call_end`. But
**no handler ever consumed it**: nothing wrote `state.discoveries`, so the array
stayed empty and cards never rendered (demo included). Otto's adapter now derives
notable findings from tool results (search match counts, files written/edited,
test pass/fail, failed commands, web fetches — see
`deriveToolCallDiscovery`), and this patch renders them.

- `web/hooks/simulation/handle-tool-events.ts` — new `pushDiscovery(raw, agent,
  agentName, currentTime, state)` validates `payload.discovery` (known `type`,
  non-empty label/content), fans successive cards around the node by the golden
  angle at `DISCOVERY_ORBIT = NODE.radiusMain + 96`, and pushes a `Discovery`
  (start at the node center, animate out to the fanned target). `handleToolCallEnd`
  calls it after the conversation append. Reuses the existing draw / hit-test /
  popup / theming / fade untouched; imports `NODE` + `Discovery` from
  `@/lib/agent-types`.

Host-side counterpart: `deriveToolCallDiscovery` in
`packages/app/src/visualizer/visualizer-event-adapter.ts` (pure, unit-tested),
emitted as `payload.discovery` on the `tool_call_end` SimulationEvent. Read is
excluded (too frequent) and `sub_agent` is skipped (already its own node/particle).
Needs `npm run build:visualizer`.

## 2026-07-17 — remove the per-node chat panel; move + enrich the node detail card

Clicking a node opened two surfaces: the `AgentDetailCard` (pinned middle-LEFT)
and the `AgentChatPanel` (bottom-right, replaying that one agent's messages). The
chat panel duplicated the real chat transcript the user already has open — the
same rationale that removed the "Chat" transcript and message-feed panels
(2026-07-16 patch above). Removed it, moved the surviving detail card to the
now-free right edge, and enriched it with info the graph doesn't spell out (user
feedback: the card "didn't show anything new"):

- `web/components/agent-visualizer/index.tsx` — dropped the `AgentChatPanel`
  import + render site, and the now-dead `selectedConversation` memo and
  `sessionRuntime` memo (the latter only fed the chat panel's CLAUDE/CODEX
  assistant label). `conversations` is retained — it still feeds `timelineEvents`.
- `web/components/agent-visualizer/agent-detail-card.tsx` — pinned to the middle
  -RIGHT (`right: CARD.margin`) instead of middle-left (vertical centering
  unchanged), and enriched: a **task** line (`agent.task`, 3-line clamp), a **cost**
  estimate (`agentCost(cumulativeTokens ?? tokensUsed, model)`, reused from
  `canvas/draw-cost.ts`), a **lifetime-tokens** stat when `cumulativeTokens`
  exceeds context occupancy, and a labeled **context-composition** mini-bar +
  legend (`contextSegments(agent.contextBreakdown)` from `lib/colors.ts`, with
  per-segment token counts) shown only when the host has sent a non-zero
  breakdown. The prop type widened to carry `cumulativeTokens` / `contextBreakdown`
  / `task`. Reuses existing tokens only (`COLORS.holoBg10` track, `COLORS.complete`
  for the cost).
- `web/components/agent-visualizer/canvas/draw-misc.ts` + `canvas.tsx` — the
  dashed **tether line + dot** that connects the selected node to the card
  followed the card to the right: `drawTetherLine` gains a `canvasW` param and
  ends at the card's LEFT edge (`canvasW - CARD.margin - CARD.detail.width`) at
  its vertical center (`screenTop + CARD.detail.height / 2`), instead of the old
  middle-left edge at 30% down.

`chat-panel.tsx` is left in the tree (now unimported, tree-shaken out of the
bundle) to keep the subtree-pull diff small — same convention as
`session-transcript-panel.tsx` / `message-feed-panel.tsx`. No Otto-side
counterpart (no bridge/config change — all fields already ride the `Agent`
object). Needs `npm run build:visualizer`.

## 2026-07-17 — suppress the floating on-canvas message bubbles (keep the record)

The graph still drew a floating popup bubble for every assistant/user/thinking
message (`draw-bubbles.ts`, framed by the camera, click-tested by
`hit-detection.ts`). With the chat/message PANELS already gone (2026-07-16 +
2026-07-17 patches above), these popups were the last surface duplicating the
real chat the user already has open — and they obscured the orchestration the
graph exists to show. Removed them, but **only the visual popup** — the message
data is untouched.

- `web/hooks/simulation/handle-message-events.ts` — `handleMessage` no longer
  pushes onto `msgAgent.messageBubbles` (dropped the dedup + `MAX_BUBBLES` slice
  block and the now-unused `LABEL_LEN_BUBBLE` / `MAX_BUBBLES` imports). The two
  things that make a message part of the RECORD are kept verbatim: the
  `appendConversation(state.conversations, …)` call (feeds `timelineEvents` and
  any per-node history — the message still "really happened"), and the node's
  `state → 'thinking'` transition on real message activity (that's activity, not
  a popup). `messageBubbles` is now fed nowhere, so it stays an empty array and
  every consumer (`draw-bubbles`, `hit-detection`, camera auto-fit,
  `animate.ts` pruning) short-circuits on the empty array — no further edits
  needed.

Distinct from the earlier panel removals: this is the difference the user drew —
the chat should stay in the timeline/record ("it's what really happened"); only
the visual popups go. No Otto-side / bridge / config change (the host keeps
emitting `message` events exactly as before — the adapter's streaming-message
coalescing is unchanged). To re-enable, restore the `updates.messageBubbles`
push. Needs `npm run build:visualizer`.

## 2026-07-18 — play at the end replays from the start

`web/components/agent-visualizer/index.tsx` — `handlePlayPause` now seeks to `0`
before `play()` when the sim clock is already at (or past) `maxTimeReached`. After
the host's attach/hydrate the clock rests at the settled present (the last
event's time — see the per-session time anchor in `docs/visualizer.md`), so a
bare `play()` resumed *past* the last event and nothing visibly replayed: the
button toggled to ⏸ but the graph sat still. This matches standard media-player
behavior — pressing play at the end restarts the replay from the beginning, while
a user who scrubbed to the middle first still resumes from there (`maxTimeReached
> 0` guards the empty/degenerate case). Reuses the existing `seekToTime` /
`currentTime` / `maxTimeReached` already in scope; no new state, no bridge or
config change. Needs `npm run build:visualizer`.

## 2026-07-18 — star field refills the pane on resize (no thin-column collapse)

The parallax star field was laid out once at mount (`createDepthParticles`) and
never re-laid-out on resize; the draw loop only wraps particles against the live
width/height (`updateDepthParticles`: `if (p.x > width*1.5) p.x = -width*0.5`).
Shrinking the pane makes `width*1.5` tiny, so the wrap snaps nearly every star to
`-width*0.5` and the whole field collapses into a thin column on the left edge —
and growing the pane back never un-collapses it (the drift is far too slow to
refill). Fixed by remapping particle positions proportionally whenever the pane
resizes, so the field stretches/contracts with the pane and stays evenly spread.

- `web/components/agent-visualizer/canvas.tsx` — a new `particleDimsRef` records
  the dimensions the field was last laid out against; the create effect seeds it,
  and a new effect keyed on `dimensions` scales every particle's `x`/`y` by the
  new/old dimension ratio (`sx = width/prev.width`, `sy = height/prev.height`).
  No change to `background-layer.ts` — the wrap logic is left as-is, it just no
  longer sees a collapsed field. Needs `npm run build:visualizer`.

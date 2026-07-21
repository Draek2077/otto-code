# Visualizer: PIP, Arena mode, and out-of-view audio

Three related asks, all about the Visualizer being useful when you are _not_
looking at its tab. They share the same underlying need — the Visualizer is
currently only alive while its tab is focused — so they are scoped together.

Related: [docs/visualizer.md](../../docs/visualizer.md),
[projects/visualizer-node-richness](../visualizer-node-richness/visualizer-node-richness.md).

## Status (2026-07-20)

| Item                  | State                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| 3. Audio while closed | **Shipped** (uncommitted). The shared blocker; done first.                  |
| 1. PIP mode           | **Shipped** (uncommitted).                                                  |
| 2. Arena mode         | **Not built.** Architecture decided below; nothing landed, no button added. |

Both architectural questions the charter raised are resolved, and both answers
are recorded in [docs/visualizer.md](../../docs/visualizer.md) — "PIP mode" and
"Voice cues".

## 1. PIP mode — shipped

A picture-in-picture Visualizer pinned to the **top right of the workspace
content**, so it sits over the conversation without belonging to any one pane.

**Resolved: neither reparent nor a second canvas.** Reparenting is not
available — the Electron guest is a `<webview>`, a cross-process surface, and
moving that element detaches/reattaches it, which makes Electron _reload_ the
guest (`visualizer-view.electron.tsx` already carries a `did-start-loading`
re-hide because a layout change does this today). A reparent would destroy the
simulation it was supposed to preserve; a moved `<iframe>` re-executes on web for
the same reason. Two live guests is the doubled per-frame cost the charter warns
about. So **PIP and the tab are mutually exclusive**: one guest alive at a time,
one sim, one star field, and no guest is ever moved — one is retired and the
other starts. The scene survives the handover on the existing
reset+replay/hydrate-settle path, which already restores a tab woken from
resource sleep.

**Resolved: PIP gets its own framing profile**, via a new `config.camera` vendor
patch. The tab sends no `camera` key, so its retuned constants are untouched.

Delivered:

- `visualizer-surface.tsx` — the single implementation both surfaces render.
  `visualizer-panel.tsx` is now a thin pane wrapper (`surface="tab"`).
- `visualizer-chrome-profile.ts` — the entire tab/PIP divergence, as data.
- `visualizer-pip.tsx` / `visualizer-pip-host.tsx` — the overlay and its
  React.lazy split + mutual-exclusion gate.
- Top HUD only (`config.hudBottomHidden`, vendor patch), two sizes, hover fades
  the canvas while the control strip stays opaque, pin is the tab's own lifted
  `followActive`, expand snaps back to the tab in one click.
- Suggested-task chips inset by `useVisualizerPipInset()`. Note the charter's
  `CHAT_PANE_OVERLAY_Z.visualizerPip` note was half-right: the slot is used, but
  z-index alone **cannot** solve this collision — the PIP is mounted at the
  workspace level, above the chips' entire ancestry, and a descendant can never
  out-paint an ancestor's later sibling. The fix has to be geometric.
- Vendor patches logged in `vendor/agent-flow/OTTO-PATCHES.md` (2026-07-20
  `config.camera`, 2026-07-20 `config.hudBottomHidden`); `build:visualizer` run.

## 2. Arena mode — not built

A special mode where **every agent in the app shares one big space** — the whole
app's activity at once, with **all their voices** audible, in a separate window.

### Decisions made (implementation still open)

**Feeding N sessions into one scene needs no new render work.** The vendor page
already renders a graph of many root nodes; what it does _not_ do is render more
than one _session_ at once. So Arena is not "show every session" — it is **one
synthetic session** (`arena`) into which every tracked agent is emitted as a root
node. The adapter needs only two changes: `workspaceId` becomes nullable (already
done for the voice-cue host — same selector shape), and a session mode that keys
every root to the one Arena session id instead of `sessionIdForRootAgent`. Node
names are already collision-disambiguated (`resolveAgentNodeName`). No vendor
patch.

**Arena is scoped to one host, not all hosts.** The adapter is bound to a single
runtime client (backfill + live stream); N hosts would mean N clients feeding one
scene. One host covers the real case and keeps the adapter honest. Cross-host
Arena is deferred, explicitly.

**Separate window is Electron-only, and the fallback is a tab.** `openNew`
(`otto:window:openNew` → `preload.ts` → `main.ts` `createWindow`) exists but
always boots a full app window at the SPA root with no route parameter — so
Electron needs `createWindow` extended to accept an initial route. **Web and
native do not get a window**: renderer-initiated `window.open` is denied by the
browser-webview policy, and native has no concept of one. They open Arena as a
**workspace tab** instead (`{kind: "visualizer", arena: true}`). The mode is the
feature; the separate window is a desktop affordance on top of it.

**Audio in Arena is already built.** The app-global cue host (item 3) is exactly
the "all their voices" plumbing, and `CUE_GLOBAL_MIN_INTERVAL_MS` is what stops N
workspaces becoming a chorus.

### Remaining work

1. Adapter: arena session mode + nullable `workspaceId` in
   `use-visualizer-event-adapter.ts`.
2. `arena: true` on the visualizer tab target + `openArenaTab`.
3. Electron: initial-route parameter on `otto:window:openNew`, plumbed through
   `preload.ts` and `desktop/host.ts`.
4. The title-bar button beside the Visualizer button — a placeholder home per the
   charter, not the design. Note that cluster is now three buttons deep
   (Visualizer, PIP, and Arena would be the third) and is already subject to
   `fitCompactHeaderActions` dropping on narrow headers; this is more evidence
   Arena wants its own surface.

## 3. Audio cues when the Visualizer is not open — shipped

Playback moved out of `visualizer-panel.tsx` (which only ran while a Visualizer
tab was mounted **and** frontmost) into `visualizer-voice-cues-host.tsx`, a
headless component in `_layout.tsx`'s `ProvidersWrapper` — inside `VoiceProvider`
so the shared audio engine resolves, above the router so it never unmounts on a
route change. One hook instance per connected host, `workspaceId: null` = every
workspace. No visibility or focus gate at all, and no visual performance (the
render bundle is never loaded). Respects the `visualizerVoiceCues` setting, the
Visualizer mute, host capabilities, and the `visualizer` feature flag.

Throttling is three layers: per-(agent, moment) dedupe, an **app-wide**
one-cue-per-window rate limit (claimed after the line lookup, so an agent with no
line to speak never burns the slot for one that has), and the pre-existing
`engine.isPlaying()` guard. Over-limit cues are dropped, never queued.

## Not in this project

- The `waiting` cue moment — see
  [projects/voice-cue-waiting](../voice-cue-waiting/voice-cue-waiting.md).
- Cue text quality/variety — fixed 2026-07-20 in
  `packages/server/src/server/agent/voice-cue-generator.ts`.

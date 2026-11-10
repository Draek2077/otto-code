# Visualizer

Visualizer projects the selected workspace's existing Paseo sessions into an
offline graph. It does not run agents, discover provider logs, own transcripts,
or create another connection to a daemon. The same canonical data supplies every
provider, including OpenAI Compatible API and Brain. Missing usage stays unknown.

## Ownership and entry points

`plugins/otto-visualizer` registers the workspace panel, device settings and Open
Visualizer Command Center action. The workspace header menu opens the tab,
picture in picture, or chat background and remembers the preferred placement.
The tab is a normal Paseo plugin target; inactive workspaces keep its descriptor.

Otto code lives under `packages/app/src/otto/visualizer`, with private SDK exports
for the built-in contribution. Tagged seams add only the header control, root
window host, conversation viewport, transient-sidebar layer and About attribution.
Paseo owns routing, workspace layouts, timeline hydration, chat input and scrolling.
The encrypted Paseo protocol and relay/Hub identifiers are unchanged.

## Canonical projection

`session-source.ts` selects open chat roots in this workspace and Paseo's real
parent/child edges. Metadata creates roots immediately, before history arrives.
`feed-owner.ts` retains the existing `ViewedTimelineOwner` background demand for
the selected root and its descendants, or all open roots in the aggregate view.
It releases only its own source lease. Speech and the visible chat keep theirs.

`projection.ts` translates canonical messages, tool calls/results, permissions,
status and reported context/cost. Stable call and message identities prevent a
streaming revision from becoming another conversation message. Cancellation does
not become a failed tool; failures remain inspectable. File activity uses actual
host paths and bounded overlap windows. Discovery cards use supplied results,
never an inferred test verdict. Unknown tools retain bounded result excerpts.

There are at most 64 projected agents, 256 recent rows per demanded agent and a
shared initial hydration budget. Fingerprints are bounded; unchanged canonical
rows use weak identity caching. A renderer frontier is reset and rebuilt from
canonical data on reconnect, changed timeline ownership, removed/reparented
topology, or the bounded event budget. Session selection itself preserves the
renderer’s per-session camera and replay state. Full history remains in Chat.

## Renderer and isolation

`vendor/agent-flow/web` is the Apache-2.0 render layer recovered from the frozen
Otto 0.9 tree. Upstream collectors, CLI, server, extension and relay are excluded.
`OTTO-PATCHES.md` records render changes. The UI calls the feature Visualizer;
Settings, About provides the original attribution. The full renderer license is
embedded in the packaged HTML.

`packages/otto-visualizer` builds one HTML payload, including styles and fonts.
Tailwind scans the renderer only. `npm run build:visualizer` regenerates
`visualizer-bundle.gen.ts`; `build:app-deps` includes this step for all products.
CI compares the regenerated module with the committed bytes.

`contracts.ts` validates a private presentation envelope with version, a fresh
guest channel, bounded frames and tagged commands. It is not a daemon protocol
or public plugin RPC. A guest reports readiness only after render subscriptions
mount. There is no pre-ready event queue; canonical state replays when ready.
Bundle/palette/quality replacement creates a new guest identity. A readiness
timeout or guest failure shows a rendered Reconnect action.

Web uses two opaque sandboxed frames. The parent owns navigation policy and
source-matched relaying; neither guest can access app DOM/storage or network.
Electron uses a dedicated, nonpersistent `otto-visualizer` partition, with Node
and preloads disabled. Main denies permissions, network, nested guests, windows
and navigation. These guests are not browser-tool targets. Native uses an
incognito WebView without DOM storage, cookies, filesystem or external navigation.
File-open commands are accepted only for actual paths projected for this guest.

## Tab, PIP and background lifetimes

One window lease arbitrates tab and PIP renderers. PIP has priority. Inactive
retained panels, other workspaces and hidden/minimized windows destroy the
guest, simulation, subscriptions and local render effects. They retain tab
descriptors, selections and device preferences. Restoring a surface creates a
fresh validated guest and canonical replay. Visible chat backgrounds are the
explicit singleton exception; each follows its own chat root.
An unsent draft follows the focused workspace root until its own canonical agent
exists. The tab identity carries the deliberate conversation visibility choice
through that normal Paseo handoff.

On web/Electron PIP uses the full window overlay, above resident browser guests,
below transient sidebars, menus and dialogs. Root web menu sheets join the shared
modal overlay plane; pane-scoped sheets keep their measured host and native
sheets keep their original presenter. Its two sizes clamp to the current
window. Dragging persists position fractions; resizing keeps the nearest-edge
inset. The toolbar appears on hover/focus and stays available on touch layouts.
Expand reveals the existing tab; closing PIP does not delete it.

Chat background wraps only the conversation viewport. The Composer stays
outside it. Its canvas does not scroll with transcript content. Conversation
opacity is 80%, or 25% while dwelling over empty vertical space for 200 ms with
10 px text clearance. Controls, text, selections and scrollbar gutters keep
their input ownership. Explicit graph-only state persists for the workspace tab
across sends and draft-to-agent conversion. Restore or actual tab close clears
it; mere eviction/workspace switching does not. Native uses an explicit toggle.
The latest assistant canvas bubble stays until the next assistant reply while
the conversation is hidden. Rich media readers are separate future work.

## Controls and compatibility

Native toolbars provide chat/aggregate selection, focused-chat following/pinning,
fit, rendering sound mute, PIP, and existing Timeline, File activity, Reported
cost, Failures and statistics panels. Device settings retain render quality,
shapes, context ring/bar, bloom, glow, stars, backdrop, frame meter, HUD, sound
volume, PIP size/position and exact 0.9 preference keys. Conflicting old placement
flags are normalized at one dated compatibility boundary without resetting data.
Settings and action failures remain visible in their current context.
The private built-in UI bridge binds app-owned controls to the app query client.
Plugin installation caches remain separate; a panel must not create another
device-settings owner that the window host cannot observe.
The background control strip restores the conversation, switches to PIP or the
tab, and closes background placement without moving the Composer.

Demo starts only when connected with no open chat tabs and no guest sessions.
It has an explicit Stop action; real sessions terminate demo before their events
enter the renderer. Demo never runs a provider. Existing Speech owns narration,
activity voice cues and playback independently; graph effects do not create a
second speech queue or microphone owner.

## Validation boundaries

Colocated pure fixtures exercise projection, data bounds, canonical demand,
reconnect, preference continuity, private frames, singleton arbitration and
anchoring. The regular Otto browser acceptance lane exercises the actual
daemon/provider tool loop and renderer in wide/compact layouts. The existing
Electron browser lane checks the private guest, network denial, browser plane,
hidden-window destruction and tab/PIP handoff. See [testing.md](testing.md).
Physical-device input/audio and user-specific provider settings retain their
device/environment review; fixture or browser evidence does not claim those.

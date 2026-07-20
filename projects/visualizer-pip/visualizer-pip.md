# Visualizer: PIP, Arena mode, and out-of-view audio

Three related asks, all about the Visualizer being useful when you are _not_
looking at its tab. They share the same underlying need — the Visualizer is
currently only alive while its tab is focused — so they are scoped together.

Related: [docs/visualizer.md](../../docs/visualizer.md),
[projects/visualizer-node-richness](../visualizer-node-richness/visualizer-node-richness.md).

## 1. PIP mode

A picture-in-picture Visualizer pinned to the **top right of every conversation**.

- Partial HUD only — the **top HUD**, nothing else. No options, no controls.
- The scene keeps whatever state it had in full mode; PIP is a viewport change,
  not a different renderer.
- **Two sizes**: small and medium.
- **Hover makes it transparent** so it never blocks the chat underneath.
- Pinning still works in PIP.
- **Snap back to tab** must be one obvious click.
- Suggested-task chips render **above** the PIP (or left-aligned so they don't
  collide).

Open questions:

- Does PIP host a second canvas or reparent the existing one? Reparenting keeps
  one sim and one set of stars; two canvases doubles the render cost per frame.
- Interaction with the existing camera auto-fit: PIP is small, so the framing
  constants (now `ANIM.viewportPadding` / `AUTOFIT_MAX_SCALE`, see
  `vendor/agent-flow/OTTO-PATCHES.md` 2026-07-20) probably need a PIP-specific
  profile rather than the tab's values.

## 2. Arena mode

A special mode where **every agent in the app shares one big space** — the whole
app's activity at once, with **all their voices** audible.

- Opens in a **separate window** so it stays "focused"/visible as its own thing.
- Button placement: for now, **next to the Visualizer button in the top title
  bar**, until a better home appears. This likely deserves a dedicated surface
  eventually — treat the title-bar button as a placeholder, not the design.

Open questions:

- Arena is cross-workspace, but the Visualizer bridge is currently session- and
  workspace-scoped. Feeding N sessions into one scene is the real work here.
- Separate window = Electron-only in practice. Decide what web/native do.

## 3. Audio cues when the Visualizer is not open

Voice cues are the notification channel — if you're not on the Visualizer tab
you can't tell anything happened.

- Fire the **audio** for a cue when the event occurs even while the Visualizer
  is closed, **without** running the visual performance.
- Needs a decision on where cue playback lives: today it is driven by
  `packages/app/src/visualizer/use-visualizer-voice-cues.ts`, which only runs
  while the panel is mounted. Playback has to move to an always-mounted host
  (or a small always-on subscriber) for this to work at all.
- Must respect the existing voice-cue enable/disable setting, and needs a
  throttle — every agent in every workspace firing cues at once is the failure
  mode.

## Not in this project

- The `waiting` cue moment — see
  [projects/voice-cue-waiting](../voice-cue-waiting/voice-cue-waiting.md).
- Cue text quality/variety — fixed 2026-07-20 in
  `packages/server/src/server/agent/voice-cue-generator.ts`.

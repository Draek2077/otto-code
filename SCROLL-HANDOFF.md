# Chat scrolling handoff

Repo: `otto-code` (fork of Paseo / `getpaseo/paseo`, remote `upstream`).
Working tree state as of this document. **Nothing is committed.**

---

## 1. Background

Otto's chat transcript scroll behaviour has regressed repeatedly across three minor
releases. Reported symptoms over time: the transcript jumping to the top of the
conversation, follow-output not disengaging when the reader scrolls up, and the
jump-to-bottom button appearing to do nothing.

The fork had diverged heavily from upstream in one file. Line counts:

| File                                                  | Paseo 0.2.5 | Otto (before this work) |
| ----------------------------------------------------- | ----------- | ----------------------- |
| `packages/app/src/agent-stream/strategy-web.tsx`      | 692         | 1153                    |
| `packages/app/src/agent-stream/web-virtualization.ts` | 94          | 184                     |
| `packages/app/src/agent-stream/view.tsx`              | 1642        | 1942                    |

The fork's 461 added lines in `strategy-web.tsx` were a layer that tried to infer
**why** `scrollTop` changed (reader gesture vs browser clamp vs the app's own
write) from the numbers alone: a programmatic-echo latch, a clamp bound, a
content-space scroll anchor, a measured-row-height cache, and an ownership rule
arbitrating between the anchor and TanStack Virtual's resize absorb.

Upstream took the opposite approach. Their current `main` (1168 lines) has none of
the inference layer. Instead it detects reader **intent from input devices**
exhaustively: scrollbar-gutter presses by geometry, middle-click autoscroll,
ArrowUp / PageUp / Home / Shift+Space with a nested-scroller check, and a 100ms
window (`UPWARD_INPUT_EVIDENCE_TIMEOUT_MS`) attributing the resulting scroll event
to that input.

**Decision taken:** abandon the fork's divergence and vendor upstream's scroll
implementation unmodified, so that any future bug is attributable. While those
files are byte-identical to upstream, a bug is either upstream's (verifiable by
running upstream) or caused by Otto code outside those files. Modifying them
destroys that property.

---

## 2. Current state of the tree

### 2a. Vendored from `upstream/main`, verified byte-identical

Do not edit these. Verify with
`git show upstream/main:packages/app/src/<path> | diff - packages/app/src/<path>`.

```
packages/app/src/agent-stream/strategy-web.tsx
packages/app/src/agent-stream/strategy-web.test.tsx
packages/app/src/agent-stream/history-start-pagination.ts
packages/app/src/agent-stream/history-start-pagination.test.ts
packages/app/src/agent-stream/history-start-settle-scheduler.ts        (new file)
packages/app/src/agent-stream/history-start-settle-scheduler.test.ts   (new file)
packages/app/src/agent-stream/prompt-jump-settle.ts                    (new file)
packages/app/src/agent-stream/prompt-jump-settle.test.ts               (new file)
packages/app/src/agent-stream/use-scroll-to-message.web.ts             (new file)
packages/app/src/components/retained-panel.tsx
packages/app/src/components/ui/loading-spinner.tsx
```

The last two are in this list only because upstream's version adds
`import React from "react"`, which our copies lacked. Without it, any unit test
that renders them throws `ReferenceError: React is not defined`, because the
`vitest` esbuild transform uses the classic JSX runtime while the app build
(babel-preset-expo) uses the automatic one. This is latent across ~463 of our
`.tsx` files and ~303 of upstream's; neither project has fixed it globally. A
one-line fix exists and was **not** applied: `esbuild: { jsx: "automatic",
jsxImportSource: "react" }` in `packages/app/vitest.config.ts`. It was verified to
work (strip the import, test fails without it and passes with it) and then reverted
as out of scope.

### 2b. Otto-owned files edited for integration

| File                                    | Change                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-stream/strategy.ts`              | Added optional `StreamRenderInput.onReadingPositionChange?: (rowId: string \| null) => void`. Added optional `StreamViewportHandle.scrollToMessage?: (itemId: string) => void`. Widened `onNearHistoryStart` from `() => void` to `() => boolean \| Promise<boolean>`. |
| `hooks/use-load-older-agent-history.ts` | `loadOlderAgentHistory` and `loadOlder` now return whether a load is underway: already-loading returns `true`, nothing to load / no client returns `false`, started (including a fetch that later fails) returns `true`.                                               |
| `panels/provider-subagent-panel.tsx`    | Same contract for the read-only provider-subagent transcript's `loadOlder`.                                                                                                                                                                                            |
| `agent-stream/view.tsx`                 | Two type widenings so the boolean flows through: `historyPagination.onLoadOlder` and `ResolvedHistoryPagination.loadOlder`.                                                                                                                                            |
| `app/_layout.tsx`                       | Added `useEffect(() => installWebScrollbarStyles(), [])` plus its import, matching upstream's `RootLayout`.                                                                                                                                                            |

**Why `onNearHistoryStart` had to change.** Upstream's `strategy-web.tsx` does:

```js
const started = await onNearHistoryStart();
if (started === true) return;
// otherwise: abandonHistoryStartPaginationRequest(...)
```

With a `void`-returning handler, every older-history request is marked abandoned.
Upstream satisfies this via their own `use-load-older-agent-history`, which depends
on `selectAgentTimelineState` and a `agentTimelineHasNewer` session-store field we
do not have (part of their timeline-tail-navigation feature). Rather than port that
store work, the contract was satisfied from Otto's side, which keeps the vendored
files pristine.

**Why `installWebScrollbarStyles` had to be called.** The function existed in our
tree with **zero callers**; upstream calls it from `RootLayout`. Our
`styles/install-web-scrollbar-styles.web.ts` is identical to upstream's apart from
the style element's id (`otto-` vs `paseo-`). It installs the `::-webkit-scrollbar`
rules. Before adding the call, the chat scrollbar was completely unstyled.

### 2c. Also modified, NOT part of this work

`composer/agent-controls/index.tsx`, `hooks/use-agent-form-state.ts`,
`provider-selection/resolve-agent-form.ts` and its test were already modified in
the working tree and are unrelated.

### 2d. Verification run

- `cd packages/app && npx tsgo --noEmit` → **0 errors**
- `npm run lint -- packages/app/src/agent-stream/ ...` → **0 warnings, 0 errors**
- `cd packages/app && npx vitest run src/agent-stream src/components src/hooks src/panels`
  → **1274 tests / 145 files passed**

Includes upstream's own `strategy-web.test.tsx` passing against upstream's code
inside our tree.

---

## 3. THE OPEN PROBLEM

**The chat scrollbar is a Chromium overlay scrollbar: very thin, auto-hides within
a moment of scrolling, does not grow on hover, occupies zero layout width, and is
effectively impossible to grab and drag.**

### 3a. Measured in the running dev app

Pasted into the Electron dev app's DevTools console against the live chat
scroller (`[data-testid="agent-chat-scroll"]`):

```json
{
  "matches": 1,
  "gutterPx": 0,
  "ottoStyleTag": true,
  "hideScrollbarAttr": false,
  "inlineScrollbarWidth": "(unset)",
  "computedScrollbarWidth": "thin",
  "computedScrollbarColor": "color(srgb 0.529412 0.54902 0.65098 / 0.62) rgba(0, 0, 0, 0)",
  "overflowY": "auto",
  "scrollable": 5245
}
```

Reading: our stylesheet **is** installed, the standard `scrollbar-width` /
`scrollbar-color` properties **are** applied, no stale suppression from Otto's old
overlay hook, and `gutterPx: 0` means the scrollbar takes no layout space, i.e. it
is an overlay.

### 3b. CSS is not the cause

Probed with Playwright against headed Edge (Chromium 151) on the same machine,
measuring `offsetWidth - clientWidth` on an overflowing div:

| CSS                                                        | gutter                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `::-webkit-scrollbar { width: 8px }` only                  | 8px (classic)                                            |
| `scrollbar-width: thin` + `scrollbar-color` + webkit rules | 10px (classic; standard props win over the webkit width) |
| `scrollbar-width: thin` + `scrollbar-color` only           | 10px (classic)                                           |
| `scrollbar-width: auto` + webkit rules                     | 8px (classic)                                            |

Every combination produced a **classic** scrollbar with real layout width. None
reproduced `gutterPx: 0`. (Note: the same probe run **headless** reports 0 for
every case, which is a headless artifact and misleading.)

### 3c. Root cause

`packages/desktop/src/main.ts:468`

```js
appendChromiumFeatures(["OverlayScrollbar"]);
```

Otto enables Chromium's **process-wide** overlay-scrollbar feature. The comment
above it (`main.ts:443-467`) explains why: guest pages in the Otto browser pane
(`<webview>`) otherwise draw a classic 15px scrollbar, and a styled
`::-webkit-scrollbar` still occupies layout width, which would distort the very
pages the Preview subsystem asks agents to verify. It states the assumption it
rests on:

> Enabling it app-wide is effectively scoped to guest pages anyway - there is no
> native scrollbar left in Otto's own renderer for it to change.

That assumption held while every Otto surface set `scrollbar-width: none` and
painted its own overlay (`components/use-web-scrollbar.tsx`,
`components/web-desktop-scrollbar.tsx`). **It stopped holding the moment
upstream's transcript was vendored in, because that code relies on the browser's
own scrollbar.** The process-wide flag now applies to the chat transcript.

This is not a Paseo bug and not a missing file from the port. It is a genuine
conflict between two Otto decisions that could not collide before.

### 3d. Constraint that makes it awkward

Upstream detects a scrollbar drag as reader intent in
`strategy-web.tsx:isVerticalScrollbarGutterPress`, which requires
`event.target === scrollContainer` and measures
`Math.max(offsetWidth - clientWidth, WEB_SCROLLBAR_SIZE_PX)`. Otto's overlay
scrollbar is a **separate element** that writes `scrollTo` on the scroller, so a
pointerdown on it never satisfies that test. Restoring Otto's overlay therefore
reintroduces the hole the fork's 461 lines existed to fill: dragging the scrollbar
would not disengage follow-output, and a stream flush would pull the reader back
down.

---

## 4. Options considered (none implemented)

1. **Restore Otto's overlay scrollbar on the chat container.** Keeps preview
   fidelity and gives a good scrollbar. Needs a way for the overlay to report its
   own drags as reader intent without editing the vendored file. The overlay is the
   one actor in the system that knows with certainty when its thumb is being
   dragged.
2. **Remove the `OverlayScrollbar` Chromium flag.** Chat gets a proper classic
   scrollbar immediately. Reintroduces a 15px gutter in browser-pane guest pages,
   which is the thing `main.ts:443-467` exists to prevent. Read
   `docs/preview.md` before choosing this.
3. **Keep the overlay but widen it.** `scrollbar-width: auto` instead of `thin` in
   `styles/web-scrollbar.ts` makes the thumb easier to hit. The auto-hide fade is
   not controllable from CSS. Note that file is currently identical to upstream's.
4. **Accept it** as a scroll indicator rather than a control; wheel, trackpad and
   keyboard all work.

---

## 5. Dead ends already tried (do not repeat)

Four changes were made to the fork's old `strategy-web.tsx`, all tests green, and
they made the app **materially worse**: the transcript froze while messages
accumulated below the fold unseen, then snapped to the bottom. All four were
reverted before the upstream port.

1. Re-attach threshold 1px → 20px (`AUTO_SCROLL_RESUME_THRESHOLD_PX`).
2. Applying the same 20px band to the detach test.
3. `onNearBottomChange` reporting the follow state only, instead of
   `following && within 64px of bottom`.
4. `overflowAnchor: "none"` on the scroll container. Note upstream's current file
   sets this itself, so it is now present via the vendored code.

A fifth (deleting the `maxInvoluntaryDrop` bound) was retracted before shipping:
walking the cases showed it behaviour-neutral, because a reader's own gesture adds
to the drop and pushes it past the bound anyway.

**Lesson worth carrying:** `strategy-web.test.tsx` drives a hand-built scroll box
with no layout, no streaming document, no measurement batches and no native scroll
anchoring. Green there predicts nothing about the browser. Verify scroll changes in
the running app.

---

## 6. Useful commands

```bash
# Revert everything scroll-related to committed HEAD
git restore --worktree packages/app/src/agent-stream packages/app/src/app/_layout.tsx \
  packages/app/src/hooks/use-load-older-agent-history.ts \
  packages/app/src/panels/provider-subagent-panel.tsx packages/app/src/components

# Confirm a vendored file is still pristine
git show upstream/main:packages/app/src/agent-stream/strategy-web.tsx \
  | diff - packages/app/src/agent-stream/strategy-web.tsx

# Compare against the 0.2.5 merge base instead (Paseo side of merge 5e3cc1def)
git show 5e3cc1def^2:packages/app/src/agent-stream/strategy-web.tsx

# Verify
cd packages/app && npx tsgo --noEmit
npm run lint -- packages/app/src/agent-stream/
cd packages/app && npx vitest run src/agent-stream
```

Related docs: `docs/chat-scrolling.md` (describes the **old** fork design and is now
stale with respect to the vendored code), `docs/preview.md`, `AGENTS.md`.

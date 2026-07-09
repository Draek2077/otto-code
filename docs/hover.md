# Hover

Read this before writing any hover code. Every hover regression we ship is one of the three failure modes below, and every one of them is solved by the same canonical pattern. The pattern is hardwon — it survived every other shape we tried — so copy it, don't reinvent it.

## The pattern

The canonical implementation lives in `packages/app/src/components/sidebar-workspace-list.tsx`, in the workspace row (around line 1369). When in doubt, open that file and copy the shape.

```tsx
//
//   ┌─ Plain View. Tracks hover via pointerenter/pointerleave.
//   │
<View
  style={styles.workspaceRowContainer}
  onPointerEnter={handlePointerEnter}
  onPointerLeave={handlePointerLeave}
>
  <Pressable                          // ┐ Separate inner Pressable.
    onPress={handlePress}             // │ Handles press only.
    onPressIn={...}                   // │ Never has onHoverIn/onHoverOut.
    onPressOut={...}                  // ┘
    style={workspaceRowStyle}
  >
    <View style={styles.workspaceRowMain}>
      <View style={styles.workspaceRowLeft}>…</View>
      <WorkspaceRowRightGroup isHovered={isHovered} />
      {/*                    └─ Reveals content based on hover state. */}
    </View>
  </Pressable>
</View>
```

Five things make this work. Every one of them matters.

1. **Hover lives on a plain `View`, not a `Pressable`.** `Pressable` carries its own internal hover state machine. Nested `Pressable`s fight over it. A plain `View` just dispatches DOM events — no state machine, no fighting.
2. **Press lives on a _separate_ inner `Pressable`.** Hover and press never share an element. The two state machines never see each other.
3. **`onPointerEnter` / `onPointerLeave` are non-bubbling**, mouseenter-style by W3C spec. They fire only when crossing the outer `View`'s bounding box. Crossing into descendants — including descendant `Pressable`s (the kebab menu's buttons, a copy button, a tooltip target) — does **not** fire `pointerleave`. This is why nesting `Pressable`s inside is safe.
4. **The row has a fixed `minHeight`.** When content swaps in on hover (kebab replacing a diff stat), both occupy the same fixed slot. Zero layout shift, zero geometry flicker.
5. **The outer `View` has nothing but `position: relative`.** It exists only to be the hover target. All real layout lives on the inner `Pressable`. The hover-tracker is a sealed envelope around the row; layout changes inside it never leak out and re-enter through the side.

That's the whole pattern. Internalize it.

## When you skip the pattern, here is what breaks

### Failure mode 1 — Nested Pressables fight over hover state

If you put `onHoverIn` / `onHoverOut` on a `Pressable` that has another `Pressable` anywhere inside it (a copy button, an icon button, a nested action), the moment the cursor moves onto the inner `Pressable`, the inner one's hover state machine claims hover and the outer one's `onHoverOut` fires. Your reveal state flips off. The reveal hides. The cursor is no longer over the hidden reveal, so it ends up back over the trigger area. The outer's `onHoverIn` fires. Loop.

This is the most common hover bug shipped in this codebase, by a wide margin. It is what the workspace row is structured to avoid. The fix is not "be clever about handlers" — it's "don't put hover on a Pressable that contains other Pressables."

> **Rule:** the hover-tracking element is a plain `View` with `onPointerEnter` / `onPointerLeave`. Any `Pressable`s — including ones you forgot are Pressables, like `TurnCopyButton`, icon buttons, anything that handles a tap — live inside it.

### Failure mode 2 — The hovered state changes the trigger's geometry

Symptom: you hover a button, it changes appearance, then flickers between hovered and not-hovered without the cursor moving.

Cause: the hover state changed the size or position of the trigger. The cursor was on the original element; the new layout shifts or shrinks it out from under the cursor; `onHoverOut` fires; state reverts; original layout returns; cursor is back over the trigger; `onHoverIn` fires; loop.

Common variants:

- Hover state changes the trigger's `width`, `height`, `padding`, or `borderWidth`.
- Hover state mounts/unmounts a child that pushes the trigger to a new position.
- Hover state swaps the trigger for a different element type, remounting it.

Fixes, in preferred order:

1. **Don't change the trigger's outer geometry on hover.** Change colors, opacity, borders that don't take layout space (`outlineWidth` on web, absolutely positioned overlays), or child content that fits inside the same fixed box. Never change `width`, `height`, `padding`, or `borderWidth` of the hover target itself.
2. **Hide with `opacity` + `pointerEvents`, not conditional rendering**, when the hidden element lives inside the trigger. Mounting/unmounting on hover reflows the layout under the cursor.
3. **Pin the hit area.** Set a fixed `minHeight` / `minWidth` on the trigger so internal swaps (icon-A becomes icon-B on hover) leave the bounding box unchanged. The workspace row's `minHeight: 36` is what makes the kebab/diff-stat swap stable.

### Failure mode 3 — Revealed content lives outside the hover trigger

If hovering element A reveals element B, B must be **inside** A's hover trigger. If B is a sibling, the moment the cursor moves from A toward B it crosses out of A's bounding box, `pointerleave` fires, B disappears.

Wrong:

```tsx
<View>
  <View onPointerEnter={...} onPointerLeave={...}>     {/* hover trigger */}
    <Bubble />
  </View>
  <TrailingRow />                                       {/* OUTSIDE — sibling, not child */}
</View>
```

Right:

```tsx
<View onPointerEnter={...} onPointerLeave={...}>      {/* hover trigger */}
  <Bubble />
  <TrailingRow />                                      {/* INSIDE — child */}
</View>
```

Any gap between A and B (margins between siblings inside the same parent) is part of the parent's bounding box, so the cursor stays inside the hover region while crossing it. No bridge needed.

If A and B genuinely can't share a parent — B portals into a different layer, floats above other content — see [Section: real gaps](#real-gaps-with-floating-panels) below.

## Native fallback

Hover doesn't exist on touch devices. Anything you hide behind hover must have a non-hover path on native and compact layouts:

```tsx
const showControls = isHovered || isNative || isCompact;
```

`isNative` and `isCompact` come from `@/constants/platform` and `@/constants/layout`. Don't use `Platform.OS === "ios"` as a proxy.

`onPointerEnter` / `onPointerLeave` are DOM events. They do not fire on native. You do not need to gate them — on native, hover is unreachable anyway and visibility is driven by `isNative` / `isCompact` in your show-the-controls expression above. This is why the workspace row's pointer events are not wrapped in `if (isWeb)`.

## What about `Pressable.onHoverIn` / `onHoverOut`?

It's fine when a `Pressable` styles **itself** based on its own hover — for example, an icon button that changes color on hover. That's self-contained. The render-prop `<Pressable style={({ hovered }) => ...}>` does the same thing more cleanly and is the preferred form.

It is **not** fine for tracking hover to drive state **outside** that `Pressable` (revealing a sibling, opening a tooltip, showing a kebab) when there is any other `Pressable` inside — because that's Failure Mode 1.

Heuristic: if your hover state is going to be `useState`'d and read by anything other than the same `Pressable`'s own style, do not use `onHoverIn` / `onHoverOut`. Use the canonical pattern.

## Electron drag regions are hover dead zones

On desktop, titlebar strips (`TitlebarDragRegion` in `packages/app/src/components/desktop/titlebar-drag-region.tsx` — the sidebar header, screen headers, and every pane's tab row) are covered by a `-webkit-app-region: drag` overlay. Chromium's window hit test treats those pixels as the native window caption, so **no pointer events reach the page there at all** — no `pointerenter`, no `pointermove`, not even CSS `:hover`. The only hover-sensitive pixels inside a drag strip are the no-drag islands: interactive elements stamped `-webkit-app-region: no-drag` by the scoped backstop in `packages/app/public/index.html` (and note that stamping happens on **unclipped bounding boxes**, so even invisible, `pointerEvents: "none"` buttons punch holes).

Consequences for hover features in these strips:

- **A reveal that requires hovering bare drag-strip pixels needs the non-client escape hatch below.** Plain DOM hover will work in a browser tab and silently fail in the desktop app. Without the escape hatch, the reveal must trigger from elements that receive events — widen the region by stamping a container `no-drag` (see the tab row's tools strip in `workspace-desktop-tabs-row.tsx`) or by including more event-receiving elements (the tab chips).
- Every pixel is zero-sum for DOM events: `no-drag` regains hover but loses window dragging there. Don't blanket-no-drag a titlebar strip.
- `pointerleave` is also swallowed: a hover state set while crossing an island can go stale when the cursor parks on drag pixels. Keep such staleness benign (an idle reveal, not a stuck interaction).

**The escape hatch — main-process cursor polling.** `hookWindowMessage(WM_NCMOUSEMOVE)` does NOT work: Chromium consumes non-client mouse messages before Electron's hooks see them (verified empirically — the hook never fires while the cursor crosses a drag region). What works is polling: the main process polls `screen.getCursorScreenPoint()` (~20Hz, only while the window is focused, deduped while the cursor rests) and forwards the content-relative position (DIP ≈ CSS px at zoom 1) as `nc-mouse-move`/`nc-mouse-leave` desktop events — `setupCursorHoverForwarding` in `packages/desktop/src/window/window-manager.ts`. On the app side, `useNonClientHover(ref)` (`packages/app/src/hooks/use-non-client-hover.ts`) hit-tests those points against an element's rect and returns a complete "cursor is over the element" flag — the poll sees every pixel, drag regions and client pixels alike. The hook is inert in browser web and on native, and on macOS drag regions deliver DOM hover natively so the DOM path covers everything. Main-process changes require a desktop rebuild + restart to take effect.

## Real gaps with floating panels

Sometimes the revealed content can't live inside the trigger — a hover card portals into a different layer, a tooltip floats above other content, a popover renders into a `Portal`. There's a real visual gap the user has to cross with the cursor.

For this case, use `useHoverSafeZone` (`packages/app/src/hooks/use-hover-safe-zone.ts`). It computes a rectangular "bridge" between the trigger and the content; while the pointer is inside trigger, content, or the bridge, the card stays open. A short grace timer absorbs jitter at the edges. The canonical caller is `packages/app/src/components/workspace-hover-card.tsx`.

Don't roll your own. The math is annoying, the edge cases (pointer leaves window, drag in progress, content unmounts) are subtle, and we already paid for the hook.

## Pre-PR checklist

Before opening a PR that touches hover:

- [ ] Hover-tracking is on a plain `View` with `onPointerEnter` / `onPointerLeave`, **not** on a `Pressable` that wraps anything pressable.
- [ ] Any press behavior lives on a separate inner `Pressable` that does not have `onHoverIn` / `onHoverOut`.
- [ ] The hover trigger's bounding box contains every element the user might mouse into while interacting with the feature.
- [ ] Hovered state does **not** change the trigger's outer geometry (`width`, `height`, `padding`, `borderWidth`, mount/unmount of siblings that shift it). Internal swaps fit inside a fixed `minHeight` / `minWidth`.
- [ ] Revealed content inside the trigger uses `opacity` + `pointerEvents`, not conditional rendering, if mounting it would reflow the trigger.
- [ ] Visibility on native and compact layouts works without hover (`isHovered || isNative || isCompact`).
- [ ] If the revealed content sits in a separate layer (portal, floating panel), `useHoverSafeZone` is wired up.
- [ ] You opened the dev server, hovered the trigger, and slowly moved the mouse along **every** revealed element — including any visible gaps — without losing hover state.

# Browser Capture Harness

The desktop capture harness is the real-Electron verification path for browser screenshots.
It validates the compositor behavior that unit tests cannot see:

- the resident automation `<webview>` starts in the production parking state;
- the parked guest remains paintable and has a copyable viewport frame;
- a never-presented resident webview guest defaults to 1280x800 logical pixels;
- multiple resident webviews are parked as an overlapping stack without per-capture
  stacking changes;
- a newly attached resident webview whose first useful frame is delayed can be captured
  by retrying until the frame appears;
- both viewport `capturePage` and full-page CDP screenshots return real pixels from
  the permanent production parking state;
- guest background throttling can be disabled once at attach without per-capture
  renderer coordination.

Run it with the repo Electron:

```bash
npm run capture-harness --workspace=@otto-code/desktop
```

Run the browser automation fixture with:

```bash
OTTO_CAPTURE_HARNESS_GROUP=automation npm run capture-harness --workspace=@otto-code/desktop
```

The automation group uses a real guest webview to verify the page-side ref contract:
ARIA-like snapshot text includes headings, static text, and controls; refs survive
`pushState` when the element still matches; same-URL rerenders stale old refs; and a
file-input ref can be resolved to a CDP backend node id for upload. It also verifies
page-context evaluation, including passing a resolved ref element as the function argument.

On macOS the harness process must set `app.setActivationPolicy("accessory")` and
hide the Dock icon before creating any window. `showInactive()` only prevents window
focus; a normal Electron app launch can still activate the app and steal focus.
Harness windows are then created hidden, positioned in a screen corner, skipped from
the taskbar where Electron supports it, and revealed with `showInactive()` from
`ready-to-show`. Do not replace this with `show()`, `focus()`, or `app.focus()`:
the compositor only needs visible inactive windows, and harness runs must not steal
focus from the person using the machine.

The harness writes PNG evidence and `results.json` to:

```text
packages/desktop/capture-harness/out/
```

A passing run prints `PASS` lines for the production P1 attach-off parking state,
including fresh, settled, 75-second soak, multi-tab, viewport, and full-page checks. The
PNG sizes may be device-pixel scaled; on a Retina display the 1280x800 logical viewport
is usually saved as 2560x1600.

## Mechanism

Electron captures copy from the guest web contents' compositor surface. A resident
webview parked with `display:none`, offscreen coordinates, or `opacity:0` can lose its
copyable surface. Each production webview keeps one permanent body-level surface. Presenting
or parking changes that surface's geometry without reparenting the webview. The parking state
uses `left:0`, `top:0`, `width:1px`, `height:1px`, `overflow:hidden`, `opacity:1`, and
`pointer-events:none`. The webview stays at its resolved logical viewport, defaulting to
1280x800 before first presentation, with `display:inline-flex` at `left:0`, `top:0`.
Presentation resolves responsive guests to the pane's exact pixel dimensions after the surface
has visible bounds. Do not apply percentage guest sizing against the parked surface: Electron
exposes the 1x1 parking geometry as a real guest resize before expanding it again.

The permanent browser host and `overlay-root` are explicit sibling paint planes. The browser
plane stays below the overlay plane regardless of body insertion order; menus keep their relative
layering inside `overlay-root`. Activating a presented browser also focuses its registered guest
`WebContents` in main so macOS assigns keyboard first-responder ownership to the page.

There is no renderer prep/restore handshake. Main disables guest background throttling
once when the webview attaches, then screenshot capture uses the shared serialized queue,
invalidates before each attempt, and retries known first-frame failures within the
5-second capture budget. Viewport screenshots use `capturePage({ stayHidden:false })`;
full-page screenshots use the existing CDP path with layout metrics and screenshot clip.

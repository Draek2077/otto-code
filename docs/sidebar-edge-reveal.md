# Sidebar edge reveal

On the desktop app, while the window is maximized or fullscreen, a collapsed sidebar can be peeked
in from its screen edge. Resting the pointer on the left edge brings in the app sidebar; resting it
on the right edge brings in the workspace Explorer. Moving the pointer out of the peeked sidebar
sends it away again. The setting is **Settings > Appearance > Layout > Reveal sidebars at screen
edges** (`sidebarEdgeReveal`, device-local, on by default).

## Contract

- **A peek never opens a sidebar.** It does not touch `panel-store` open state or the Explorer
  pane's `hidden` flag, and nothing about it persists. Pinning the sidebar from inside a peek (its
  own toggle, or the keyboard shortcut) makes it docked, which ends the peek. Internal interactions,
  including switching Explorer tabs, keep the sidebar transient and floating.
- **A peek is an overlay.** The panel is portaled into the overlay root at
  `OVERLAY_Z.sidebarPeek`, pinned to the screen edge, so the workspace underneath never reflows.
  It paints above the window-wide Visualizer PIP but below tab drags, menus, and dialogs. Docked
  sidebars remain in ordinary layout and therefore do not cover the PIP.
- **Animations follow the global setting.** With **Animate transitions** on, the panel slides in
  from off-screen and back out (`SIDEBAR_SLIDE_DURATION_MS`). With it off, the panel appears and
  disappears instantly. Its content unmounts once the panel is gone, so a hidden sidebar costs
  nothing between peeks.
- **Collapsed includes focus mode.** Both sidebars can be peeked while focus mode hides them.
- **Peeked sidebars remain resizable.** Their inner-edge splitter stays visible and draggable while
  the sidebar is swooped in. Resizing updates the same saved width used by the docked sidebar, so
  the new width survives after the peek leaves and is used the next time the sidebar opens.

## How it works

| Piece                                                         | Role                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stores/sidebar-edge-peek-store.ts`                           | The peeked side, per-side availability, and the painted panel element for hit-testing                                                                                |
| `components/sidebar-edge-peek/use-sidebar-edge-reveal.web.ts` | The one document-level `mousemove` controller, mounted in the app shell and running only while eligible (setting on, Electron, non-compact, maximized or fullscreen) |
| `components/sidebar-edge-peek/sidebar-edge-reveal.ts`         | Pure edge, dwell, dismissal, and eligibility rules                                                                                                                   |
| `components/sidebar-edge-peek/sidebar-edge-peek-panel.tsx`    | The animated overlay panel                                                                                                                                           |

Each side's surface **claims** availability while it can peek: the app shell's `SidebarChrome`
for the left, and the focused workspace's `SplitContainer` for the right (only when the workspace
has an Explorer pane that is not docked). Availability is a set of claims rather than a flag
because the workspace deck keeps several workspace screens mounted, and an unfocused one releasing
its claim must not clear the focused one's. When a side's last claim is released, an open peek on
that side ends.

Timing and geometry rules, all in `sidebar-edge-reveal.ts`:

- The pointer must be within 2 px of the edge and rest there for 150 ms, so a cursor thrown across
  the screen or on its way to another monitor does not trigger a peek. A held mouse button never
  arms one.
- The top 48 px never trigger. That strip belongs to the title bar and the window controls, and
  throwing the cursor into the top-right corner to close the window must not swoop the Explorer
  over the close button.
- The peek stays while the pointer is inside the panel or still on the edge strip, while a mouse
  button is held (resizing, dragging a tab), and while any web overlay (menu, dialog) is open, so
  a context menu opened from the peeked sidebar does not dismiss it. Otherwise it dismisses 300 ms
  after the pointer leaves.
- Electron browser guests are clipped one CSS pixel inside each pane edge. The guest keeps its full
  viewport dimensions, but that app-owned boundary lets the existing screen-edge trigger and
  between-pane splitter receive the first pointer event before the native guest can consume it.

## Known limits

- The right edge peeks only a workspace that already has an Explorer pane. A workspace that never
  opened the Explorer has nothing to show.
- Plain web and native do not peek: a browser tab has no maximized window edge to rest on, and the
  setting row is hidden outside Electron.

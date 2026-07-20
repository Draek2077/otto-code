# Resizable vertical tab rail

The vertical tabs rail should have a **grabbable splitter** on its edge so the
user can set its width.

Related: `packages/app/src/screens/workspace/workspace-desktop-tabs-rail.tsx`,
[docs/mobile-panels.md](../../docs/mobile-panels.md).

## Today

The rail's width is entirely **content-driven**: `computeWorkspaceTabRailWidth`
sizes every row to the widest current label, scaled by `RAIL_WIDTH_SCALE = 1.5`
and clamped to `[WORKSPACE_TABS_RAIL_MIN_WIDTH, RAIL_TAB_MAX_WIDTH]`. There is
no user input to it at all.

## Ask

- A drag handle on the rail's edge that sets its width.
- **Save a single width for all vertical tab rails**, not per-pane. Per-pane was
  considered and rejected as probably annoying — but it's worth a sanity check
  once it's usable, since split panes of very different widths may want
  different rails.

## Design notes

- The user width has to interact with the existing content-driven clamp: is it
  an override, or a new max that content can still shrink below? An override is
  simpler and more predictable — a splitter that sometimes doesn't move is
  worse than one that always does.
- Persist device-local in `AppSettings`
  (`packages/app/src/hooks/use-settings/storage.ts`), same as
  `defaultTabOrientation`.
- Note `RAIL_HEADER_FIXED_CHROME_WIDTH` — the rail header passes
  `toolsAvailableWidth = railWidth - RAIL_HEADER_FIXED_CHROME_WIDTH` down to the
  workspace tools, so a resizable rail changes which tools show labels. That
  interaction is now width-derived (fixed 2026-07-20) and should follow along
  correctly, but verify it.
- Drag on web only? Native has no pointer drag affordance here. Decide whether
  the setting is reachable some other way on native, or whether the rail is a
  desktop-only concern.

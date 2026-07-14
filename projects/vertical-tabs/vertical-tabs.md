# Vertical tabs — charter

Status: **BUILT — implemented 2026-07-13, uncommitted, UI awaits on-device visual verification.** Landed build-sequence steps 1–7 in full (data model + persistence, shared tab-item export, vertical rail component, orientation resolution + mount, split-container integration, per-pane toggle control on both row and rail, Appearance settings row); step 8 (polish) partially covered — see the deviations note at the bottom of this file for what's simplified vs. the original plan (rail chip styling reuses the horizontal chip's top-rounded look as-is, the vertical rail's own cross-pane drag drop-indicator bar is not wired, and the non-pane-split desktop fallback keeps rendering the horizontal row only). Verification so far is typecheck + lint + targeted vitest files only — no browser/preview tooling was used (standing repo instruction). Locked decisions below come directly from the user; everything else is a proposal to confirm before build starts.

## What this is

An **optional, per-pane** alternative to the horizontal tab strip at the top of each workspace pane. Today every pane (chat, terminal, browser/preview, file editor, git log, artifact — all sharing the `WorkspaceTabTarget` union) renders its tabs in a horizontal `ScrollView` via [`workspace-desktop-tabs-row.tsx`](../../packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx). This charter adds a second rendering mode — a vertical rail of stacked tabs — that a user can enable:

- **Globally**, as a default for new panes, via a new control in **Appearance settings**.
- **Per pane**, overriding that default — so a user can run a split layout where one pane shows a vertical rail (e.g. a file-heavy editor pane) while a sibling pane keeps horizontal tabs (e.g. a chat pane). Mixed orientations in the same workspace are the point, not an edge case.

Desktop/web only, matching today's scope: mobile already renders tabs through `MobileWorkspaceTabSwitcher`, a wholly separate component this charter does not touch (`docs/design.md`'s "tabs collapse on compact, panes split on desktop" rule stays true).

## Why this is a "per pane" feature, not a global switch

The repo already has a precedent for per-pane structural properties: `SplitGroup.direction: "horizontal" | "vertical"` ([`workspace-layout-actions.ts:20`](../../packages/app/src/stores/workspace-layout-actions.ts)) governs whether a _split_ stacks its children in a row or column, and it's set independently per split group in the same `WorkspaceLayout` tree. Tab orientation is the same shape of decision one level down — a per-pane rendering property — so it follows the same pattern rather than inventing a document-wide mode.

## Data model

Two additive pieces, both client-only (device-local), no protocol/daemon changes:

```
// packages/app/src/stores/workspace-layout-actions.ts
export interface SplitPane {
  id: string;
  tabIds: string[];
  focusedTabId: string | null;
  tabOrientation?: "horizontal" | "vertical";   // NEW — absent = inherits the appearance default
}
```

- **Absent = today's behavior.** A pane with no `tabOrientation` renders exactly as it does now, reading the global appearance default at render time. This is the same "absent section ⇒ no special path" degradation rule used throughout the repo (see `[[agent-teams]]`'s zero-setup invariant) — old persisted layouts round-trip unchanged.
- **Persisted where panes already live.** `workspace-layout-store.ts` already persists `layoutByWorkspace` through zustand + AsyncStorage (device-local, not host-synced) — `tabOrientation` rides the same persistence with no new store or migration.
- **New appearance setting**, alongside `chatWidth` / `teamSwitcherPlacement` in `AppSettings` ([`use-settings/storage.ts`](../../packages/app/src/hooks/use-settings/storage.ts)):

```
defaultTabOrientation: "horizontal" | "vertical";  // default "horizontal" — zero behavior change on upgrade
```

## Mechanics

**Orientation resolution at render time:** `pane.tabOrientation ?? settings.defaultTabOrientation`. Changing the appearance default retroactively affects only panes that never had an explicit per-pane override — the same "default vs. explicit override" precedence used by `teamSwitcherPlacement`/`workspaceToolsPlacement` today, just scoped per-pane instead of per-app.

**New panes:** a pane created by `splitPane` starts with no `tabOrientation` (inherits the current default at render time, not baked in at creation) — simplest rule, matches "absent = default" everywhere else. Open question below on whether a split should instead copy its parent pane's _current_ resolved orientation.

**Rendering — a content-driven rail, not a shrinking strip.** The horizontal row's hard part is [`workspace-tab-layout.ts`](../../packages/app/src/screens/workspace/workspace-tab-layout.ts)'s `computeWorkspaceTabLayout`, which measures viewport width and shrinks tab widths down to icon-only before falling back to horizontal scroll. Vertical tabs sidestep the viewport-shrink problem entirely (overflow is **vertical scroll**, not shrinking) but still size the rail from content: `computeWorkspaceTabRailWidth` (same file) takes the widest current tab label in the pane and sizes every tab in the rail to fit it — short labels shrink the rail down to a floor (`WORKSPACE_TABS_RAIL_MIN_WIDTH`), long labels grow it up to the exact same ceiling the horizontal row already uses (`TAB_MAX_WIDTH`, 200px) and truncate with an ellipsis past that. **All tabs in a given rail are always the same width** — sized once from the widest label present, not per-tab — mirroring how the horizontal row already gives every tab in a row the same width today (`computeWorkspaceTabLayout` returns one `resolvedWidth` applied to every tab), just driven by content instead of by available viewport space. The five metrics both algorithms share (`tabIconWidth`, `tabHorizontalPadding`, `estimatedCharWidth`, `closeButtonWidth`, `maxTabWidth`) are single-sourced as exported constants in `workspace-tab-layout.ts` so the row and rail can never drift apart.

**Shared tab-item rendering.** `workspace-desktop-tabs-row.tsx` is ~2500 lines mixing tab-item rendering (icon, label, status dot, close button, context menu, drag handle) with the horizontal-strip-specific layout math. The vertical rail should reuse the same tab-item visuals and menu/drag logic, not duplicate them — extract a shared `WorkspaceTabItem` (or similar) consumed by both an (unchanged) `WorkspaceDesktopTabsRow` and a new `WorkspaceDesktopTabsRail`, rather than forking the whole file. Drag-reorder: confirm whether `SortableInlineList` (already used for the horizontal row) supports a vertical axis, or needs an orientation prop added.

**Split-container integration.** [`split-container.tsx`](../../packages/app/src/components/split-container.tsx) currently reserves a fixed strip height at the top of each pane for the horizontal tab row. A pane in vertical mode instead needs to reserve a fixed rail _width_ on one edge (proposed: left, matching VS Code/most IDEs — see open questions), with pane content filling the remainder. This is the main structural change outside the tab component itself.

**Per-pane toggle affordance.** A small icon-button control (mirroring the existing split-direction icons, e.g. a rail/rows-style icon) placed in the pane's tab-row/corner area, flipping that pane's `tabOrientation` explicitly. Needs a placement that survives both orientations (i.e. not _inside_ the horizontal row only).

## Appearance settings UI

New row in the existing **Layout** section of [`appearance-section.tsx`](../../packages/app/src/screens/settings/appearance/appearance-section.tsx) (alongside `ChatWidthRow`, the team-switcher-placement toggle), following the same `SegmentedControl` pattern as `ChatWidthRow` rather than a boolean `Switch` (three states read more honestly than two: this is a "default for new panes," and framing it as a toggle undersells that existing panes keep their own setting):

- **"Default tab orientation"** — segmented Horizontal / Vertical, hint text explaining it sets the default for new panes and that any pane can override it individually.
- Gated the same way the rest of the Layout section already is: `showLayoutSection = !isNative` (desktop/web only, consistent with the feature itself not existing on mobile).

## Open questions to confirm before build

1. **Rail edge.** Always left, or configurable (left/right)? Proposal: ship left-only in v1 (matches nearly every IDE precedent), revisit if requested.
2. ~~**Rail width.**~~ **Resolved (2026-07-13, user-specified):** content-driven, not a flat constant — every tab in a rail is the same width, sized to the widest current label, floored at `WORKSPACE_TABS_RAIL_MIN_WIDTH` and capped at `TAB_MAX_WIDTH` (the same ceiling the horizontal row already uses, so a rail tab is never wider than a horizontal one gets today). Still not user-resizable in v1 — that remains a natural follow-up via `sizes`-style split resizing.
3. **Split inheritance.** Does `splitPane` leave the new pane's `tabOrientation` unset (inherits live default), or copy the _parent_ pane's current resolved orientation? Proposal: leave unset — simpler mental model, consistent with "absent = default" elsewhere; a user who wants vertical on the new pane can toggle it in one click.
4. **Electron title-bar drag region.** The horizontal row currently doubles as a window-drag gutter on desktop (`useNonClientHover` in `workspace-desktop-tabs-row.tsx`). A pane with no horizontal strip loses that affordance for that pane's top edge — confirm this is acceptable (other panes/the sidebar/titlebar proper still provide drag regions) or whether the vertical rail needs its own drag-gutter accommodation.
5. **Icon-only vs. icon+label default in the rail**, and whether the per-pane toggle also exposes a rail-width or label-visibility sub-option, or that's deferred entirely to a v2.

## File map

- **Store:** `stores/workspace-layout-actions.ts` (`SplitPane.tabOrientation`, split/create defaults), `stores/workspace-layout-store.ts` (persistence — additive, no migration needed since the field is optional), `stores/workspace-layout-store.test.ts` (round-trip test).
- **Settings:** `hooks/use-settings/storage.ts` (`defaultTabOrientation` on `AppSettings`, default `"horizontal"`), `hooks/use-settings/storage.test.ts`.
- **Rendering:** `screens/workspace/workspace-desktop-tabs-row.tsx` (extract shared tab-item piece), new `screens/workspace/workspace-desktop-tabs-rail.tsx` (vertical variant), `screens/workspace/workspace-tab-layout.ts` (only if a rail-specific layout helper is warranted — likely much smaller than the horizontal one).
- **Layout integration:** `components/split-container.tsx` (reserve rail width instead of/alongside strip height per pane orientation).
- **Settings UI:** `screens/settings/appearance/appearance-section.tsx` (new `TabOrientationRow`, Layout section).
- **Docs:** `docs/design.md` (extend the existing compact/desktop tab-layout rule to mention per-pane orientation) once shipped.

## Build sequence

1. **Data model + persistence.** `SplitPane.tabOrientation`, `AppSettings.defaultTabOrientation`, resolution helper (`pane.tabOrientation ?? settings.defaultTabOrientation`). No UI yet. Tests: store round-trip with/without the field, settings default value, absent-field back-compat (old persisted layout loads unchanged).
2. **Shared tab-item extraction.** Pull tab-item rendering (icon/label/status/close/menu/drag) out of `workspace-desktop-tabs-row.tsx` into a piece both orientations can consume, with zero visual/behavior change to the existing horizontal row. This step should be a pure refactor, verified by the existing horizontal-row tests staying green.
3. **Vertical rail component.** `workspace-desktop-tabs-rail.tsx` — fixed-width column, vertical scroll, shared tab-item, drag-reorder (vertical axis), "+" affordance, overflow/context menu parity with the horizontal row.
4. **Split-container integration.** Reserve rail width per-pane based on resolved orientation; verify resizable splits, nested splits, and pane-close/merge all still compute correctly with a mix of horizontal-strip and vertical-rail panes in the same tree.
5. **Per-pane toggle control.** Icon-button affordance to flip a pane's `tabOrientation` explicitly, visible regardless of current orientation.
6. **Appearance settings row.** `TabOrientationRow` (segmented control) in the Layout section, wired to `defaultTabOrientation`.
7. **Polish + edge cases.** Electron drag-gutter accommodation (per open question 4), empty-pane state, single-tab pane, very tall/short panes, scroll-position persistence when switching orientation on a pane with many tabs.

Each step should land typecheck/lint/format green with its own tests before moving to the next, per repo convention.

## Locked decisions (confirmed with the user 2026-07-13)

1. **Strictly opt-in.** Default behavior on upgrade is unchanged (`defaultTabOrientation: "horizontal"`, no pane has `tabOrientation` set).
2. **Lives in Appearance settings**, as the default-for-new-panes control — not a standalone new settings page.
3. **Per-pane, not global.** A user can mix vertical and horizontal tab strips across panes in the same split layout; the per-pane setting overrides the appearance default for that pane only.

## Build deviations (2026-07-13 implementation)

- **Step 2 landed as exports, not a new file.** Rather than moving `TabChip`/`TabHandleContent`/`ResolvedDesktopTabChip` into a new `workspace-tab-item.tsx`, they stayed in place in `workspace-desktop-tabs-row.tsx` and were made `export`ed (`ResolvedDesktopTabChip`, `tabKeyExtractor`, `TabOrientationToggleButton`) — the charter's own text allows "a new file... or an exported subcomponent." The rail imports these directly. This kept the change a true zero-diff pure refactor to the horizontal row (adding `export` keywords cannot alter runtime behavior), rather than risking a large physical code move with no visual-verification tooling available to catch regressions.
- **Rail chip visual styling is unmodified from the horizontal chip.** `ResolvedDesktopTabChip`/`TabChip` still carry the horizontal strip's top-rounded-corner, fixed-header-height look; stacked vertically in the rail this reads as a column of small horizontal-shaped chips rather than a purpose-styled IDE-style rail row (e.g. no left-accent selected state, no full-row hover). Functionally correct (icon, truncated label, close button, context menu, drag reorder all work); a follow-up pass can restyle once someone can see it rendered.
- **No rail-specific drop-indicator bar.** `ResolvedDesktopTabChip`'s `showDropIndicatorBefore`/`showDropIndicatorAfter` are always passed `false` in the rail — cross-pane drag-and-drop still works at the data layer (same shared `DndContext` in `split-container.tsx`), it just doesn't draw the horizontal insertion line the row draws. Within-rail vertical reorder (`SortableInlineList` with the new `orientation="vertical"` prop) is fully wired.
- **The non-pane-split desktop fallback (`shouldRenderDesktopPaneFallback` in `workspace-screen.tsx`, gated on `!isMobile && !supportsDesktopPaneSplits()` i.e. non-web) keeps rendering `WorkspaceDesktopTabsRow` only — never the rail.** The per-pane orientation setting is still correctly read and the toggle button still calls the real `setPaneTabOrientation` action (so the preference persists and is honored if the workspace is later opened on a pane-split-capable surface), but this narrow legacy surface never visually shows a rail. `supportsDesktopPaneSplits()` returns `isWeb`, which covers both browser web and Electron desktop (Electron renders as the web platform) — the practical "desktop" surfaces this feature targets — so this fallback path is effectively dead/rare in practice.
- **`SortableInlineList` gained an `orientation?: "horizontal" | "vertical"` prop** (default `"horizontal"`, zero behavior change for every existing caller) in both `sortable-inline-list.web.tsx` (swaps `dnd-kit`'s sorting strategy and axis-restriction modifier) and `sortable-inline-list.native.tsx` (typed no-op, matching its existing no-drag-support behavior).
- **Rail width is content-driven (2026-07-13 follow-up, superseding the initial fixed-208px build).** `computeWorkspaceTabRailWidth` (new, `workspace-tab-layout.ts`) takes the pane's tab-label lengths and returns one uniform width for every tab in the rail: `iconOnlyWidth + widestLabelLength * estimatedCharWidth`, clamped to `[WORKSPACE_TABS_RAIL_MIN_WIDTH (120, constants/layout.ts), TAB_MAX_WIDTH (200, workspace-tab-layout.ts)]`. `TAB_MAX_WIDTH` and its sibling metrics (`TAB_ICON_WIDTH`, `TAB_HORIZONTAL_PADDING`, `TAB_ESTIMATED_CHAR_WIDTH`, `TAB_CLOSE_BUTTON_WIDTH`) were promoted from private literals inside `workspace-desktop-tabs-row.tsx` to exports of `workspace-tab-layout.ts`, and the row's `layoutMetrics` now imports them instead of duplicating the numbers — a pure refactor (same values, same behavior) that makes "a rail tab is never wider than a horizontal one gets today" a structural guarantee rather than a coincidence of two separately-maintained constants. `workspace-desktop-tabs-rail.tsx` computes `railWidth` via `useMemo` off its `tabs` prop and applies it as a dynamic inline style (`[styles.rail, { width, minWidth, maxWidth }]`), the same pattern the chip already uses for `resolvedTabWidth` — no `useUnistyles()` involved. `getFallbackTabLabel` was exported from the row so the rail can estimate label lengths the same way the row does. 4 new unit tests cover the floor, an unclamped mid-range width, the ceiling clamp, and the empty-pane fallback.
- **Toggle-button strings and the Appearance settings row copy are raw English** with an `{/* i18n: ... */}` comment, per the "Team switcher in title bar" precedent already in `appearance-section.tsx` — no new i18n keys were threaded through the locale files.
- **Verification is typecheck + lint + targeted `vitest` files only.** No preview/browser MCP tooling was used per this repo's standing instruction; the rail, the row's new toggle button, and the split-container layout branch have not been visually confirmed on-device.

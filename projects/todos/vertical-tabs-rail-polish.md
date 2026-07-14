# TODO: Vertical tab rail — Step 8 polish

**From:** vertical-tabs, Step 8 (steps 1–7 shipped and committed under `4f2e18040`; the feature works
— this is the "simplified vs. original plan" polish the charter's deviations note lists). See the
[docs/design.md](../../docs/design.md) (per-pane tab orientation). **Size:** small, per item — pull them
individually.

## Current state (verified)

The vertical rail is live and functional:

- Data model: `SplitPane.tabOrientation` (`stores/workspace-layout-actions.ts`,
  `workspace-layout-store.ts`); setting `defaultTabOrientation` on `AppSettings`
  (`hooks/use-settings/storage.ts`); Appearance row `TabOrientationRow`
  (`screens/settings/appearance/appearance-section.tsx` ~L453–470).
- Rail component: `packages/app/src/screens/workspace/workspace-desktop-tabs-rail.tsx`; width via
  `computeWorkspaceTabRailWidth` (`workspace-tab-layout.ts`) + `WORKSPACE_TABS_RAIL_MIN_WIDTH`
  (`constants/layout.ts`); mounted through `components/split-container.tsx` /
  `screens/workspace/workspace-screen.tsx`.

## The remaining polish (each is an independent pull-off)

1. **Purpose-styled rail chip.** The rail currently reuses the horizontal chip's _top-rounded_ look
   as-is. Give the vertical rail its own IDE-style chip: left-accent selected state, full-row hover
   target, left-rounded (not top-rounded) corners. Lands in `workspace-desktop-tabs-rail.tsx` (+ the
   shared tab-item export it renders).
2. **Rail cross-pane drag drop-indicator.** The data-layer drag/drop already works (a tab can be
   dragged between panes), but the vertical rail does not draw the **insertion line** indicating where
   the drop will land. Add the drop-indicator bar to the rail, mirroring the horizontal row's
   indicator. Lands in `workspace-desktop-tabs-rail.tsx`.
3. **Non-split desktop fallback.** When the layout is a single pane (no split group), the desktop
   still renders the horizontal tab row only, ignoring a `vertical` `defaultTabOrientation`. Decide +
   implement: honor vertical orientation in the non-split case too (or document that vertical requires
   a split, if that's intended). Lands in the `split-container.tsx` / `workspace-screen.tsx` render
   selection.
4. **i18n extraction.** The rail + Appearance strings are raw English with `{/* i18n */}` markers.
   Extract them into `packages/app/src/i18n` (English first — see
   [docs/i18n.md](../../docs/i18n.md); locale parity is type-enforced).
5. **On-device visual verification.** Verification so far is typecheck + lint + targeted vitest only
   (standing repo instruction meant no browser/preview tooling was used). A human visual pass on a
   real device/desktop for both orientations + mixed-orientation splits is still owed.

## Compat / docs

No protocol surface. On ship, extend the compact/desktop tab-layout rule in
[docs/design.md](../../docs/design.md) to mention per-pane orientation (charter's noted doc follow-up).

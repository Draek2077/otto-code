---
id: "explorer-sidebar-convergence-on-upstream-s-pane-host-system"
kind: "project"
title: "Explorer sidebar convergence on upstream's pane-host system"
status: "proposed"
tags: ["explorer-sidebar","upstream-convergence","workspace-tabs","paseo-v0.6.1"]
delivery_status: "in_build"
progress_completed: 1
progress_total: 5
progress_unit: "stages"
created_at: "2026-08-31T22:20:25.244Z"
updated_at: "2026-08-31T22:20:25.244Z"
---
# Explorer sidebar convergence on upstream's pane-host system

<!-- compiled_truth -->

## Goal

Fully converge on upstream Paseo's Explorer sidebar system (v0.6.1's Explorer-as-pane-host design, `docs/explorer-sidebar.md`) and retire Otto's own docked Explorer sidebar. End state per Philippe: "fully in sync with the new sidebar system with these new tabs and not have any forks or old traces of Otto's. But it has all the same functionality so nothing changes really and it all still works."

Upstream's model: Files and Changes are Explorer-host-only singleton panels; the Explorer sidebar is a right-side dock that is itself a tab host (a special layout-store pane with the literal `"explorer"` pane id, extracted from the split canvas and docked with its own width and resize handle); other tabs (agents, terminals, files, diffs, PRs) move between Explorer and main panes; the side pane (`open-beside.ts`, Settings → Layout) is a separate complementary concept. Workspace labels are unrelated (app-sidebar workspace organization).

## Stages

1. **DONE (`c321a4a00`)** - Project search as a first-class panel: kind `project_search` (main + explorer hosts), registered panel wrapping `ProjectSearchPane`, New Tab launcher entry gated on Developer mode + `projectSearch` capability, i18n `panels.search.*` in all nine locales.

2. **Dock mounting in `split-container.tsx`** - port upstream's structure (their `20d7efc46` version, lines ~355-500 and ~700-740): new props `explorerSidebarPaneId`, `renderExplorerSidebarHeaderAction`, `onCreateNewTab({paneId})`; derive `explorerSidebarPane` via `findPaneById`, `mainRoot` via `removePaneFromSplitTree` (port the helper), width from `explorerSidebarWidthByWorkspace` + `resolveExplorerSidebarWidth`/`resolveExplorerSidebarDockSizes` (both already in `components/explorer-sidebar-layout.ts`), preview/commit resize handlers, shell `onLayout`; render row = main column, `ResizeHandle` (`workspace-explorer-sidebar-resize-handle`), `ExplorerSidebarDock` (`screens/workspace/explorer-sidebar.tsx`, currently orphaned and byte-identical to upstream) inside the existing DndContext so tab drag between dock and main panes works. Keep Otto's split-container divergences intact (vertical tabs rail, mounted-tab retention, window-controls padding).

3. **Workspace-screen handoff** - subscribe `explorerSidebarPaneId` from the layout store and pass it down; move the header into the split-container main column via upstream's `renderMainHeader` prop pattern so the dock divides the full workspace including the header (Otto's current geometry); replace Otto's `<ExplorerSidebar>` render in `threePaneRow` and `shouldShowWorkspaceExplorerSidebar` gating; rewire the header Explorer toggle and the `toggle-right-sidebar` keyboard action to `toggleExplorerSidebar`/`showExplorerSidebar` (`workspace-tabs/explorer-sidebar.ts` - already live for chat directory links); focus mode hides the dock (upstream gates on `focusModeEnabled`); seed/reveal the Files and Changes singletons per upstream (Cmd+E selects Changes for git checkouts, Files otherwise); User interface mode keeps a Files-only Explorer (gate Changes/PR/search out of the rail context menu and launcher in User mode, mirroring Otto's `isDeveloperMode` gating in the old sidebar). Mount `NewTabLauncherProvider` where the dock's launcher needs it (see ledger note from the provider audit).

4. **Retirement and parity** - delete Otto's `components/explorer-sidebar.tsx` (987 lines; justified deletion: superseded by an adopted upstream feature), `stores/explorer-tab-memory.ts` (`ExplorerTab = changes|files|search|pr`), Otto's sidebar-only helpers; align `compact-explorer-sidebar.tsx` back toward upstream's version (ours imports Otto's sidebar for content); PR view parity: the old sidebar's `pr` tab becomes the registered `pull_request` panel (verify content parity between the sidebar's `PrTabContent` and `panels/pull-request`); knowledge-file redirection parity: the old `handleOpenFileFromExplorer` redirected knowledge files to the Knowledge tab, the panel path (FilesPanel/ProjectSearchPanel `openPreferredTarget`) does not - decide where that redirect lives in the panel world; persisted-state migration: upstream's one-shot Explorer layout migration is already in the layout store (`legacyExplorerPaneId`), verify Otto's explorer-tab-memory users land sensibly.

5. **Verification and docs** - upstream's `explorer-sidebar.spec.ts` is in the tree and should pass once mounted; sync Otto e2e specs that assert the old `explorer-tab-*` testids; update the coverage matrix (docs/testing.md tiers), `docs/explorer-sidebar.md` stays authoritative; record the convergence in `docs/upstream-merges.md` (resolves the "Otto's app-side diff layer / tab-bar workspace pins - to revisit" entries' Explorer half); visual pass in the dev app before release.

## Constraints

- Upstream files are never deleted (standing decision in docs/upstream-merges.md); Otto files deleted here must be recorded as superseded-by-upstream-adoption.
- The dock stays on the right (upstream renders it after the main split; matches Otto's current placement).
- `files`/`changes_tree` remain Explorer-host-only singletons per upstream's manifest; main-pane "Changes" is the `working_diff` document panel.
- Coordinate with concurrent sessions before editing `workspace-screen.tsx` and `split-container.tsx`; both were rewritten during the 2026-08-31 provider-mount repairs.

## Acceptance

Otto desktop shows upstream's Explorer dock (tab rail, New Tab launcher, reorder, move-to-main, resize, Cmd+E) with Files, Changes, Search, and PR available as tabs; search and PR also openable in main panes; User mode shows Files only; no Otto sidebar code remains; typecheck, unit suites, and `explorer-sidebar.spec.ts` green; visual pass done.

## Timeline

- time: "2026-08-31T22:20:25.244Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["packages-app-src-components-split-container-tsx","packages-app-src-screens-workspace-workspace-screen-tsx","packages-app-src-components-explorer-sidebar-tsx","packages-app-src-screens-workspace-explorer-sidebar-tsx","packages-app-src-panels-project-search-panel-tsx"]
- time: "2026-08-31T22:20:25.244Z"
  kind: "evidence"
  summary: "Scoping audit 2026-08-31: upstream design read from docs/explorer-sidebar.md and commits c914bcb44 (#3826), 19a7d2634 (#3605), ab274d635 (#3287), c779ef06c (#3510 - labels are workspace organization, not tab placement). Current tree state: Otto's docked sidebar live in workspace-screen threePaneRow; upstream's ExplorerSidebarDock + tab rail orphaned but byte-identical; layout store, explorer-sidebar-layout helpers, panel manifest, launcher, and compact overlay all merged and live. Stage 1 landed as c321a4a00."

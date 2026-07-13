# Sidebar row reveal + tutorial create-workspace step

Client-only (`packages/app`). Two user-requested capabilities that share one primitive.

## Motivation

- The onboarding tutorial (`packages/app/src/tutorial/`) creates a _project_ at the
  "create-project" step, but a project has no workspace, so the later Explorer/Chat
  steps have nothing to point at. We need a **create-a-workspace** step that spotlights
  the just-created project's **"＋ New workspace" ghost row** and advances when the user
  lands in a real workspace.
- Separately, a broadly-useful feature the user asked for: **when the active workspace
  changes, reveal (scroll into view) its row in the sidebar**, expanding its
  project/status group if collapsed. Today the sidebar never auto-scrolls to the active
  workspace (confirmed: no scrollTo logic exists).

Both need the same primitive: **reveal a specific sidebar row in its scroll container**.

## Architecture facts (from exploration, with refs)

- Two group modes: `"project"` (default) and `"status"` — `stores/sidebar-view-store.ts`.
  Each mode has its **own** scroll container, only one mounted at a time:
  - project mode: `ProjectModeList` → `NestableScrollContainer`(native)/`ScrollView`(web),
    testID `sidebar-project-workspace-list-scroll` (`components/sidebar-workspace-list.tsx:2510`).
    Inner `DraggableList`s have `scrollEnabled={false}` — the ambient container owns scroll.
  - status mode: `SidebarStatusWorkspaceList` → own container, testID
    `sidebar-status-list-scroll` (`components/sidebar/sidebar-status-list.tsx:79`).
- Row identity: workspace `workspaceKey = ${serverId}:${workspaceId}`; project `projectKey`
  (bare id). testIDs `sidebar-workspace-row-${workspaceKey}`, `sidebar-project-row-${projectKey}`.
- Empty projects are ordinary `SidebarProjectEntry` with `workspaces:[]`
  (`projects/workspace-structure.ts`); their block renders `NewWorkspaceGhostRow`
  (`sidebar-workspace-list.tsx:900`) whose press → `buildNewWorkspaceRoute({projectId})`.
- Active workspace is **route-derived**: `useActiveWorkspaceSelection()` →
  `{serverId, workspaceId}` (`stores/navigation-active-workspace-store`). "Changed" = the
  hook's return changed; key via `activeWorkspaceSelectionKey`.
- New Workspace completion (both empty + chat-agent paths) funnels through
  `navigateToWorkspace` → `/h/{serverId}/workspace/{workspaceId}`.
- Collapse: `stores/sidebar-collapsed-sections-store` — `collapsedProjectKeys` /
  `collapsedStatusGroupKeys`; use `setProjectCollapsed(key,false)` (there's no "expand").
  A collapsed section **unmounts** its child rows, so reveal must expand → wait a frame →
  measure → scroll. Project header rows themselves are never unmounted.
- Native rows are virtualized (`react-native-draggable-flatlist` is a VirtualizedList);
  a far unmounted row can fail `measure`. Model retry on `file-explorer-pane.tsx:805-865`
  (`filesRevealRequest {path,token}` in `panel-store`).

## Plan

### Increment 1 — reveal primitive + general active-workspace reveal

- `components/sidebar/sidebar-row-anchors.ts`: module `Map<string, MeasurableNode>` +
  subscribe/register/get (mirror `tutorial/anchor-registry.ts`). Keys:
  `workspace:${serverId}:${workspaceId}` and `project:${projectKey}`.
- `stores/sidebar-reveal-store.ts` (zustand): `{ request: {key, token} | null;
requestReveal(key) }` — monotonic token so repeat reveals of the same key still fire.
- Attach the registry ref (via `mergeRefs`, no wrapper) to the existing row Pressables:
  project-mode `WorkspaceRow`, `ProjectHeaderRow`; status-mode workspace row.
- A `useSidebarRevealController(scrollRef)` used by each container: subscribe to the
  request; if the target's section is collapsed, expand it; next frame measure the row
  node vs the container (window coords + tracked onScroll offset) and `scrollTo` when the
  row is outside the viewport padding.
- `useRevealActiveWorkspace()` mounted in `LeftSidebar`: on `useActiveWorkspaceSelection()`
  change, `requestReveal(workspace:${serverId}:${workspaceId})`.

### Increment 2 — tutorial create-workspace step

- Widen tutorial anchors for a project block (either add a `"new-workspace"` fixed anchor
  registered on the first/only empty project's block, or a keyed variant). Register on the
  project block that contains the ghost "＋ New workspace" row.
- New step after `create-project`: enter → goHome + open sidebar + requestReveal(project) so
  it's on screen; spotlight the project block; advance when workspace count > 0 / on a
  `/workspace/` route. Reorder so Explorer/Chat follow a real workspace.

## Status

- Increment 1: **implemented** (uncommitted), static-clean (typecheck + lint). Files:
  - `components/sidebar/sidebar-row-anchors.ts` — keyed measurable-node registry.
  - `components/sidebar/use-sidebar-row-anchor.ts` — ref-callback hook.
  - `stores/sidebar-reveal-store.ts` — `{request:{key,token}}` + `requestSidebarReveal`.
  - `components/sidebar/use-sidebar-reveal-controller.ts` — per-container measure+scrollTo
    (measureInWindow + onScroll offset; **native NestableScrollContainer overrides onScroll
    so offset tracking is web/desktop only** — native reveal is best-effort for now).
  - `components/sidebar/use-reveal-active-workspace.ts` — producer, mounted in LeftSidebar.
  - Anchors merged onto project rows + workspace rows in both modes
    (`sidebar-workspace-list.tsx`, `sidebar/sidebar-status-list.tsx`).
  - **Deferred (Increment 1b):** auto-expand a collapsed project/status group before
    revealing (today reveal no-ops if the target row is in a collapsed section); native
    offset tracking; virtualized-row retry beyond the 30-frame budget.
  - Needs on-device/desktop verification: click between workspaces → active row scrolls
    into view; confirm no scroll when already visible.
- Increment 2 (tutorial create-workspace step): not started.

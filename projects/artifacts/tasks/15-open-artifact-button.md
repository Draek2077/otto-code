# Task: Add "Open Artifact" Button to Workspace Toolbar

## Goal

Add an "Open Artifact" button to the workspace toolbar (near New Browser / New Terminal) that shows a dropdown of artifacts for the current project, allowing the user to open any artifact as a workspace tab.

## Context

The workspace toolbar has buttons for opening new terminals, browsers, etc. We need to add an "Open Artifact" button that shows a dropdown of the current project's artifacts. Selecting one opens it as a tab using the workspace tabs store.

## References

- `packages/app/src/stores/workspace-tabs-store/index.ts` — `ensureTab` / `openOrFocusTab` to open tabs
- `packages/app/src/stores/workspace-tabs-store/state.ts` — `WorkspaceTabTarget` now includes `{ kind: "artifact"; artifactId: string }` (task 13)
- `packages/app/src/artifacts/use-artifacts.ts` — query hook from task 09
- `tasks/09b-query-hook.md` — `useArtifacts(projectId)` to filter by current project
- `packages/app/src/screens/artifacts-screen.tsx` — the artifacts screen for reference on how artifacts are used

## What to Create

**File:** `packages/app/src/components/artifacts/artifact-open-menu.tsx`

A dropdown/menu component that:

### Props

```typescript
interface ArtifactOpenMenuProps {
  projectId: string;
}
```

### Behavior

1. Fetch artifacts for `projectId` using `useArtifacts(projectId)`
2. Render a button (e.g., "Artifacts" or an icon) in the toolbar area
3. On press, show a dropdown list of artifact names
4. Each list item, when pressed, opens the artifact as a workspace tab via `useWorkspaceTabsStore().openOrFocusTab({ serverId, workspaceId, target: { kind: "artifact", artifactId } })`
5. Include a "Create Artifact" option at the top or bottom of the dropdown

### Integration

Find where the workspace toolbar/header buttons live (near the New Terminal / New Browser buttons) and add the `ArtifactOpenMenu` component there. Gate visibility behind the `artifacts` capability flag.

## Acceptance Criteria

- Button appears in the workspace toolbar
- Dropdown lists artifacts for the current project
- Selecting an artifact opens it as a workspace tab (kind: "artifact")
- "Create Artifact" option is present in the dropdown
- Hidden when the `artifacts` capability flag is not available
- Follows coding standards

# Task: Auto-Open Newly Created Artifacts as Tabs

## Goal

When a user creates an artifact from the "Open Artifact" dropdown or the artifacts screen, automatically open the new artifact as a workspace tab once generation completes.

## Context

The plan says: "Auto-open newly created artifacts as tabs on success." When the creation dialog submits, the artifact enters `status: "generating"`. Once the file watcher detects the HTML file and updates to `status: "ready"`, the artifact should open as a tab.

## References

- `packages/app/src/artifacts/use-artifact-mutations.ts` — `createArtifact` mutation from task 09
- `packages/app/src/stores/workspace-tabs-store/index.ts` — `openOrFocusTab`
- `packages/app/src/artifacts/use-artifacts.ts` — query hook that receives push notifications
- `tasks/14-artifact-panel-content.md` — artifact panel that renders HTML content

## What to Do

### In `use-artifact-mutations.ts`

After `createArtifact` succeeds (the daemon responds with the new `ArtifactMetadata` with `status: "generating"`):

1. Store the new `artifactId` in a ref or state
2. Listen for the next `artifact.daemon.updated.notification` where the artifact's status becomes `"ready"`
3. When ready, call `useWorkspaceTabsStore().openOrFocusTab({ serverId, workspaceId, target: { kind: "artifact", artifactId } })`
4. Clean up the listener

### Alternative: Poll-Based Approach

If push notification timing is unreliable, the creation mutation's `onSuccess` callback can:

1. Set a flag `autoOpenArtifactId`
2. A `useEffect` in the screen watches for this ID's status to change to `"ready"` via the query hook
3. Once ready, opens the tab and clears the flag

## Acceptance Criteria

- After creating an artifact, a tab opens automatically when generation completes
- No tab opens if generation fails (status becomes "error")
- The listener is cleaned up to prevent memory leaks
- Works whether the user created from the artifacts screen or the "Open Artifact" dropdown

# Task: Push Notification Cache Updates for Artifacts

## Goal

Listen for daemon-pushed artifact notifications (`created`, `updated`, `deleted`) and optimistically update the React Query cache — so the artifacts list stays current without a full refetch.

## Context

The query hook (09b-ii) fetches artifacts on mount and on demand. But the daemon also pushes real-time notifications when artifacts change. This task wires those notifications into the React Query cache using `queryClient.setQueryData`, matching the pattern used elsewhere in the app.

## References

- `packages/app/src/runtime/host-runtime.ts` — `useHosts`, WebSocket listen patterns for incoming messages
- `tasks/02-rpc-schemas.md` — notification shapes:
  - `artifact.daemon.created.notification` → `{ artifact: ArtifactMetadata }`
  - `artifact.daemon.updated.notification` → `{ artifact: ArtifactMetadata }`
  - `artifact.daemon.deleted.notification` → `{ artifactId: string }`
- `tasks/09b-ii-query-hook.md` — `artifactsQueryKey` exported for cache access
- `tasks/01-protocol-types.md` — `ArtifactMetadata` type
- `tasks/09a-artifact-derivation.md` — `sortArtifacts` to re-sort after cache mutation

## What to Create

**File:** `packages/app/src/artifacts/use-artifacts-notifications.ts`

A hook (or a function called from `use-artifacts.ts`) that:

- Uses `useEffect` (or the runtime's subscribe pattern) to listen for the three notification types
- On **created**: fetches the current cache data via `queryClient.getQueryData(artifactsQueryKey)`, prepends the new artifact, re-sorts with `sortArtifacts`, then writes back with `setQueryData`
- On **updated**: finds the artifact by `id` in the cached array, replaces it in-place, re-sorts, writes back
- On **deleted**: filters out the artifact by `id`, writes back
- If no cached data exists yet (cold start), skip the cache mutation — the query hook will fetch on its own

```typescript
export function useArtifactNotifications(): void {
  // Subscribes to WebSocket notifications and updates the React Query cache
}
```

This hook should be called from `use-artifacts.ts` (or merged into it) so consumers don't need to wire it up separately.

## Acceptance Criteria

- Notifications are received and processed without triggering a full refetch
- Cache is updated optimistically via `queryClient.setQueryData` (not by invalidating)
- After each cache mutation, artifacts are re-sorted via `sortArtifacts`
- If the cache is empty (not yet fetched), notifications are silently ignored
- Follows coding standards: stable references, cleanup on unmount, no effect cascades

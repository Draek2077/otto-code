# Task: Create Artifacts React Query Hook

## Goal

Create the `useArtifacts` query hook using React Query, wired to `fetchArtifacts` from task 09b-i. Delivers a working hook that fetches, caches, and refetches artifact lists — without push notification handling (that's 09b-iii).

## Context

Otto uses React Query for server state. The schedules hook (`use-schedules.ts`) is the closest pattern: `useQuery` with a fetch function, query keying on relevant params, and exposing `isInitialLoad`/`isError`/`refetch`.

## References

- `packages/app/src/hooks/use-schedules.ts` — comparable hook pattern (query key, `keepPreviousData`, `isInitialLoad`)
- `packages/app/src/runtime/host-runtime.ts` — `getHostRuntimeStore`, `useHosts`, `useSyncExternalStore` for runtime version
- `tasks/09b-i-fetch-function.md` — `fetchArtifacts` function this hook consumes
- `tasks/09a-artifact-derivation.md` — `sortArtifacts` / `filterByProject` utilities to apply to results
- `tasks/01-protocol-types.md` — `ArtifactMetadata` type

## What to Create

**File:** `packages/app/src/artifacts/use-artifacts.ts`

```typescript
export const artifactsQueryKey = ["artifacts"] as const;

export function artifactsQueryKeyWithProject(projectId?: string) {
  return [...artifactsQueryKey, projectId] as const;
}

export interface UseArtifactsResult {
  artifacts: ArtifactMetadata[];
  isInitialLoad: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  isRefetching: boolean;
}

export function useArtifacts(projectId?: string): UseArtifactsResult {
  // Returns sorted/filtered artifacts via useQuery + fetchArtifacts
}
```

Behavior:

- Uses `useQuery` with query key `artifactsQueryKeyWithProject(projectId)`
- Calls `fetchArtifacts({ projectId, runtime })` as the `queryFn`
- Applies derivation functions (`sortArtifacts`, optionally `filterByProject`) to the result
- Uses `keepPreviousData` (placeholder data) to avoid flashing empty state during refetch
- Subscribes to runtime version changes (via `useSyncExternalStore`) so the query re-runs when connectivity changes — matching the schedules pattern
- Exposes `isInitialLoad`, `isError`, `error`, `refetch`, `isRefetching`

## Acceptance Criteria

- `use-artifacts.ts` exists with a working `useArtifacts` hook
- Query key is exported as `artifactsQueryKey` (so downstream tasks like 09c can invalidate it)
- React Query is used — no manual `useState` + `useEffect`
- Results are sorted via `sortArtifacts` (from task 09a)
- Follows coding standards: stable references, no effect cascades, `function` declarations

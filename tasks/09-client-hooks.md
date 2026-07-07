# Task: Create Artifacts React Query Hook and Mutations

## Goal

Create the client-side data fetching hooks for artifacts: `useArtifacts` (query) and `useArtifactMutations` (create, delete, star) using React Query and WebSocket messaging.

## Context

Otto uses React Query for server state. The client sends WebSocket RPC requests and listens for responses and push notifications. The schedules feature is the closest comparable pattern.

## References

- `packages/app/src/hooks/use-schedules.ts` — comparable hook with React Query, WebSocket messaging, push notification handling
- `packages/app/src/runtime/host-runtime.ts` — host runtime store, WebSocket send/listen patterns
- `tasks/02-rpc-schemas.md` — RPC message names and shapes
- `tasks/01-protocol-types.md` — `ArtifactMetadata`, `CreateArtifactInput` types

## What to Create

### 1. Query Hook

**File:** `packages/app/src/artifacts/use-artifacts.ts`

```typescript
export function useArtifacts(projectId?: string) {
  // Returns: { artifacts: ArtifactMetadata[], isInitialLoad: boolean, isError: boolean, refetch: () => void }
}
```

Behavior:

- On mount, send `artifact.client.list.request` with optional `projectId` filter
- Listen for `artifact.client.list.response` to resolve the query
- Listen for push notifications:
  - `artifact.daemon.created.notification` → prepend to list
  - `artifact.daemon.updated.notification` → update item in list
  - `artifact.daemon.deleted.notification` → remove from list
- Use React Query (`useQuery`) with query key `["artifacts", projectId]`
- Cache artifacts in the query cache; invalidate on mutations

### 2. Mutations Hook

**File:** `packages/app/src/artifacts/use-artifact-mutations.ts`

```typescript
export function useArtifactMutations() {
  // Returns: { createArtifact, deleteArtifact, toggleStar }
}
```

Each mutation:

- Uses React Query `useMutation`
- Sends the corresponding WebSocket RPC request
- Waits for the response
- On success, invalidates the `["artifacts"]` query key so the list refreshes
- On error, returns the error to the caller

#### `createArtifact(input: CreateArtifactInput)`

- Sends `artifact.client.create.request`
- Returns `ArtifactMetadata` on success

#### `deleteArtifact(artifactId: string)`

- Sends `artifact.client.delete.request`
- Returns void on success

#### `toggleStar(artifactId: string, starred: boolean)`

- Sends `artifact.client.star.request`
- Returns `ArtifactMetadata` on success

### 3. Derivation Module

**File:** `packages/app/src/artifacts/artifact-derivation.ts`

Pure functions for filtering and sorting artifacts:

- `sortArtifacts(artifacts: ArtifactMetadata[]): ArtifactMetadata[]` — starred first, then by `updatedAt` descending
- `filterByProject(artifacts: ArtifactMetadata[], projectId?: string): ArtifactMetadata[]`

## Acceptance Criteria

- `use-artifacts.ts` exists with a working query hook
- `use-artifact-mutations.ts` exists with create, delete, and star mutations
- `artifact-derivation.ts` exists with sort and filter functions
- Push notifications update the query cache without full refetch
- React Query is used (not manual useState + useEffect)
- Follows coding standards: stable references, no effect cascades

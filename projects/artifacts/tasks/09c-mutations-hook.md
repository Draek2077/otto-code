# Task: Create Artifact Mutations Hook

## Goal

Create the client-side mutation hooks for artifacts: `useArtifactMutations` (create, delete, star) using React Query and WebSocket messaging.

## Context

Otto uses React Query for server state. Mutations send WebSocket RPC requests, wait for responses, and invalidate the query cache on success.

## References

- `packages/app/src/hooks/use-schedules.ts` — comparable mutation patterns
- `packages/app/src/runtime/host-runtime.ts` — host runtime store, WebSocket send/listen patterns
- `tasks/02-rpc-schemas.md` — RPC message names and shapes
- `tasks/01-protocol-types.md` — `ArtifactMetadata`, `CreateArtifactInput` types
- `tasks/09b-query-hook.md` — query hook whose cache this invalidates

## What to Create

### Mutations Hook

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

## Acceptance Criteria

- `use-artifact-mutations.ts` exists with create, delete, and star mutations
- Each mutation uses React Query `useMutation`
- Successful mutations invalidate the `["artifacts"]` query key
- Errors are returned to the caller
- Follows coding standards: stable references, no effect cascades

# Task: Create Artifact Fetch Function

## Goal

Create a pure async function `fetchArtifacts` that sends a WebSocket RPC request to list artifacts and returns the result. No React — just transport.

## Context

Following the schedules pattern: `fetchAggregatedSchedules` is a standalone async function that the query hook calls. Artifacts needs the same separation so the fetch logic is testable without React and reusable elsewhere.

## References

- `packages/app/src/schedules/aggregated-schedules.ts` — `fetchAggregatedSchedules` as the pattern to follow
- `packages/app/src/runtime/host-runtime.ts` — host runtime store, WebSocket send/listen patterns
- `tasks/02-rpc-schemas.md` — RPC message names: `artifact.client.list.request` / `artifact.client.list.response`
- `tasks/01-protocol-types.md` — `ArtifactMetadata` type
- `tasks/07-websocket-rpc-handlers.md` — server-side handler that responds to this request

## What to Create

**File:** `packages/app/src/artifacts/fetch-artifacts.ts`

```typescript
export async function fetchArtifacts({
  projectId,
  runtime,
}: {
  projectId?: string;
  runtime: HostRuntimeStore;
}): Promise<ArtifactMetadata[]> {
  // 1. Send artifact.client.list.request with optional projectId filter
  // 2. Await artifact.client.list.response
  // 3. Return artifacts array on success, throw on error
}
```

Behavior:

- Accepts `projectId?` (optional filter) and `runtime` (the host runtime store)
- Sends `artifact.client.list.request` via the runtime's WebSocket
- Awaits the correlated `artifact.client.list.response`
- Returns `ArtifactMetadata[]` on success
- Throws on failure (e.g., response with `success: false`, timeout, no host connected)

## Acceptance Criteria

- `fetch-artifacts.ts` exists with the `fetchArtifacts` function
- Function is pure async — no React hooks, no side effects beyond the WebSocket round-trip
- Sends the correct RPC request name and shape
- Correlates request/response via `requestId`
- Returns `ArtifactMetadata[]` or throws
- Follows coding standards: `function` declarations, no `any`, no `as` casts

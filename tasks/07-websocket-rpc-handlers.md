# Task: Register WebSocket RPC Handlers for Artifacts

## Goal

Wire up the artifact RPC handlers in the WebSocket server so the client can communicate artifact operations (list, create, delete, star, get-content) with the daemon.

## Context

The WebSocket server in `packages/server/src/server/websocket-server.ts` handles RPC messages. New RPCs are registered by matching message type strings and delegating to the artifact service.

## References

- `packages/server/src/server/websocket-server.ts` — find how existing RPCs (e.g., schedules, agents) are handled
- `packages/server/src/server/artifact/artifact-service.ts` — service from task 04
- `packages/server/src/server/artifact/artifact-store.ts` — store from task 03
- `packages/server/src/server/artifact/artifact-watcher.ts` — watcher from task 05
- `tasks/02-rpc-schemas.md` — RPC message names and shapes
- `docs/rpc-namespacing.md` — RPC naming conventions

## What to Do

In `websocket-server.ts` (or a new `artifact-rpc-handlers.ts` file that's imported by websocket-server.ts, following whichever pattern the codebase uses):

### Register Request Handlers

For each RPC, validate the incoming message against the schema, call the service, and send the response:

1. **`artifact.client.list.request`** → call `service.list(projectId)` → respond with `artifact.client.list.response`
2. **`artifact.client.create.request`** → call `service.create(input)` → respond with `artifact.client.create.response` → also start file watcher for the new artifact → emit `artifact.daemon.created.notification`
3. **`artifact.client.delete.request`** → call `service.delete(artifactId)` → stop watcher → respond with `artifact.client.delete.response` → emit `artifact.daemon.deleted.notification`
4. **`artifact.client.star.request`** → call `service.star(artifactId, starred)` → respond with `artifact.client.star.response` → emit `artifact.daemon.updated.notification`
5. **`artifact.client.get-content.request`** → call `service.getContent(artifactId)` → respond with `artifact.client.get-content.response`

### Initialization

On daemon bootstrap, scan existing artifacts and start watchers for any with `status: "generating"`.

### Error Handling

- Wrap each handler in error handling; on failure, respond with `success: false` and the error message
- Validate inputs before calling the service; reject invalid messages early

## Acceptance Criteria

- All 5 RPC request/response pairs are registered
- Push notifications are emitted for create, delete, and update events
- Errors are caught and returned as `success: false` responses
- Existing artifacts are scanned on daemon startup
- Follows coding standards: no `any`, typed errors, `function` declarations

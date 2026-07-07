# Task: Implement Artifact File Watcher (Live Updates)

## Goal

Create a file watcher in `packages/server/src/server/artifact/artifact-watcher.ts` that detects when artifact HTML files are written or modified, updates metadata, and emits WebSocket notifications.

## Context

When an agent generates an artifact, it writes an HTML file to disk. The watcher detects this write, updates the artifact metadata from `status: "generating"` to `status: "ready"`, and pushes a notification to all connected clients so the UI can update (spinner → preview).

## References

- `packages/server/src/server/websocket-server.ts` — how to send WebSocket notifications
- `packages/server/src/server/schedule/service.ts` — comparable service with file watching patterns
- `packages/server/src/server/artifact/artifact-store.ts` — store from task 03
- `tasks/02-rpc-schemas.md` — notification schema names

## What to Create

**File:** `packages/server/src/server/artifact/artifact-watcher.ts`

### Design

Use `fs.watch` (Node.js built-in) or a polling fallback:

```typescript
interface ArtifactWatcher {
  // Start watching a specific artifact file path
  // When the file appears or changes, update metadata and notify clients
  watch(artifactId: string, filePath: string): void;

  // Stop watching a specific artifact
  unwatch(artifactId: string): void;

  // Stop all watchers and clean up
  stop(): void;
}
```

### Behavior

1. When `watch()` is called for a generating artifact:
   - If the HTML file already exists (agent wrote it quickly), immediately update to "ready"
   - If not, set up an `fs.watch` on the parent `.otto/artifacts/` directory
   - Also start a polling timer (e.g., every 2 seconds) as a fallback, with a max timeout (e.g., 120 seconds)

2. On file change detection:
   - Read the HTML file to verify it has content (non-empty)
   - Update the artifact metadata: `status: "ready"`, `updatedAt: new Date().toISOString()`
   - Emit `artifact.daemon.updated.notification` via WebSocket to all connected clients

3. On timeout (file never appeared):
   - Update metadata: `status: "error"`, `errorMessage: "Generation timed out"`
   - Emit `artifact.daemon.updated.notification`

4. Store watcher handles by `artifactId` so `unwatch()` can clean up

### WebSocket Integration

The watcher needs access to the WebSocket server to send notifications. Accept the WebSocket server instance (or a send function) as a dependency.

## Acceptance Criteria

- File exists at `packages/server/src/server/artifact/artifact-watcher.ts`
- Watches for HTML file appearance and content changes
- Updates metadata status from "generating" to "ready" on successful write
- Updates to "error" with message on timeout
- Emits `artifact.daemon.updated.notification` via WebSocket
- Cleans up watchers on `unwatch()` and `stop()`
- Uses a polling fallback in addition to `fs.watch`
- Follows coding standards: no `any`, typed errors, resource cleanup

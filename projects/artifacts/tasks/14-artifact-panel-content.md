# Task: Build Artifact Panel Content (HTML Rendering)

## Goal

Implement the artifact panel component that renders HTML artifact content in a workspace tab.

## Context

The artifact panel was registered as a placeholder in task 13. Now replace it with a real component that fetches and renders the artifact's HTML content in a webview.

## References

- `packages/app/src/panels/browser-panel.tsx` — comparable panel that renders content in a webview
- `packages/app/src/panels/artifact-panel.tsx` — the placeholder from task 13
- `packages/app/src/components/browser-pane.tsx` — webview/browser rendering component
- `tasks/09b-query-hook.md` — WebSocket query hook for fetching artifacts
- `tasks/02-rpc-schemas.md` — `artifact.client.get-content.request/response` RPC

## What to Create

### 1. Artifact Content Hook

**File:** `packages/app/src/artifacts/use-artifact-content.ts`

A hook that fetches and subscribes to content for a given artifact:

```typescript
export function useArtifactContent(artifactId: string) {
  // Returns: { content: string | null, isLoading: boolean, error: string | null }
}
```

Behavior:

- On mount, send `artifact.client.get-content.request` for the artifact
- Listen for `artifact.client.get-content.response` to resolve
- Listen for `artifact.daemon.updated.notification` matching this `artifactId` — re-fetch content when notified
- Clean up listeners on unmount

### 2. Artifact Panel Component

**File:** `packages/app/src/panels/artifact-panel.tsx`

Replace the placeholder with a real component:

```typescript
import { useArtifactContent } from "@/artifacts/use-artifact-content";
import { WebView } from "react-native-webview"; // or the app's webview equivalent
// ... other imports

function ArtifactPanelContent() {
  const { artifactId } = usePaneContext(); // or however the target is accessed
  const { content, isLoading, error } = useArtifactContent(artifactId);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage text={error} />;
  if (!content) return <EmptyState />;

  return <WebView originWhitelist={['*']} source={{ html: content }} />;
}

// Update artifactPanelRegistration to use ArtifactPanelContent as component
```

### 3. Update Panel Descriptor

Update `useDescriptor` in the panel registration to show the actual artifact name (not just the ID). If artifact metadata is available from a store, use it; otherwise fall back to the ID.

## Acceptance Criteria

- `use-artifact-content.ts` fetches content via WebSocket RPC and subscribes to update notifications
- `artifact-panel.tsx` renders HTML content in a webview
- Loading, error, and empty states are handled
- Content re-fetches when `artifact.daemon.updated.notification` arrives
- Panel descriptor shows the artifact name in the tab header
- Follows coding standards: cleanup on unmount, no memory leaks

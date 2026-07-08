# Task: Register Artifact Panel Type in Tab Store and Panel Registry

## Goal

Add `{ kind: "artifact"; artifactId: string }` as a new workspace tab target kind, and register the artifact panel in the panel registry.

## Context

Otto workspace tabs are typed as a discriminated union `WorkspaceTabTarget` in `packages/app/src/stores/workspace-tabs-store/state.ts`. Each kind has a matching `PanelRegistration` registered in `register-panels.ts`. The browser panel (`browser-panel.tsx`) is the closest comparable pattern for a content-rendering panel.

## References

- `packages/app/src/stores/workspace-tabs-store/state.ts` — `WorkspaceTabTarget` union definition
- `packages/app/src/panels/panel-registry.ts` — `PanelRegistration` interface, `registerPanel()`
- `packages/app/src/panels/register-panels.ts` — where panels are registered at startup
- `packages/app/src/panels/browser-panel.tsx` — comparable panel (renders content in a webview)
- `docs/artifacts.md` — "Artifact Tab Type" section: no navigation controls, subscribes to file changes

## What to Do

### 1. Add `artifact` to `WorkspaceTabTarget`

In `packages/app/src/stores/workspace-tabs-store/state.ts`, add a new member to the `WorkspaceTabTarget` union:

```typescript
export type WorkspaceTabTarget =
  | { kind: "draft"; draftId: string; setup?: WorkspaceDraftTabSetup }
  | { kind: "agent"; agentId: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "browser"; browserId: string }
  | WorkspaceFileTabTarget
  | { kind: "setup"; workspaceId: string }
  | { kind: "artifact"; artifactId: string }; // NEW
```

### 2. Create Artifact Panel Registration

**File:** `packages/app/src/panels/artifact-panel.tsx`

Create a minimal panel registration:

```typescript
import { FileText } from "@/components/icons/material-icons";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";

export const artifactPanelRegistration: PanelRegistration<"artifact"> = {
  kind: "artifact",
  component: () => null, // placeholder — replaced in task 15
  useDescriptor(target, context) {
    return {
      label: "Artifact",
      subtitle: target.artifactId,
      titleState: "ready",
      icon: FileText,
      statusBucket: null,
    };
  },
  confirmClose() {
    return Promise.resolve(true);
  },
};
```

### 3. Register the Panel

In `packages/app/src/panels/register-panels.ts`, import and register:

```typescript
import { artifactPanelRegistration } from "@/panels/artifact-panel";
// ...
registerPanel(artifactPanelRegistration);
```

## Acceptance Criteria

- `WorkspaceTabTarget` includes `{ kind: "artifact"; artifactId: string }`
- `artifact-panel.tsx` exports a valid `PanelRegistration<"artifact">`
- Panel is registered in `register-panels.ts`
- The app compiles without TypeScript errors (the new kind flows through the generic `PanelRegistration<K>`)
- No breaking changes to existing tab kinds

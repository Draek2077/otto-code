# Task: Add Artifacts Route and Sidebar Entry

## Goal

Create the artifacts route in the app and add an "Artifacts" entry to the left sidebar navigation.

## Context

Otto uses Expo Router for navigation. Top-level routes live in `packages/app/src/app/`. The left sidebar is in `packages/app/src/components/left-sidebar.tsx`. The schedules feature (`/schedules`) is the closest comparable pattern.

## References

- `packages/app/src/app/schedules.tsx` — route file pattern (wraps screen in `HostRouteBootstrapBoundary`)
- `packages/app/src/app/sessions.tsx` — another comparable route
- `packages/app/src/app/_layout.tsx` — root navigation stack, registers `<Stack.Screen name="schedules" />`
- `packages/app/src/components/left-sidebar.tsx` — sidebar with "Sessions" and "Schedules" entries
- `packages/app/src/utils/host-routes.ts` — route builder functions like `buildSchedulesRoute()`
- `packages/app/src/screens/schedules-screen.tsx` — screen component pattern

## What to Create

### 1. Route File

**File:** `packages/app/src/app/artifacts.tsx`

```tsx
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { ArtifactsScreen } from "@/screens/artifacts-screen";

export default function ArtifactsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <ArtifactsScreen />
    </HostRouteBootstrapBoundary>
  );
}
```

### 2. Register Route in Stack

In `packages/app/src/app/_layout.tsx`, add `<Stack.Screen name="artifacts" />` alongside the existing `sessions` and `schedules` screens.

### 3. Route Builder Function

In `packages/app/src/utils/host-routes.ts`, add:

```typescript
export function buildArtifactsRoute() {
  return "/artifacts" as const;
}
```

### 4. Placeholder Screen

**File:** `packages/app/src/screens/artifacts-screen.tsx`

A minimal placeholder screen that renders "Artifacts" as a title. The full UI will be built in later tasks. This task only needs the navigation to work.

```tsx
import { Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { MenuHeader } from "@/components/headers/menu-header";
import { StyleSheet } from "react-native-unistyles";
import type { ReactElement } from "react";

export function ArtifactsScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) return <View style={styles.container} />;
  return (
    <View style={styles.container}>
      <MenuHeader title="Artifacts" />
      <Text>Artifacts content coming soon</Text>
    </View>
  );
}
```

### 5. Left Sidebar Entry

In `packages/app/src/components/left-sidebar.tsx`:

- Import an icon (e.g., `FileText` or similar from `@/components/icons/material-icons`)
- Add a sidebar navigation item labeled "Artifacts" that calls `router.push(buildArtifactsRoute())`
- Place it near the existing "Sessions" and "Schedules" entries
- Add the i18n key placeholder (e.g., `sidebar.sections.artifacts`) — actual translation can come later
- Gate visibility behind the `artifacts` capability flag using `useHostFeature` if available

## Acceptance Criteria

- Navigating to `/artifacts` shows the placeholder screen
- The left sidebar has an "Artifacts" entry that navigates correctly
- `buildArtifactsRoute()` returns `/artifacts`
- Route is registered in the stack navigator
- No breaking changes to existing routes or sidebar
- Follows coding standards

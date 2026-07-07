# Task: Build Artifact Card Component

## Goal

Create `ArtifactCard` — a single card component showing an artifact's preview information, star toggle, and `...` action menu.

## Context

The artifact card is the building block of the artifacts grid. Each card shows the artifact name, description, status (generating/ready/error), and actions.

## References

- `packages/app/src/components/schedules/schedules-table.tsx` — comparable list/card UI for schedules
- `packages/app/src/components/ui/` — shared UI components (Button, LoadingSpinner, etc.)
- `packages/app/src/screens/schedules-screen.tsx` — how cards integrate in a screen
- `docs/design.md` — theme tokens, colors, fonts
- `tasks/01-protocol-types.md` — `ArtifactMetadata` type with `status`, `starred`, etc.

## What to Create

**File:** `packages/app/src/components/artifacts/artifact-card.tsx`

### Props

```typescript
interface ArtifactCardProps {
  artifact: ArtifactMetadata;
  onOpen: (artifactId: string) => void;
  onStar: (artifactId: string, starred: boolean) => void;
  onDelete: (artifactId: string) => void;
}
```

### UI Elements

1. **Card container** — styled View with padding, border/background matching the app theme
2. **Header row** — artifact name (bold) + star button (filled/outlined based on `starred`) + `...` menu button
3. **Description** — truncated text showing the artifact description
4. **Status indicator**:
   - `generating` — show a `LoadingSpinner` (reuse from `@/components/ui/loading-spinner`)
   - `ready` — show a ready/checked indicator
   - `error` — show an error indicator and the `errorMessage`
5. **Footer row** — creation date (formatted) and "Open" button for ready artifacts

### `...` Menu Actions

- **Star/Unstar** — toggles `starred` status
- **Delete** — shows a confirmation alert, then calls `onDelete`

### Styling

- Use `react-native-unistyles` (`StyleSheet` from it) for styling
- Match the app's existing card/list styling patterns
- Use theme colors from unistyles

## Acceptance Criteria

- Component renders artifact name, description, status indicator
- Star button toggles visually between filled and outlined
- `...` menu shows Star/Unstar and Delete options
- Delete triggers a confirmation dialog before calling `onDelete`
- Loading spinner shows when status is "generating"
- Error state shows error message
- Follows coding standards: memo where appropriate, stable callbacks

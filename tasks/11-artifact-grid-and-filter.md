# Task: Build Artifacts Grid and Project Filter

## Goal

Create the artifact grid component and project filter dropdown that together form the main content of the artifacts screen.

## Context

The artifacts screen shows a grid of `ArtifactCard` components. A project filter dropdown lets users filter artifacts by project. Starred artifacts appear at the top.

## References

- `packages/app/src/components/artifacts/artifact-card.tsx` — card component from task 10
- `packages/app/src/screens/schedules-screen.tsx` — screen layout with filters and grid
- `packages/app/src/hooks/use-projects.ts` — project list hook
- `packages/app/src/artifacts/artifact-derivation.ts` — sort/filter functions from task 09
- `packages/app/src/artifacts/use-artifacts.ts` — query hook from task 09

## What to Create

### 1. Project Filter Dropdown

**File:** `packages/app/src/components/artifacts/artifact-project-filter.tsx`

A dropdown component that:

- Shows a list of project names (from `useProjects()`)
- Has an "All Projects" option (no filter)
- Calls a `onChange` callback with the selected `projectId` or `undefined`
- Matches the app's existing dropdown/picker styling

### 2. Artifact Grid

**File:** `packages/app/src/components/artifacts/artifact-grid.tsx`

A grid component that:

- Accepts `artifacts: ArtifactMetadata[]` and `onOpen`, `onStar`, `onDelete` callbacks
- Renders `ArtifactCard` for each artifact in a scrollable grid (2 columns on desktop, 1 on mobile)
- Uses the sort function from `artifact-derivation.ts` (starred first, then by updatedAt)
- Shows an empty state when no artifacts exist (message + "Create your first artifact" CTA)
- Shows a loading state during initial load

### 3. Update ArtifactsScreen

**File:** `packages/app/src/screens/artifacts-screen.tsx`

Replace the placeholder with the real screen:

- Use `useArtifacts(projectId)` hook
- Pass filtered artifacts to `ArtifactGrid`
- Wire up `useArtifactMutations()` for create, delete, star
- Include `ArtifactProjectFilter` at the top
- Include a "New Artifact" button (placeholder for now; creation dialog comes in task 12)
- Use `MenuHeader` for the screen header

## Acceptance Criteria

- `artifact-project-filter.tsx` renders a working project dropdown
- `artifact-grid.tsx` renders cards in a grid layout with empty and loading states
- `artifacts-screen.tsx` integrates all components with the hooks
- Starred artifacts sort to the top
- Project filter filters the grid correctly
- "New Artifact" button is present (can be a placeholder that logs for now)
- Follows coding standards

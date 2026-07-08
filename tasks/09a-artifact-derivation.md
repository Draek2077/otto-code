# Task: Artifact Derivation Functions

## Goal

Create pure utility functions for filtering and sorting artifacts.

## Context

These functions will be consumed by the query hook (task 09b) and by downstream UI components. They operate purely on `ArtifactMetadata` arrays and have no side effects.

## References

- `tasks/01-protocol-types.md` — `ArtifactMetadata` type

## What to Create

### Derivation Module

**File:** `packages/app/src/artifacts/artifact-derivation.ts`

Pure functions for filtering and sorting artifacts:

- `sortArtifacts(artifacts: ArtifactMetadata[]): ArtifactMetadata[]` — starred first, then by `updatedAt` descending
- `filterByProject(artifacts: ArtifactMetadata[], projectId?: string): ArtifactMetadata[]`

## Acceptance Criteria

- `artifact-derivation.ts` exists with sort and filter functions
- Functions are pure (no side effects, no external dependencies)
- `sortArtifacts` places starred artifacts first, then orders by `updatedAt` descending
- `filterByProject` returns all artifacts when `projectId` is undefined

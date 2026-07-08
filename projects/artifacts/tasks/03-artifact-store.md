# Task: Implement Artifact Store (Server-Side File Persistence)

## Goal

Create the file-based persistence layer for artifacts in `packages/server/src/server/artifact/artifact-store.ts`.

## Context

Otto uses file-based JSON persistence. See `docs/data-model.md` for patterns. Stores write atomically (write to temp file, then rename). Artifacts are stored per-project under `.otto/artifacts/` inside the project directory.

## References

- `packages/server/src/server/schedule/store.ts` — comparable file-based store (CRUD, atomic writes)
- `packages/server/src/server/atomic-file.ts` — atomic write utility
- `packages/server/src/server/otto-home.ts` — `$OTTO_HOME` resolution
- `tasks/01-protocol-types.md` — `ArtifactMetadata` type from `@otto-code/protocol/artifacts/types`

## Storage Design

Artifacts live per-project at: `{projectCwd}/.otto/artifacts/{artifactId}.json`

Each JSON file contains the full `ArtifactMetadata` (id, name, description, projectId, filePath, kind, starred, status, timestamps, generation info, errorMessage).

The companion HTML file lives at: `{projectCwd}/.otto/artifacts/{artifactId}.html`

## What to Create

**File:** `packages/server/src/server/artifact/artifact-store.ts`

Implement a class or module with these functions:

```typescript
interface ArtifactStore {
  // Read a single artifact by ID
  get(artifactId: string): ArtifactMetadata | null;

  // List all artifacts, optionally filtered by projectId
  list(options?: { projectId?: string }): ArtifactMetadata[];

  // Create a new artifact record (writes JSON file, creates .otto/artifacts/ dir if needed)
  create(metadata: ArtifactMetadata): void;

  // Update an existing artifact (partial updates via Partial<ArtifactMetadata>)
  update(artifactId: string, changes: Partial<ArtifactMetadata>): void;

  // Delete artifact metadata file and companion HTML file
  delete(artifactId: string): void;

  // Scan all known project directories and return all artifact metadata files
  scanAll(projectRoots: string[]): ArtifactMetadata[];
}
```

## Key Details

- Use `atomic-file.ts` utilities for writes (write temp + rename)
- Create `.otto/artifacts/` directory with `fs.mkdirSync(path, { recursive: true })` if it doesn't exist
- Validate JSON content against `ArtifactMetadataSchema` on read; skip files that fail validation
- `scanAll` iterates project roots, reads `.otto/artifacts/*.json` files, validates, and returns
- Throw typed errors on unexpected failures (don't swallow errors)

## Acceptance Criteria

- File exists at `packages/server/src/server/artifact/artifact-store.ts`
- All CRUD operations work with file-based JSON persistence
- Atomic writes for create/update
- Directory auto-creation on first write
- Validation on read with graceful skip of invalid files
- Follows coding standards: `function` declarations, no `any`, typed errors

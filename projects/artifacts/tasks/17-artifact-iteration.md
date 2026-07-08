# Task: Implement Artifact Iteration (Re-prompt to Modify)

## Goal

Allow users to re-prompt an existing artifact to modify it, spawning a new generation agent that updates the HTML file in-place.

## Context

The plan mentions: "Users can ask for modifications, and Claude updates the artifact in-place." This means the user can select an existing artifact, provide a modification prompt, and the system regenerates the HTML.

## References

- `packages/server/src/server/artifact/artifact-service.ts` — service from task 04
- `packages/server/src/server/artifact/artifact-prompt.ts` — system prompt from task 04
- `packages/app/src/artifacts/use-artifact-mutations.ts` — mutations from task 09
- `tasks/04-artifact-service.md` — generation flow with short-lived agent

## What to Do

### Server-Side: Add `regenerate()` to ArtifactService

In `packages/server/src/server/artifact/artifact-service.ts`:

```typescript
regenerate(artifactId: string, modificationPrompt: string, providerConfig: { ... }): ArtifactMetadata;
```

Behavior:

1. Look up the artifact by ID
2. Set status to `"generating"`, update metadata
3. Read the current HTML content
4. Spawn a short-lived agent with:
   - `systemPrompt`: `ARTIFACT_SYSTEM_PROMPT` + "Here is the current artifact. Modify it based on the user's request."
   - The agent's prompt: current HTML content + user's modification request
   - Instructions to write the updated HTML to the same file path
5. Start file watcher (reuse from task 05)

### Client-Side: Add `regenerateArtifact` Mutation

In `packages/app/src/artifacts/use-artifact-mutations.ts`:

```typescript
regenerateArtifact: (artifactId: string, prompt: string) => Promise<void>;
```

Sends `artifact.client.regenerate.request` (new RPC).

### Client-Side: Iteration UI

In `packages/app/src/components/artifacts/artifact-card.tsx`:

- In the `...` menu, add a "Modify" option for artifacts with `status: "ready"`
- Tapping "Modify" opens a small text input or bottom sheet for the modification prompt
- On submit, calls `regenerateArtifact()`

### New RPC

Add `artifact.client.regenerate.request/response` to the RPC schemas (extend task 02).

## Acceptance Criteria

- User can select "Modify" from an artifact card's `...` menu
- A text input appears for the modification prompt
- Submitting triggers regeneration via a new agent
- The artifact card shows a loading spinner during regeneration
- The artifact tab (if open) updates with new content when generation completes
- Follows coding standards

# Task: Implement Artifact Service (Generation Orchestration)

## Goal

Create the artifact service in `packages/server/src/server/artifact/artifact-service.ts` that orchestrates artifact CRUD and LLM-powered generation.

## Context

The artifact service sits between the store (persistence) and the WebSocket RPC handlers (network). It orchestrates creating artifacts by spawning a short-lived agent with an artifact-specific system prompt.

## References

- `packages/server/src/server/session.ts` — agent lifecycle, spawning agents
- `packages/server/src/server/schedule/service.ts` — comparable service layer
- `packages/server/src/server/artifact/artifact-store.ts` — the store from task 03
- `docs/artifacts.md` — "Artifact Generation Mechanism" section (dedicated agent run recommendation)
- `docs/artifacts.md` — "Proposed Artifact System Prompt" section
- `tasks/01-protocol-types.md` — types from `@otto-code/protocol/artifacts/types`

## What to Create

**File:** `packages/server/src/server/artifact/artifact-service.ts`

### Artifact System Prompt

**Also create:** `packages/server/src/server/artifact/artifact-prompt.ts`

A constant string exported as `ARTIFACT_SYSTEM_PROMPT` containing the system prompt from the plan:

```
You are an artifact generator for Otto, a development environment.

Your task is to create a single, self-contained HTML file based on the user's description.

RULES:
- Output ONLY valid HTML. No explanations, no markdown, no code fences.
- The HTML must be completely self-contained: all CSS inline or in <style> tags, all JS in <script> tags.
- Do not reference external resources (CDNs, images, fonts) unless absolutely necessary.
- Use modern, semantic HTML5.
- Make it visually polished and functional.
- If the user describes a complex application, create a working prototype with mock data.
- Handle edge cases gracefully (empty states, loading states, errors).

The user will describe what they want. Produce the complete HTML file.
```

### Artifact Service

The service should provide:

```typescript
interface ArtifactService {
  // List artifacts, optionally filtered by projectId
  list(projectId?: string): ArtifactMetadata[];

  // Delete an artifact (metadata + HTML file)
  delete(artifactId: string): void;

  // Toggle starred status
  star(artifactId: string, starred: boolean): ArtifactMetadata;

  // Get the HTML file content for an artifact
  getContent(artifactId: string): string;

  // Create and begin generating a new artifact
  // Returns the initial ArtifactMetadata with status "generating"
  create(input: CreateArtifactInput): ArtifactMetadata;
}
```

### Generation Flow

When `create()` is called:

1. Generate an artifact ID (8-char hex)
2. Determine the project's `.otto/artifacts/` directory
3. Create metadata with `status: "generating"`, write to store
4. Spawn a short-lived agent with:
   - `systemPrompt`: `ARTIFACT_SYSTEM_PROMPT`
   - `cwd`: the project directory
   - `title`: the artifact name
   - `internal: true` (so it doesn't clutter the sidebar)
   - The agent's prompt should include instructions to write the HTML to `{projectCwd}/.otto/artifacts/{artifactId}.html`
5. Return the metadata immediately (client shows loading spinner)

The file watcher (task 05) will detect when the HTML file is written and update status to "ready".

## Acceptance Criteria

- `artifact-service.ts` exists with the interface above
- `artifact-prompt.ts` exists with `ARTIFACT_SYSTEM_PROMPT`
- `create()` returns immediately with `status: "generating"`
- Agent is spawned with `internal: true`
- System prompt instructs the model to produce self-contained HTML
- Follows coding standards: no `any`, typed errors, `function` declarations

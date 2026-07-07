# Task: Implement Error States and Recovery

## Goal

Handle error states throughout the artifact lifecycle: failed generation, missing files, malformed HTML, and orphaned artifacts.

## Context

The plan says:

- Failed generation: show error on the card, allow retry or delete
- Missing file: show "File not found" state, allow delete (orphan cleanup)
- Malformed HTML: show raw content with a warning banner
- Orphan artifacts: gray out or hide when project no longer exists

## References

- `packages/app/src/components/artifacts/artifact-card.tsx` — card from task 10
- `packages/app/src/panels/artifact-panel.tsx` — panel content from task 14
- `packages/server/src/server/artifact/artifact-service.ts` — service from task 04
- `packages/server/src/server/artifact/artifact-store.ts` — store from task 03

## What to Do

### 1. Error State in Artifact Card

In `artifact-card.tsx`:

- When `status === "error"`, show an error banner with `errorMessage`
- Show two action buttons: "Retry" (triggers regeneration) and "Delete"
- Style the card with a subtle red border or background tint

### 2. Missing File Detection

In `artifact-service.ts`, add a `validate()` method:

- Check that the HTML file at `filePath` exists
- If missing, update metadata: `status: "error"`, `errorMessage: "Artifact file not found"`
- Call during `scanAll()` on daemon startup

### 3. Malformed HTML Handling

In the artifact panel (`artifact-panel.tsx`):

- If the HTML content is empty or fails basic validation (e.g., no `<html>` or `<head>` tag), show a warning banner: "This artifact contains invalid HTML. Showing raw content."
- Fall back to displaying the raw text in a scrollable `<ScrollView>` with monospace font

### 4. Orphan Artifact Handling

In `artifact-card.tsx`:

- If the artifact's `projectId` doesn't match any known project (check via `useProjects()`), render the card in a disabled/grayed-out state
- Show "Project not found" subtitle
- Only allow delete action

### 5. Retry Mechanism

Add a `retry` mutation in `use-artifact-mutations.ts`:

- Reuses the artifact's stored `generationProvider` and `generationModel`
- Sends a regeneration request with the original description as the prompt

## Acceptance Criteria

- Error status shows error message + Retry/Delete buttons on the card
- Missing files are detected and marked as error on daemon startup
- Malformed HTML shows a warning banner and falls back to raw text display
- Orphan artifacts (project not found) are grayed out with limited actions
- Retry reuses the original generation config
- Follows coding standards

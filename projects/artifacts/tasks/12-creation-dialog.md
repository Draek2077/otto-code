# Task: Build "New Artifact" Creation Dialog

## Goal

Create the artifact creation bottom sheet/dialog that lets users specify name, description, provider, model, and other generation options.

## Context

The creation dialog is similar to the chat message composer but focused on artifact creation. It reuses existing composer controls for provider, model, mode, and thinking options.

## References

- `packages/app/src/composer/agent-controls/` — composer controls to reuse (provider picker, model picker, mode picker, thinking options)
- `packages/app/src/components/schedules/schedule-form-sheet.tsx` — comparable form sheet pattern
- `packages/app/src/artifacts/use-artifact-mutations.ts` — `createArtifact` mutation from task 09
- `tasks/01-protocol-types.md` — `CreateArtifactInput` type

## What to Create

**File:** `packages/app/src/components/artifacts/artifact-create-sheet.tsx`

### Props

```typescript
interface ArtifactCreateSheetProps {
  visible: boolean;
  projectId: string;
  onClose: () => void;
}
```

### Form Fields

1. **Name** — text input, required, max ~100 chars
2. **Description** — multiline text input, required, the prompt sent to the LLM
3. **Provider** — reuse the provider picker from composer controls
4. **Model** — reuse the model picker (changes based on selected provider)
5. **Mode** — reuse the mode picker (optional)
6. **Thinking/Reasoning** — reuse the thinking option control (optional)

### Submit Behavior

- Validate name and description are non-empty
- Call `createArtifact()` with the form values + `projectId`
- On success: close the dialog, the grid will auto-refresh via React Query invalidation
- On error: show an error message in the dialog
- While generating: the artifact card shows a loading spinner (handled by the grid, not the dialog)

### UI Pattern

- Use a bottom sheet or modal dialog matching the app's existing patterns
- "Create" button in the footer, disabled while submitting
- Cancel button to dismiss

## Acceptance Criteria

- Dialog shows all form fields (name, description, provider, model, mode, thinking)
- Provider/model/mode/thinking controls are reused from composer
- Submit calls `createArtifact()` mutation
- Dialog closes on success
- Error message shown on failure
- Form validation prevents empty submissions
- Follows coding standards

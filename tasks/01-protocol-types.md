# Task: Define Artifact Protocol Types (Zod Schemas)

## Goal

Create the Zod schema definitions for the artifact data model in `packages/protocol/src/artifacts/types.ts`.

## Context

Otto uses file-based JSON persistence validated with Zod. All TypeScript types are `z.infer<typeof schema>`, never hand-written. See `docs/data-model.md` for patterns.

## Reference

- `packages/protocol/src/schedule/types.ts` — comparable schema module (discriminated unions, stored vs summary shapes)
- `docs/artifacts.md` — full artifacts plan, especially the metadata schema section

## What to Create

**File:** `packages/protocol/src/artifacts/types.ts`

Define these Zod schemas:

1. **`ArtifactKindSchema`** — `z.enum(["html"])` (start with HTML only per the plan)
2. **`ArtifactStatusSchema`** — `z.enum(["generating", "ready", "error"])`
3. **`ArtifactMetadataSchema`** (full stored shape) with fields:
   - `id: string` — unique identifier (e.g., 8-char hex)
   - `name: string` — human-readable name
   - `description: string` — what the artifact is
   - `projectId: string` — which project owns it
   - `filePath: string` — path to the `.html` file on disk
   - `kind: ArtifactKind` — content type
   - `starred: boolean` — favorite toggle
   - `status: ArtifactStatus` — generating | ready | error
   - `createdAt: string` — ISO 8601
   - `updatedAt: string` — ISO 8601
   - `generationAgentId: string | null` — agent that generated it
   - `generationProvider: string | null` — provider used
   - `generationModel: string | null` — model used
   - `errorMessage: string | null` — error details if status is "error"
4. **`ArtifactSummarySchema`** — `ArtifactMetadataSchema` (same shape; no runs-like field to omit yet)
5. **`CreateArtifactInput`** (plain interface, not Zod) — input shape for creation:
   - `name: string`
   - `description: string`
   - `projectId: string`
   - `provider: string`
   - `model?: string`
   - `modeId?: string`
   - `thinkingOptionId?: string`
   - `systemPrompt?: string`

## Acceptance Criteria

- File exists at `packages/protocol/src/artifacts/types.ts`
- All schemas compile without TypeScript errors
- Types are exported via `z.infer`
- No `any`, no `as` casts
- Follows coding standards: `function` declarations, `interface` over `type` where applicable

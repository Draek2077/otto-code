import { z } from "zod";

export const ArtifactKindSchema = z.enum(["html"]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactStatusSchema = z.enum(["generating", "ready", "error"]);
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

export const ArtifactMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  projectId: z.string(),
  filePath: z.string(),
  kind: ArtifactKindSchema,
  starred: z.boolean(),
  status: ArtifactStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  generationAgentId: z.string().nullable(),
  generationProvider: z.string().nullable(),
  generationModel: z.string().nullable(),
  // Requested generation mode/effort, persisted so regeneration re-runs with
  // the same settings. Optional: records written before these fields existed
  // omit them (no migrations). The mode is a *request* — the artifact service
  // only honors unattended modes and otherwise resolves the provider's
  // unattended default, so generation never stalls on an approval prompt.
  generationModeId: z.string().nullable().optional(),
  generationThinkingOptionId: z.string().nullable().optional(),
  errorMessage: z.string().nullable(),
});
export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

export const ArtifactSummarySchema = ArtifactMetadataSchema;
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

// What kicked off a generation attempt: the first-ever generation (create) or a
// re-run of an existing artifact (regenerate).
export const ArtifactRunTriggerSchema = z.enum(["create", "regenerate"]);
export type ArtifactRunTrigger = z.infer<typeof ArtifactRunTriggerSchema>;

export const ArtifactRunStatusSchema = z.enum(["running", "succeeded", "failed"]);
export type ArtifactRunStatus = z.infer<typeof ArtifactRunStatusSchema>;

// One generation attempt. Mirrors ScheduleRun: a persisted log entry per run so
// inspect_artifact can show what happened across attempts (which provider/model,
// whether it succeeded, and the failure/cancel/timeout message when it didn't),
// rather than only the artifact's current status.
export const ArtifactRunSchema = z.object({
  id: z.string(),
  trigger: ArtifactRunTriggerSchema,
  status: ArtifactRunStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  agentId: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  error: z.string().nullable(),
});
export type ArtifactRun = z.infer<typeof ArtifactRunSchema>;

// The full on-disk record: the lean metadata plus its generation run history.
// `runs` defaults to [] so records written before run history existed parse
// unchanged (no migrations — same approach the rest of the store takes).
// list_artifacts / broadcasts keep sending ArtifactMetadata (runs stripped);
// only inspect_artifact returns this fuller shape.
export const StoredArtifactSchema = ArtifactMetadataSchema.extend({
  runs: z.array(ArtifactRunSchema).default([]),
});
export type StoredArtifact = z.infer<typeof StoredArtifactSchema>;

// Cap on retained run history per artifact. Keeps the on-disk JSON bounded while
// still showing a useful recent window in inspect_artifact.
export const MAX_ARTIFACT_RUNS = 20;

export interface CreateArtifactInput {
  name: string;
  description: string;
  projectId: string;
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  systemPrompt?: string;
}

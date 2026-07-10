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

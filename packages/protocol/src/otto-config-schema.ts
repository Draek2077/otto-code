import { z } from "zod";

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const OttoLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const OttoScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const OttoWorktreeConfigRawSchema = z
  .object({
    setup: OttoLifecycleCommandRawSchema.optional(),
    teardown: OttoLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
  })
  .passthrough();

export const OttoMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const OttoMetadataGenerationSchema = z
  .object({
    title: OttoMetadataGenerationEntrySchema.optional(),
    branchName: OttoMetadataGenerationEntrySchema.optional(),
    commitMessage: OttoMetadataGenerationEntrySchema.optional(),
    pullRequest: OttoMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy otto.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const OttoConfigRawSchema = z
  .object({
    worktree: OttoWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), OttoScriptEntryRawSchema).optional(),
    metadataGeneration: OttoMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = OttoWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = OttoScriptEntryRawSchema.catch({});

export const OttoConfigSchema = OttoConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: OttoMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const OttoConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: OttoConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type OttoScriptEntryRaw = z.infer<typeof OttoScriptEntryRawSchema>;
export type OttoMetadataGenerationEntry = z.infer<typeof OttoMetadataGenerationEntrySchema>;
export type OttoMetadataGeneration = z.infer<typeof OttoMetadataGenerationSchema>;
export type OttoConfigRaw = z.infer<typeof OttoConfigRawSchema>;
export type OttoConfig = z.infer<typeof OttoConfigSchema>;
export type OttoConfigRevision = z.infer<typeof OttoConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;

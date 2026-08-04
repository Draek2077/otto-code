import { z } from "zod";
import { GitHostingProviderIdSchema } from "./git-hosting.js";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

// Declared ahead of OttoWorktreeConfigRawSchema because that schema references
// it: a zod schema is a value, so a later `const` would be in its temporal dead
// zone at module-evaluation time.
export const OttoServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export type OttoServicePortAllocation = z.infer<typeof OttoServicePortAllocationSchema>;

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
    servicePorts: OttoServicePortAllocationSchema.optional(),
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

// Which git hosting provider this project's PR/issue features use. Committed
// with the repo (team-shared); credentials never live here - they belong to
// the daemon's private config, keyed by project.
export const OttoGitHostingConfigRawSchema = z
  .object({
    provider: z.unknown().optional(),
  })
  .passthrough();

export const OttoGitHostingConfigSchema = z
  .object({
    provider: GitHostingProviderIdSchema.optional().catch(undefined),
  })
  .passthrough()
  .catch({});

export const OttoConfigRawSchema = z
  .object({
    worktree: OttoWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), OttoScriptEntryRawSchema).optional(),
    metadataGeneration: OttoMetadataGenerationSchema.optional(),
    gitHosting: OttoGitHostingConfigRawSchema.optional(),
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
  gitHosting: OttoGitHostingConfigSchema.optional(),
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
export type OttoGitHostingConfig = z.infer<typeof OttoGitHostingConfigSchema>;
export type OttoConfigRaw = z.infer<typeof OttoConfigRawSchema>;
export type OttoConfig = z.infer<typeof OttoConfigSchema>;
export type OttoConfigRevision = z.infer<typeof OttoConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;

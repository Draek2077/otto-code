import { z } from "zod";
import { AgentProviderSchema } from "../provider-manifest.js";

export const ScheduleStatusSchema = z.enum(["active", "paused", "completed"]);
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;

export const ScheduleCadenceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("every"),
    everyMs: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z.string().trim().min(1),
    timezone: z.string().trim().min(1).optional(),
  }),
]);
export type ScheduleCadence = z.infer<typeof ScheduleCadenceSchema>;

export const ScheduleTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent"),
    agentId: z.guid(),
  }),
  z.object({
    type: z.literal("new-agent"),
    config: z.object({
      provider: AgentProviderSchema,
      cwd: z.string().trim().min(1),
      // Optional Agent Profile binding, stored as the stable id. Each run
      // re-resolves it against the run cwd and hard-fails if it is unavailable,
      // so runs pick up profile edits between runs.
      //
      // COMPAT(agentProfileFields): added in v0.8.13, remove after 2027-02-22.
      // `personality` is the pre-rename spelling and is both read and written
      // for the compat window: schedules live on disk, so a daemon that predates
      // the rename must still find the binding after a downgrade.
      personality: z.string().trim().min(1).optional(),
      agentProfile: z.string().trim().min(1).optional(),
      modeId: z.string().trim().min(1).optional(),
      model: z.string().trim().min(1).optional(),
      thinkingOptionId: z.string().trim().min(1).optional(),
      archiveOnFinish: z.boolean().optional(),
      isolation: z.enum(["local", "worktree"]).optional(),
      title: z.string().trim().min(1).nullable().optional(),
      providerOptions: z.record(z.string(), z.json()).optional(),
      // COMPAT(flatProviderConfigFields): schedules persisted before v0.4.0 carry
      // these flat provider fields instead of providerOptions, and Zod strips
      // unknown keys - without them a stored schedule silently loses its
      // approval/sandbox/network settings on the next rewrite. Re-added
      // 2026-08-22; drop together with the AgentSessionConfigSchema copies when
      // the client floor >= 0.8.13 (target 2027-02-22).
      approvalPolicy: z.string().trim().min(1).optional(),
      sandboxMode: z.string().trim().min(1).optional(),
      networkAccess: z.boolean().optional(),
      webSearch: z.boolean().optional(),
      extra: z
        .object({
          codex: z.record(z.string(), z.unknown()).optional(),
          claude: z.record(z.string(), z.unknown()).optional(),
        })
        .partial()
        .optional(),
      featureValues: z.record(z.string(), z.unknown()).optional(),
      systemPrompt: z.string().optional(),
      mcpServers: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  // A schedule names a durable saved Workflow definition, never a Workflow run
  // and never a reconstructed prompt. `projectRoot` is the authority boundary:
  // the daemon resolves the selected project's Workflow store immediately
  // before launch and refuses a definition from any other project or host.
  z.object({
    type: z.literal("workflow"),
    definitionId: z.string().trim().min(1),
    projectRoot: z.string().trim().min(1),
  }),
]);
export type ScheduleTarget = z.infer<typeof ScheduleTargetSchema>;

export const ScheduleRunSchema = z.object({
  id: z.string(),
  scheduledFor: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  // The exact schedule target requested when this run was claimed. Keeping the
  // snapshot on the run means later edits do not rewrite history, and gives
  // future Workflow/artifact target adapters one compatibility-safe audit slot.
  // Optional because persisted runs before v0.9 do not carry it.
  target: ScheduleTargetSchema.optional(),
  // Immutable result of resolving a saved Workflow target at fire time. The
  // definition can change later; this record is the audit of what actually
  // launched. Optional keeps historical agent schedule runs readable.
  workflow: z
    .object({
      definitionId: z.string().min(1),
      title: z.string().min(1),
      kind: z.string().min(1),
      projectRoot: z.string().min(1),
      fingerprint: z.string().min(1),
      runId: z.string().min(1),
    })
    .optional(),
  agentId: z.guid().nullable(),
  workspaceId: z.string().nullable().optional(),
  // Who actually executed this run - the resolved personality (if any),
  // provider, and model. Stamped when the run starts (so a failed run still
  // records its executor). Optional for back-compat: runs written before these
  // fields existed omit them.
  personalityName: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  output: z.string().nullable(),
  error: z.string().nullable(),
});
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;

export const StoredScheduleSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  prompt: z.string().min(1),
  cadence: ScheduleCadenceSchema,
  target: ScheduleTargetSchema,
  status: ScheduleStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.enum(["succeeded", "failed"]).nullable().optional(),
  lastRunError: z.string().nullable().optional(),
  // Executor of the most recent run - mirrors the run-level fields above so the
  // schedule card can show "who ran it last" (personality · provider · model)
  // without loading the full run history (ScheduleSummary omits `runs`).
  // Optional for back-compat: schedules that never ran, or predate these
  // fields, omit them.
  lastRunPersonalityName: z.string().nullable().optional(),
  lastRunProvider: z.string().nullable().optional(),
  lastRunModel: z.string().nullable().optional(),
  pausedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  maxRuns: z.number().int().positive().nullable(),
  runs: z.array(ScheduleRunSchema),
});
export type StoredSchedule = z.infer<typeof StoredScheduleSchema>;

export const ScheduleSummarySchema = StoredScheduleSchema.omit({
  runs: true,
});
export type ScheduleSummary = z.infer<typeof ScheduleSummarySchema>;

export interface CreateScheduleInput {
  name?: string | null;
  prompt: string;
  cadence: ScheduleCadence;
  target: ScheduleTarget;
  maxRuns?: number | null;
  expiresAt?: string | null;
  runOnCreate?: boolean | null;
}

export interface UpdateScheduleNewAgentConfig {
  provider?: string;
  /** COMPAT(agentProfileFields): pre-rename spelling of `agentProfile`. */
  personality?: string | null;
  agentProfile?: string | null;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  archiveOnFinish?: boolean;
  isolation?: "local" | "worktree";
  cwd?: string;
}

export interface UpdateScheduleInput {
  id: string;
  name?: string | null;
  prompt?: string;
  cadence?: ScheduleCadence;
  newAgentConfig?: UpdateScheduleNewAgentConfig;
  maxRuns?: number | null;
  expiresAt?: string | null;
}

export interface ScheduleExecutionResult {
  agentId: string | null;
  output: string | null;
  workflow?: {
    definitionId: string;
    title: string;
    kind: string;
    projectRoot: string;
    fingerprint: string;
    runId: string;
  };
}

/** Otto Schedule contracts. The original Paseo target/wire union stays unchanged. */
import { z } from "zod";
import {
  ScheduleCadenceSchema,
  ScheduleRunSchema,
  ScheduleTargetSchema,
  StoredScheduleSchema,
} from "@getpaseo/protocol/schedule/types";
import { ArtifactRef, ArtifactSelection } from "../artifacts.js";
import { WorkflowRef, WorkflowSeats, WorkflowLimits } from "../workflows/runtime.js";

export const ScheduleDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const ScheduleId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const ScheduleLocation = z.enum(["repository", "host", "legacy"]);
export const ScheduleScope = z.object({
  hostId: z.string().min(1).max(512),
  // Unassigned legacy schedules are host-owned; a new project record requires a project.
  projectId: z.string().min(1).max(512).nullable(),
});
export type ScheduleScope = z.infer<typeof ScheduleScope>;
export const ScheduleRef = z.object({
  scope: ScheduleScope,
  id: ScheduleId,
  location: ScheduleLocation,
  storeKey: z.string().min(1).max(1500),
});
export type ScheduleRef = z.infer<typeof ScheduleRef>;
export const ScheduleTransferMarker = z.object({
  operationId: ScheduleId,
  operation: z.enum(["copy", "move"]),
  role: z.enum(["source", "destination"]),
  phase: z.enum(["pending", "committed"]),
  peer: ScheduleRef,
});
export const ScheduleHistoryState = z.object({
  root: ScheduleDigest,
  count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  height: z.number().int().min(0).max(8),
  lastRunId: z.string().optional(),
});
export type ScheduleHistoryState = z.infer<typeof ScheduleHistoryState>;
export const ScheduledWorkflow = z.object({
  type: z.literal("workflow"),
  source: WorkflowRef.extend({ kind: z.enum(["ai", "graph"]) }),
  workspaceId: z.string().min(1).max(512),
  seats: WorkflowSeats,
  limits: WorkflowLimits,
  inputs: z.record(z.string().max(128), z.string().max(16000)),
  approval: z.object({
    policyFingerprint: ScheduleDigest,
    allowTemplateCode: z.boolean(),
    allowQueryEffects: z.boolean(),
  }),
});
export const ScheduledArtifactUpdate = z.object({
  type: z.literal("artifact-update"),
  source: ArtifactRef,
  designFingerprint: ScheduleDigest,
  update: z.discriminatedUnion("type", [
    z.object({ type: z.literal("data"), json: z.string().min(1).max(100000) }),
    z.object({
      type: z.literal("instruction"),
      instruction: z.string().min(1).max(12000),
      selection: ArtifactSelection,
    }),
  ]),
});
export const OttoScheduleTarget = z.discriminatedUnion("type", [
  ...ScheduleTargetSchema.options,
  ScheduledWorkflow,
  ScheduledArtifactUpdate,
]);
export type OttoScheduleTarget = z.infer<typeof OttoScheduleTarget>;
export const ScheduleResultLink = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), agentId: z.string(), workspaceId: z.string().optional() }),
  z.object({ kind: z.literal("workflow"), ref: WorkflowRef }),
  z.object({ kind: z.literal("artifact"), ref: ArtifactRef, revision: ScheduleDigest }),
]);
export const ScheduleRunAudit = z
  .object({
    requestedTarget: OttoScheduleTarget,
    resolved: z
      .object({
        kind: z.enum(["agent", "new-agent", "workflow", "artifact"]),
        id: z.string().max(512),
        title: z.string().max(512),
        revision: z.string().max(512).optional(),
        workflowKind: z.enum(["ai", "graph"]).optional(),
      })
      .optional(),
    executor: z.string().max(512).optional(),
    disposition: z.string().max(128).optional(),
    failureCode: z.string().max(128).optional(),
    result: ScheduleResultLink.optional(),
  })
  .passthrough();
export const OttoScheduleRun = ScheduleRunSchema.extend({
  otto: ScheduleRunAudit.optional(),
}).passthrough();
export type OttoScheduleRun = z.infer<typeof OttoScheduleRun>;
const KnownStoredSchedule = StoredScheduleSchema.extend({
  target: OttoScheduleTarget,
  runs: z.array(OttoScheduleRun),
  otto: z
    .object({
      version: z.literal(1),
      scope: ScheduleScope,
      location: ScheduleLocation,
      storeKey: z.string().min(1).max(1500),
      creation: z.object({ operationId: ScheduleId, fingerprint: ScheduleDigest }).optional(),
      transfer: ScheduleTransferMarker.optional(),
      history: ScheduleHistoryState.optional(),
      repairReason: z.string().max(2000).optional(),
      lastRepairReview: z
        .object({ at: z.string(), runId: z.string().nullable(), reason: z.string().max(2000) })
        .optional(),
    })
    .passthrough()
    .optional(),
});
// Keep unknown persisted fields at runtime without an index signature erasing Omit<Record, "id">.
export const OttoStoredSchedule = KnownStoredSchedule.passthrough();
export type OttoStoredSchedule = z.infer<typeof KnownStoredSchedule>;
export const ScheduleEntry = z.object({
  ref: ScheduleRef,
  revision: ScheduleDigest,
  schedule: OttoStoredSchedule,
});
export type ScheduleEntry = z.infer<typeof ScheduleEntry>;
export const ScheduleDraft = z.object({
  name: z.string().max(200).nullable(),
  prompt: z.string().min(1).max(32000),
  cadence: ScheduleCadenceSchema,
  target: OttoScheduleTarget,
  maxRuns: z.number().int().positive().nullable(),
  expiresAt: z.string().nullable(),
  runOnCreate: z.boolean(),
});
export type ScheduleDraft = z.infer<typeof ScheduleDraft>;
export const ScheduleDiagnostic = z.object({
  ref: ScheduleRef.nullable(),
  code: z.string().max(128),
  message: z.string().max(2000),
});

/** A legacy transport may never leak a target an older peer cannot parse. */
export function isPaseoSchedule(schedule: OttoStoredSchedule): schedule is OttoStoredSchedule & {
  target: z.infer<typeof ScheduleTargetSchema>;
} {
  return schedule.target.type === "agent" || schedule.target.type === "new-agent";
}

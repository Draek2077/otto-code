import { z } from "zod";
import { defineRpc } from "../../rpc.js";
import { ScheduleCadenceSchema, ScheduleTargetSchema } from "@getpaseo/protocol/schedule/types";
import { ArtifactRef } from "../artifacts.js";
import { WorkflowRef } from "../workflows/runtime.js";
import {
  ScheduleTransferInput,
  ScheduleTransferInspection,
  ScheduleTransferLookup,
  ScheduleTransferReconciliation,
  ScheduleTransferLockRecovery,
} from "./transfers.js";
import {
  OttoStoredSchedule,
  OttoScheduleTarget,
  OttoScheduleRun,
  ScheduleRef,
  ScheduleScope,
  ScheduleDigest,
  ScheduleId,
  ScheduleDraft,
  ScheduleDiagnostic,
  ScheduleTransferMarker,
  ScheduledWorkflow,
  ScheduledArtifactUpdate,
} from "./model.js";

export const ScheduleProjectScope = ScheduleScope.extend({ projectId: z.string().min(1).max(512) });
const location = z.enum(["repository", "host"]);
const origin = OttoStoredSchedule.shape.otto.unwrap().strip();
const head = OttoStoredSchedule.omit({ runs: true }).extend({ otto: origin.optional() }).strip();
export const ScheduleDocument = z.object({
  ref: ScheduleRef,
  revision: ScheduleDigest,
  schedule: head,
});
export type ScheduleDocument = z.infer<typeof ScheduleDocument>;
export const ScheduleTargetSummary = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent"), agentId: z.string() }),
  z.object({
    type: z.literal("new-agent"),
    provider: z.string(),
    cwd: z.string(),
    title: z.string().nullable(),
  }),
  z.object({
    type: z.literal("workflow"),
    source: WorkflowRef,
    workflowKind: z.enum(["ai", "graph"]),
  }),
  z.object({
    type: z.literal("artifact-update"),
    source: ArtifactRef,
    updateKind: z.enum(["data", "instruction"]),
  }),
]);
export type ScheduleTargetSummary = z.infer<typeof ScheduleTargetSummary>;
const runAudit = OttoScheduleRun.shape.otto.unwrap().omit({ requestedTarget: true }).strip();
export const SchedulePublicRun = OttoScheduleRun.extend({
  otto: OttoScheduleRun.shape.otto.unwrap().strip().optional(),
}).strip();
export const ScheduleRunSummary = OttoScheduleRun.omit({ otto: true })
  .extend({
    requestedTarget: ScheduleTargetSummary.nullable(),
    otto: runAudit.optional(),
    output: z.string().max(2000).nullable(),
    error: z.string().max(2000).nullable(),
    outputTruncated: z.boolean(),
    errorTruncated: z.boolean(),
  })
  .strip();
export type ScheduleRunSummary = z.infer<typeof ScheduleRunSummary>;
export const ScheduleListItem = z.object({
  ref: ScheduleRef,
  revision: ScheduleDigest,
  name: z.string().nullable(),
  promptPreview: z.string().max(200),
  target: ScheduleTargetSummary,
  cadence: ScheduleCadenceSchema,
  status: z.enum(["active", "paused", "completed"]),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  maxRuns: z.number().int().positive().nullable(),
  expiresAt: z.string().nullable(),
  runCount: z.number().int().nonnegative(),
  lastRun: ScheduleRunSummary.nullable(),
  repairReason: z.string().nullable(),
  transfer: ScheduleTransferMarker.nullable(),
});
export type ScheduleListItem = z.infer<typeof ScheduleListItem>;
export const ScheduleFailure = z.object({
  code: z.enum(["invalid", "conflict", "busy", "unavailable", "unsupported"]),
  message: z.string().max(2000),
});
export function scheduleResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: ScheduleFailure }),
  ]);
}
function rpc<I extends z.ZodType, O extends z.ZodType>(name: string, input: I, output: O) {
  return defineRpc({ name, input, output: scheduleResult(output) });
}
export const listSchedules = rpc(
  "schedules.library.list.request",
  z.object({
    scope: ScheduleScope,
    query: z.string().max(200).optional(),
    status: z.enum(["active", "paused", "completed"]).optional(),
    offset: z.number().int().nonnegative().optional(),
    refresh: z.boolean().optional(),
    includeLegacy: z.boolean().optional(),
    diagnosticOffset: z.number().int().nonnegative().optional(),
  }),
  z.object({
    items: z.array(ScheduleListItem).max(50),
    total: z.number().int().nonnegative(),
    diagnostics: z.array(ScheduleDiagnostic).max(50),
    diagnosticTotal: z.number().int().nonnegative(),
    version: z.number().int().nonnegative(),
  }),
);
export const watchSchedules = rpc(
  "schedules.library.watch.request",
  z.object({ scope: ScheduleScope, version: z.number().int().nonnegative() }),
  z.object({ version: z.number().int().nonnegative() }),
);
export const readSchedule = rpc("schedules.document.read.request", ScheduleRef, ScheduleDocument);
/** Read-only recovery for a lost create acknowledgement. Never resends the create. */
export const readCreatedSchedule = rpc(
  "schedules.document.created.read.request",
  z.object({ scope: ScheduleProjectScope, operationId: ScheduleId }),
  ScheduleDocument.nullable(),
);
export const previewScheduleCadence = rpc(
  "schedules.cadence.preview.request",
  z.object({
    scope: ScheduleScope,
    cadence: ScheduleCadenceSchema,
    from: z.iso.datetime().optional(),
  }),
  z.object({
    from: z.iso.datetime(),
    next: z.array(z.iso.datetime()).length(3),
    timezone: z.string(),
  }),
);
export const readScheduleHistory = rpc(
  "schedules.history.list.request",
  z.object({
    ref: ScheduleRef,
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.object({
    runs: z.array(ScheduleRunSummary).max(50),
    total: z.number().int().nonnegative(),
    revision: ScheduleDigest,
  }),
);
export const readScheduleRun = rpc(
  "schedules.history.read.request",
  z.object({ ref: ScheduleRef, runId: z.string().min(1).max(512) }),
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("inline"), run: SchedulePublicRun, revision: ScheduleDigest }),
    z.object({
      kind: z.literal("stored"),
      summary: ScheduleRunSummary,
      content: z.object({
        revision: ScheduleDigest,
        bytes: z.number().int().positive(),
        parts: z.number().int().positive().max(4096),
      }),
      revision: ScheduleDigest,
    }),
  ]),
);
export const readScheduleRunPart = rpc(
  "schedules.history.part.read.request",
  z.object({
    ref: ScheduleRef,
    runId: z.string().min(1).max(512),
    contentRevision: ScheduleDigest,
    part: z.number().int().min(0).max(4095),
  }),
  z.object({
    data: z.string().max(360000),
    revision: ScheduleDigest,
    part: z.number().int().nonnegative(),
    parts: z.number().int().positive().max(4096),
  }),
);
export const createSchedule = rpc(
  "schedules.document.create.request",
  z.object({
    scope: ScheduleProjectScope,
    draft: ScheduleDraft,
    location: location.optional(),
    operationId: ScheduleId,
  }),
  ScheduleDocument,
);
export const updateSchedule = rpc(
  "schedules.document.update.request",
  z.object({
    ref: ScheduleRef,
    expectedRevision: ScheduleDigest,
    draft: ScheduleDraft.omit({ runOnCreate: true }),
  }),
  ScheduleDocument,
);
const mutation = z.object({ ref: ScheduleRef, expectedRevision: ScheduleDigest });
export const controlSchedule = rpc(
  "schedules.run.control.request",
  mutation.extend({
    command: z.discriminatedUnion("type", [
      z.object({ type: z.literal("pause") }),
      z.object({ type: z.literal("resume"), userConfirmedInspection: z.boolean().optional() }),
      z.object({ type: z.literal("run-once"), userConfirmedInspection: z.boolean().optional() }),
      z.object({ type: z.literal("delete") }),
      z.object({ type: z.literal("cancel"), runId: z.string().min(1).max(512) }),
    ]),
  }),
  z.object({
    entry: ScheduleDocument.optional(),
    deleted: z.boolean().optional(),
    acceptedRunId: z.string().optional(),
  }),
);
export const ScheduleTargetCandidate = z.discriminatedUnion("type", [
  ...ScheduleTargetSchema.options,
  ScheduledWorkflow.extend({
    approval: ScheduledWorkflow.shape.approval.omit({ policyFingerprint: true }),
  }),
  ScheduledArtifactUpdate.omit({ designFingerprint: true }),
]);
export type ScheduleTargetCandidate = z.infer<typeof ScheduleTargetCandidate>;
export const reviewScheduleTarget = rpc(
  "schedules.target.review.request",
  z.object({
    scope: ScheduleProjectScope,
    target: ScheduleTargetCandidate,
  }),
  z.object({
    target: OttoScheduleTarget,
    summary: z.string().max(2000),
    autopilot: z.boolean().nullable(),
  }),
);
const storage = z.object({
  scope: ScheduleProjectScope,
  hostLabel: z.string(),
  projectLabel: z.string(),
  location,
  override: location.nullable(),
  revision: ScheduleDigest,
  hostDefault: location,
});
export const readScheduleStorage = rpc(
  "schedules.storage.read.request",
  ScheduleProjectScope,
  storage,
);
export const saveScheduleStorage = rpc(
  "schedules.storage.save.request",
  z.object({
    scope: ScheduleProjectScope,
    expectedRevision: ScheduleDigest,
    location: location.nullable(),
  }),
  storage,
);
const defaults = z.object({ location, revision: ScheduleDigest });
export const readScheduleDefaults = rpc(
  "schedules.defaults.read.request",
  z.object({ hostId: z.string().min(1).max(512) }),
  defaults,
);
export const saveScheduleDefaults = rpc(
  "schedules.defaults.save.request",
  z.object({
    hostId: z.string().min(1).max(512),
    expectedRevision: ScheduleDigest,
    location,
  }),
  defaults,
);
/** Structural discovery only; no saved prompts, schemas from user files, or run output. */
export const transferSchedule = rpc(
  "schedules.storage.transfer.request",
  ScheduleTransferInput,
  ScheduleTransferInspection,
);
export const readScheduleTransfer = rpc(
  "schedules.storage.transfer.inspect.request",
  z.object({ scope: ScheduleProjectScope, operationId: ScheduleId }),
  ScheduleTransferLookup,
);
export const reconcileScheduleTransfer = rpc(
  "schedules.storage.transfer.reconcile.request",
  ScheduleTransferReconciliation,
  ScheduleTransferInspection,
);
export const recoverScheduleTransferLock = rpc(
  "schedules.storage.transfer.lock.recover.request",
  ScheduleTransferLockRecovery,
  ScheduleTransferLookup,
);

export const scheduleOperations = [
  listSchedules,
  watchSchedules,
  readSchedule,
  readCreatedSchedule,
  previewScheduleCadence,
  readScheduleHistory,
  readScheduleRun,
  readScheduleRunPart,
  createSchedule,
  updateSchedule,
  controlSchedule,
  reviewScheduleTarget,
  readScheduleStorage,
  saveScheduleStorage,
  readScheduleDefaults,
  saveScheduleDefaults,
  transferSchedule,
  readScheduleTransfer,
  reconcileScheduleTransfer,
  recoverScheduleTransferLock,
] as const;

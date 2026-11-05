import { z } from "zod";
import { defineRpc } from "../../rpc.js";
import {
  OrchestrationGraphSchema,
  PromptTemplateSchema,
  RunPlanSchema,
  RunSchema,
  normalizeWorkflow,
  RunPhaseSchema,
} from "./model.js";
import { JudgeVerdictSchema } from "./judge-verdict.js";

export const WorkflowFailure = z.object({
  code: z.enum(["invalid", "conflict", "busy", "unavailable", "unsupported"]),
  message: z.string(),
});
export function workflowResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: WorkflowFailure }),
  ]);
}
export function workflowRpc<I extends z.ZodType, O extends z.ZodType>(definition: {
  name: string;
  input: I;
  output: O;
}) {
  return defineRpc({ ...definition, output: workflowResult(definition.output) });
}
export class WorkflowOperationError extends Error {
  constructor(
    readonly code: z.infer<typeof WorkflowFailure>["code"],
    message: string,
  ) {
    super(message);
    this.name = "WorkflowOperationError";
  }
}
export function unwrapWorkflowResult<T>(
  result: { ok: true; value: T } | { ok: false; error: z.infer<typeof WorkflowFailure> },
): T {
  if (!result.ok) throw new WorkflowOperationError(result.error.code, result.error.message);
  return result.value;
}

/** Presentation contracts contain host identities, never client-supplied filesystem paths. */
export const WorkflowId = z
  .string()
  .regex(
    /^(?!(?:\.|\.\.)$)(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[A-Za-z0-9_.-]{1,128}$/i,
  );
export const WorkflowLocation = z.enum(["repository", "host", "legacy"]);
export const WorkflowKind = z.enum(["graph", "ai", "template", "run"]);
export const WorkflowScope = z.object({
  hostId: z.string().min(1).max(512),
  projectId: z.string().min(1).max(512),
});
export const WorkflowRef = z.object({
  scope: WorkflowScope,
  kind: WorkflowKind,
  id: WorkflowId,
  location: WorkflowLocation,
  storeKey: z.string().max(1500).optional(),
});
export type WorkflowScope = z.infer<typeof WorkflowScope>;
export type WorkflowRef = z.infer<typeof WorkflowRef>;
export type WorkflowLocation = z.infer<typeof WorkflowLocation>;
export type WorkflowKind = z.infer<typeof WorkflowKind>;
export function workflowRefKey(ref: WorkflowRef): string {
  return JSON.stringify([
    ref.scope.hostId,
    ref.scope.projectId,
    ref.kind,
    ref.id,
    ref.location,
    ref.storeKey ?? null,
  ]);
}

/** A captured seat is explicit configuration, not a resurrected profile/team registry. */
export const WorkflowSeat = z.object({
  provider: z.string().min(1).max(256),
  model: z.string().min(1).max(512).optional(),
  modeId: z.string().max(256).optional(),
  thinkingOptionId: z.string().max(256).optional(),
});
export type WorkflowSeat = z.infer<typeof WorkflowSeat>;
export const WorkflowSeats = z.object({
  conductor: WorkflowSeat,
  worker: WorkflowSeat,
  judge: WorkflowSeat,
});
export type WorkflowSeats = z.infer<typeof WorkflowSeats>;
export const WorkflowLimits = z.object({
  maxAgents: z.number().int().min(1).max(40),
  maxConcurrency: z.number().int().min(1).max(6),
  maxLoopAttempts: z.number().int().min(1).max(5),
  timeoutMinutes: z.number().int().min(1).max(240),
});
export type WorkflowLimits = z.infer<typeof WorkflowLimits>;
export const DEFAULT_WORKFLOW_LIMITS: WorkflowLimits = {
  maxAgents: 20,
  maxConcurrency: 3,
  maxLoopAttempts: 3,
  timeoutMinutes: 60,
};
export const AiWorkflowDefinition = z
  .object({
    format: z.literal("otto.workflow.ai"),
    formatVersion: z.literal(1),
    id: WorkflowId,
    title: z.string().min(1).max(240),
    description: z.string().max(12000).optional(),
    prompt: z.string().min(1).max(32000),
    seats: WorkflowSeats,
    limits: WorkflowLimits,
    autopilot: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
export type AiWorkflowDefinition = z.infer<typeof AiWorkflowDefinition>;
export const WorkflowTemplateSnapshot = z.object({
  ref: WorkflowRef,
  revision: z.string(),
  template: PromptTemplateSchema,
});
export type WorkflowTemplateSnapshot = z.infer<typeof WorkflowTemplateSnapshot>;
export const WorkflowLaunch = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ai"),
    definition: AiWorkflowDefinition,
    seats: WorkflowSeats.optional(),
    limits: WorkflowLimits.optional(),
    source: z.object({ ref: WorkflowRef, revision: z.string() }).optional(),
  }),
  z.object({
    kind: z.literal("graph"),
    graph: OrchestrationGraphSchema,
    inputs: z.record(z.string(), z.string().max(16000)),
    seats: WorkflowSeats,
    limits: WorkflowLimits,
    allowTemplateCode: z.boolean().optional(),
    allowQueryEffects: z.boolean().optional(),
    templateSnapshots: z.array(WorkflowTemplateSnapshot).max(64).optional(),
    source: z.object({ ref: WorkflowRef, revision: z.string() }).optional(),
  }),
]);
export type WorkflowLaunch = z.infer<typeof WorkflowLaunch>;
export const WorkflowRunRecord = RunSchema.extend({
  awaitingStartConfirmation: z.boolean().optional(),
  declaredPlan: RunPlanSchema.optional(),
  launchFingerprint: z.string().optional(),
  completionDeliveryError: z.string().optional(),
  launch: WorkflowLaunch.optional(),
  ownerInstance: z.string().optional(),
  projectId: z.string().optional(),
  operationId: WorkflowId.optional(),
  workerAgentIds: z.array(z.string()).optional(),
  storageError: z.string().optional(),
}).passthrough();
const normalizedWorkflowRunRecord = WorkflowRunRecord.extend({
  phases: z.array(RunPhaseSchema),
  graphSnapshot: OrchestrationGraphSchema.optional(),
});
export type WorkflowRunRecord = z.infer<typeof normalizedWorkflowRunRecord>;
export function normalizeWorkflowRunRecord(
  value: z.infer<typeof WorkflowRunRecord>,
): WorkflowRunRecord {
  const normalized = normalizeWorkflow(value);
  return {
    ...value,
    ...normalized,
    graphSnapshot: value.graphSnapshot
      ? OrchestrationGraphSchema.parse(value.graphSnapshot)
      : undefined,
  };
}
export const WorkflowDocument = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ai"), value: AiWorkflowDefinition }),
  z.object({ kind: z.literal("graph"), value: OrchestrationGraphSchema }),
  z.object({ kind: z.literal("template"), value: PromptTemplateSchema }),
  z.object({ kind: z.literal("run"), value: WorkflowRunRecord }),
]);
export type WorkflowDocument =
  | Exclude<z.infer<typeof WorkflowDocument>, { kind: "run" }>
  | { kind: "run"; value: WorkflowRunRecord };
export const WorkflowAuthoredDocument = z.discriminatedUnion("kind", [
  WorkflowDocument.options[0],
  WorkflowDocument.options[1],
  WorkflowDocument.options[2],
]);
export type WorkflowAuthoredDocument = z.infer<typeof WorkflowAuthoredDocument>;
export const WorkflowEntry = z.object({
  ref: WorkflowRef,
  revision: z.string(),
  document: WorkflowDocument,
});
export type WorkflowEntry = Omit<z.infer<typeof WorkflowEntry>, "document"> & {
  document: WorkflowDocument;
};
export function normalizeWorkflowEntry(value: z.infer<typeof WorkflowEntry>): WorkflowEntry {
  return {
    ...value,
    document:
      value.document.kind === "run"
        ? { kind: "run", value: normalizeWorkflowRunRecord(value.document.value) }
        : value.document,
  };
}
export const WorkflowSummary = z.object({
  ref: WorkflowRef,
  revision: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workspaceId: z.string().nullable(),
  conductorAgentId: z.string().nullable(),
  error: z.string().nullable(),
  agentCount: z.number().int().min(0),
});
export type WorkflowSummary = z.infer<typeof WorkflowSummary>;
export const WorkflowPage = z.object({
  items: z.array(WorkflowSummary),
  nextOffset: z.number().int().nullable(),
  diagnostics: z.array(z.string()),
  version: z.number().int(),
});
export type WorkflowPage = z.infer<typeof WorkflowPage>;
export const WorkflowIssue = z.object({
  path: z.string(),
  message: z.string(),
  recovery: z.string(),
});
export type WorkflowIssue = z.infer<typeof WorkflowIssue>;
export const WorkflowStorage = z.object({
  scope: WorkflowScope,
  projectLabel: z.string(),
  hostLabel: z.string(),
  location: z.enum(["repository", "host"]),
  override: z.enum(["repository", "host"]).nullable(),
  revision: z.string(),
  hostDefault: z.enum(["repository", "host"]),
});
export type WorkflowStorage = z.infer<typeof WorkflowStorage>;
export const WorkflowReceipt = z.object({
  id: WorkflowId,
  source: WorkflowRef,
  destination: WorkflowRef,
  operation: z.enum(["copy", "move"]),
  status: z.enum(["committed", "reconciliation_required"]),
  message: z.string(),
});
export type WorkflowReceipt = z.infer<typeof WorkflowReceipt>;
export function workflowValue(document: WorkflowDocument) {
  return document.value;
}

export const workflowList = workflowRpc({
  name: "workflows.library.list.request",
  input: z.object({
    scope: WorkflowScope,
    kind: z.enum(["definition", "graph", "ai", "template", "run"]),
    offset: z.number().int().min(0).optional(),
    includeLegacy: z.boolean().optional(),
  }),
  output: WorkflowPage,
});
export const workflowRead = workflowRpc({
  name: "workflows.document.read.request",
  input: WorkflowRef,
  output: WorkflowEntry,
});
export const workflowSave = workflowRpc({
  name: "workflows.document.save.request",
  input: z.object({
    scope: WorkflowScope,
    ref: WorkflowRef.optional(),
    location: z.enum(["repository", "host"]).optional(),
    expectedRevision: z.string().nullable(),
    document: WorkflowAuthoredDocument,
  }),
  output: WorkflowEntry,
});
export const workflowDelete = workflowRpc({
  name: "workflows.document.delete.request",
  input: z.object({ ref: WorkflowRef, expectedRevision: z.string(), confirmed: z.literal(true) }),
  output: z.object({ deleted: z.boolean() }),
});
export const workflowValidate = workflowRpc({
  name: "workflows.graph.validate.request",
  input: z.object({ scope: WorkflowScope, graph: OrchestrationGraphSchema }),
  output: z.object({ issues: z.array(WorkflowIssue) }),
});
export const workflowReviewStart = workflowRpc({
  name: "workflows.run.review.request",
  input: z.object({
    scope: WorkflowScope,
    workspaceId: z.string().min(1),
    launch: WorkflowLaunch,
    operationId: WorkflowId,
  }),
  output: z.object({
    token: z.string(),
    issues: z.array(WorkflowIssue),
    agentCount: z.number().int(),
    fanOutCount: z.number().int(),
    expiresAt: z.string(),
    warnings: z.array(z.string()),
    launch: WorkflowLaunch,
  }),
});
export const workflowStart = workflowRpc({
  name: "workflows.run.start.request",
  input: z.object({ scope: WorkflowScope, token: z.string(), operationId: WorkflowId }),
  output: WorkflowEntry,
});
export const workflowControl = workflowRpc({
  name: "workflows.run.control.request",
  input: z.object({
    ref: WorkflowRef,
    expectedRevision: z.string(),
    action: z.enum(["cancel", "approve", "reject"]),
    phaseId: z.string().optional(),
    note: z.string().max(4000).optional(),
    confirmed: z.literal(true),
  }),
  output: WorkflowEntry,
});
export const workflowDeclarePlan = workflowRpc({
  name: "workflows.run.declare.request",
  input: z.object({ ref: WorkflowRef, plan: RunPlanSchema }),
  output: WorkflowEntry,
});
export const workflowReadStorage = workflowRpc({
  name: "workflows.storage.read.request",
  input: WorkflowScope,
  output: WorkflowStorage,
});
export const workflowSetStorage = workflowRpc({
  name: "workflows.storage.save.request",
  input: z.object({
    scope: WorkflowScope,
    expectedRevision: z.string(),
    location: z.enum(["repository", "host"]).nullable(),
  }),
  output: WorkflowStorage,
});
export const workflowTransfer = workflowRpc({
  name: "workflows.storage.transfer.request",
  input: z.object({
    source: WorkflowRef,
    expectedRevision: z.string(),
    destination: z.enum(["repository", "host"]),
    operation: z.enum(["copy", "move"]),
    confirmed: z.literal(true),
    operationId: WorkflowId,
  }),
  output: WorkflowReceipt,
});
export const workflowWatch = workflowRpc({
  name: "workflows.library.watch.request",
  input: z.object({ scope: WorkflowScope, version: z.number().int().min(0) }),
  output: z.object({ version: z.number().int() }),
});
const WorkflowRecoveryInspection = z.object({
  ref: WorkflowRef,
  currentRevision: z.string().nullable(),
  snapshotRevision: z.string().nullable(),
  snapshotValid: z.boolean(),
  locks: z.array(
    z.object({
      kind: z.enum(["record", "transaction", "snapshot"]),
      revision: z.string(),
      canRecover: z.boolean(),
    }),
  ),
});
export const workflowInspectRecovery = workflowRpc({
  name: "workflows.storage.inspect.request",
  input: WorkflowRef,
  output: WorkflowRecoveryInspection,
});
export const workflowRecoverLock = workflowRpc({
  name: "workflows.storage.lock.recover.request",
  input: z.object({
    ref: WorkflowRef,
    kind: z.enum(["record", "transaction", "snapshot"]),
    expectedRevision: z.string().nullable(),
    expectedLockRevision: z.string(),
    confirmedNoWriter: z.literal(true),
  }),
  output: WorkflowRecoveryInspection,
});
export const workflowHostStatus = workflowRpc({
  name: "workflows.host.status.request",
  input: z.object({ hostId: z.string() }),
  output: z.object({
    ready: z.boolean(),
    message: z.string().nullable(),
    active: z.array(
      z.object({
        ref: WorkflowRef,
        revision: z.string(),
        status: z.string(),
        settling: z.boolean(),
        recoveryRequired: z.boolean(),
      }),
    ),
  }),
});
export const WorkflowNodeResult = z.object({
  version: z.literal(1),
  runId: WorkflowId,
  agentId: WorkflowId,
  summary: z.string().nullable(),
  fields: z.record(z.string(), z.unknown()).nullable(),
  verdict: JudgeVerdictSchema.nullable(),
});
export const workflowReadOutput = workflowRpc({
  name: "workflows.run.output.read.request",
  input: z.object({
    ref: WorkflowRef,
    agentId: WorkflowId,
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  output: WorkflowNodeResult,
});
export const workflowReconcile = workflowRpc({
  name: "workflows.run.reconcile.request",
  input: z.object({ ref: WorkflowRef, expectedRevision: z.string(), confirmed: z.literal(true) }),
  output: WorkflowEntry,
});
export const workflowRecover = workflowRpc({
  name: "workflows.storage.recover.request",
  input: z.object({
    ref: WorkflowRef,
    expectedRevision: z.string(),
    expectedSnapshotRevision: z.string(),
    confirmed: z.literal(true),
  }),
  output: WorkflowEntry,
});
export const workflowHostSettings = workflowRpc({
  name: "workflows.settings.read.request",
  input: z.object({ hostId: z.string() }),
  output: z.object({ revision: z.string(), location: z.enum(["repository", "host"]) }),
});
export const workflowSaveHostSettings = workflowRpc({
  name: "workflows.settings.save.request",
  input: z.object({
    hostId: z.string(),
    expectedRevision: z.string(),
    location: z.enum(["repository", "host"]),
  }),
  output: z.object({ revision: z.string(), location: z.enum(["repository", "host"]) }),
});

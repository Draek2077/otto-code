import { z } from "zod";
import { ScheduleScope, ScheduleRef, ScheduleId, ScheduleDigest } from "./model.js";

const projectScope = ScheduleScope.extend({ projectId: z.string().min(1).max(512) });
export const ScheduleTransferInput = z.object({
  scope: projectScope,
  source: ScheduleRef,
  expectedRevision: ScheduleDigest,
  operationId: ScheduleId,
  operation: z.enum(["copy", "move"]),
  destination: z.enum(["repository", "host"]),
});
export type ScheduleTransferInput = z.infer<typeof ScheduleTransferInput>;
export const ScheduleTransferLockKind = z.enum([
  "transaction",
  "receipt",
  "backup",
  "source",
  "destination",
]);
export type ScheduleTransferLockKind = z.infer<typeof ScheduleTransferLockKind>;
export const ScheduleTransferInspection = z.object({
  found: z.literal(true),
  scope: projectScope,
  operationId: ScheduleId,
  revision: ScheduleDigest,
  source: ScheduleRef,
  destination: ScheduleRef,
  operation: z.enum(["copy", "move"]),
  status: z.enum(["reconciliation_required", "committed", "aborted"]),
  needsReconciliation: z.boolean(),
  recordedAt: z.string().max(512),
  sourceDigest: ScheduleDigest.nullable(),
  destinationDigest: ScheduleDigest.nullable(),
  sourceMatches: z.boolean(),
  destinationMatches: z.boolean(),
  locks: z
    .array(
      z.object({
        kind: ScheduleTransferLockKind,
        revision: ScheduleDigest,
        canRecover: z.boolean(),
      }),
    )
    .max(5),
});
export type ScheduleTransferInspection = z.infer<typeof ScheduleTransferInspection>;
export const ScheduleTransferLookup = z.discriminatedUnion("found", [
  ScheduleTransferInspection,
  z.object({
    found: z.literal(false),
    scope: projectScope,
    operationId: ScheduleId,
    locks: ScheduleTransferInspection.shape.locks,
  }),
]);
export type ScheduleTransferLookup = z.infer<typeof ScheduleTransferLookup>;
export const ScheduleTransferReconciliation = z.object({
  scope: projectScope,
  operationId: ScheduleId,
  expectedRevision: ScheduleDigest,
  expectedSourceDigest: ScheduleDigest.nullable(),
  expectedDestinationDigest: ScheduleDigest.nullable(),
  decision: z.enum(["complete", "abort"]),
});
export type ScheduleTransferReconciliation = z.infer<typeof ScheduleTransferReconciliation>;
export const ScheduleTransferLockRecovery = z.object({
  scope: projectScope,
  operationId: ScheduleId,
  expectedRevision: ScheduleDigest.nullable(),
  kind: ScheduleTransferLockKind,
  expectedLockRevision: ScheduleDigest,
  // An empty lock alone cannot establish that another daemon process stopped.
  writersStopped: z.literal(true),
});
export type ScheduleTransferLockRecovery = z.infer<typeof ScheduleTransferLockRecovery>;

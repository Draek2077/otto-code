import { z } from "zod";
import { WorkflowGraphExportSchema, WorkflowGraphShareLocationSchema } from "./model.js";
import {
  workflowRpc,
  WorkflowAuthoredDocument,
  WorkflowRef,
  WorkflowScope,
  WorkflowId,
  WorkflowEntry,
} from "./runtime.js";

export const WorkflowDocumentExport = z.object({
  format: z.literal("otto.workflow.document"),
  schemaVersion: z.literal(1),
  document: WorkflowAuthoredDocument,
  source: WorkflowGraphShareLocationSchema,
  exportedAt: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
/** The legacy Graph package has no format tag; it retains its original structural contract. */
export const WorkflowPortablePackage = z.union([WorkflowGraphExportSchema, WorkflowDocumentExport]);
export type WorkflowPortablePackage = z.infer<typeof WorkflowPortablePackage>;
export const workflowExport = workflowRpc({
  name: "workflows.library.export.request",
  input: WorkflowRef,
  output: WorkflowPortablePackage,
});
export const workflowImportReview = workflowRpc({
  name: "workflows.library.import.review.request",
  input: z.object({
    scope: WorkflowScope,
    exported: WorkflowPortablePackage,
    destination: z.enum(["repository", "host"]),
    operationId: WorkflowId,
    newId: WorkflowId.optional(),
  }),
  output: z.object({
    token: z.string(),
    scope: WorkflowScope,
    destination: WorkflowRef,
    document: WorkflowAuthoredDocument,
    source: WorkflowGraphShareLocationSchema,
    sourceHash: z.string(),
    destinationHash: z.string(),
    warnings: z.array(z.string()),
    expiresAt: z.string(),
  }),
});
export const WorkflowImportOutcome = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("committed"),
    receiptId: WorkflowId,
    entry: WorkflowEntry,
    message: z.string(),
  }),
  z.object({
    status: z.literal("reconciliation_required"),
    receiptId: WorkflowId,
    message: z.string(),
  }),
]);
export const workflowImportCommit = workflowRpc({
  name: "workflows.library.import.commit.request",
  input: z.object({
    scope: WorkflowScope,
    token: z.string(),
    operationId: WorkflowId,
    confirmed: z.literal(true),
  }),
  output: WorkflowImportOutcome,
});
export const WorkflowImportInspection = z.object({
  receiptId: WorkflowId,
  recordedAt: z.string().optional(),
  actorHostId: z.string().optional(),
  scope: WorkflowScope,
  revision: z.string(),
  status: z.enum(["committed", "reconciliation_required"]),
  destination: WorkflowRef,
  destinationHash: z.string(),
  currentRevision: z.string().nullable(),
  matches: z.boolean(),
});
export const workflowImportInspect = workflowRpc({
  name: "workflows.library.import.inspect.request",
  input: z.object({ scope: WorkflowScope, operationId: WorkflowId }),
  output: WorkflowImportInspection,
});
export const workflowImportReconcile = workflowRpc({
  name: "workflows.library.import.reconcile.request",
  input: z.object({
    scope: WorkflowScope,
    operationId: WorkflowId,
    expectedRevision: z.string(),
    expectedDocumentRevision: z.string(),
    confirmed: z.literal(true),
  }),
  output: WorkflowImportOutcome,
});

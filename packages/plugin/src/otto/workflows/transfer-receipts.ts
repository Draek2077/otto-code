import { z } from "zod";
import { WorkflowScope, WorkflowId, WorkflowReceipt, workflowRpc } from "./runtime.js";
export const WorkflowTransferInspection = z.object({
  scope: WorkflowScope,
  operationId: WorkflowId,
  revision: z.string().nullable(),
  receipt: WorkflowReceipt.nullable(),
  sourceRevision: z.string().nullable(),
  destinationRevision: z.string().nullable(),
  sourceMatches: z.boolean(),
  destinationMatches: z.boolean(),
  proofAvailable: z.boolean(),
  lock: z.object({ revision: z.string(), canRecover: z.boolean() }).nullable(),
});
export const workflowInspectTransfer = workflowRpc({
  name: "workflows.storage.transfer.inspect.request",
  input: z.object({ scope: WorkflowScope, operationId: WorkflowId }),
  output: WorkflowTransferInspection,
});
export const workflowReconcileTransfer = workflowRpc({
  name: "workflows.storage.transfer.reconcile.request",
  input: z.object({
    scope: WorkflowScope,
    operationId: WorkflowId,
    expectedRevision: z.string(),
    expectedSourceRevision: z.string().nullable(),
    expectedDestinationRevision: z.string(),
    decision: z.enum(["keep_copy", "complete_move"]),
    confirmed: z.literal(true),
  }),
  output: WorkflowTransferInspection,
});
export const workflowRecoverTransferLock = workflowRpc({
  name: "workflows.storage.transfer.lock.recover.request",
  input: z.object({
    scope: WorkflowScope,
    operationId: WorkflowId,
    expectedRevision: z.string().nullable(),
    expectedLockRevision: z.string(),
    confirmedNoWriter: z.literal(true),
  }),
  output: WorkflowTransferInspection,
});

import * as runtime from "./runtime.js";
import * as sharing from "./sharing.js";
import { workflowPreviewTemplate } from "./template-preview.js";
import {
  workflowInspectTransfer,
  workflowReconcileTransfer,
  workflowRecoverTransferLock,
} from "./transfer-receipts.js";
/** Discovery loads structural operation schemas only, never saved prompts, graphs or run history. */
export const workflowOperations = [
  workflowInspectTransfer,
  workflowReconcileTransfer,
  workflowRecoverTransferLock,
  workflowPreviewTemplate,
  runtime.workflowList,
  runtime.workflowRead,
  runtime.workflowSave,
  runtime.workflowDelete,
  runtime.workflowValidate,
  runtime.workflowReviewStart,
  runtime.workflowStart,
  runtime.workflowControl,
  runtime.workflowDeclarePlan,
  runtime.workflowReadStorage,
  runtime.workflowSetStorage,
  runtime.workflowTransfer,
  runtime.workflowInspectRecovery,
  runtime.workflowRecover,
  runtime.workflowRecoverLock,
  runtime.workflowHostStatus,
  runtime.workflowReconcile,
  runtime.workflowReadOutput,
  runtime.workflowHostSettings,
  runtime.workflowSaveHostSettings,
  sharing.workflowExport,
  sharing.workflowImportReview,
  sharing.workflowImportCommit,
  sharing.workflowImportInspect,
  sharing.workflowImportReconcile,
] as const;

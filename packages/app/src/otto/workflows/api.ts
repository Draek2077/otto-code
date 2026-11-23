import { useMemo, createContext, useContext, createElement, type ReactNode } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import {
  workflowList,
  workflowRead,
  workflowSave,
  workflowDelete,
  workflowValidate,
  workflowReviewStart,
  workflowStart,
  workflowControl,
  workflowReadStorage,
  workflowSetStorage,
  workflowTransfer,
  workflowInspectRecovery,
  workflowRecoverLock,
  workflowHostStatus,
  workflowReadOutput,
  workflowReconcile,
  workflowRecover,
  workflowHostSettings,
  workflowSaveHostSettings,
  workflowExport,
  workflowImportReview,
  workflowImportCommit,
  workflowImportInspect,
  workflowImportReconcile,
  unwrapWorkflowResult,
  normalizeWorkflowEntry,
  workflowInspectTransfer,
  workflowReconcileTransfer,
  workflowRecoverTransferLock,
} from "@getpaseo/plugin/otto/workflows";
import type { input as Input } from "zod";
/** Existing authenticated plugin transport; no private sockets or parallel feature cache. */
function useComposedWorkflowApi() {
  const listCall = useRpc(workflowList);
  const readCall = useRpc(workflowRead);
  const saveCall = useRpc(workflowSave);
  const removeCall = useRpc(workflowDelete);
  const validateCall = useRpc(workflowValidate);
  const reviewCall = useRpc(workflowReviewStart);
  const startCall = useRpc(workflowStart);
  const controlCall = useRpc(workflowControl);
  const storageCall = useRpc(workflowReadStorage);
  const setStorageCall = useRpc(workflowSetStorage);
  const transferCall = useRpc(workflowTransfer);
  const inspectCall = useRpc(workflowInspectRecovery);
  const recoverLockCall = useRpc(workflowRecoverLock);
  const statusCall = useRpc(workflowHostStatus);
  const outputCall = useRpc(workflowReadOutput);
  const reconcileCall = useRpc(workflowReconcile);
  const recoverCall = useRpc(workflowRecover);
  const defaultsCall = useRpc(workflowHostSettings);
  const setDefaultsCall = useRpc(workflowSaveHostSettings);
  const exportCall = useRpc(workflowExport);
  const reviewImportCall = useRpc(workflowImportReview);
  const commitImportCall = useRpc(workflowImportCommit);
  const inspectImportCall = useRpc(workflowImportInspect);
  const reconcileImportCall = useRpc(workflowImportReconcile);
  const inspectTransferCall = useRpc(workflowInspectTransfer),
    reconcileTransferCall = useRpc(workflowReconcileTransfer),
    recoverTransferLockCall = useRpc(workflowRecoverTransferLock);
  return useMemo(
    () => ({
      inspectTransfer: async (input: Input<typeof workflowInspectTransfer.input>) =>
        unwrapWorkflowResult(await inspectTransferCall(input)),
      reconcileTransfer: async (input: Input<typeof workflowReconcileTransfer.input>) =>
        unwrapWorkflowResult(await reconcileTransferCall(input)),
      recoverTransferLock: async (input: Input<typeof workflowRecoverTransferLock.input>) =>
        unwrapWorkflowResult(await recoverTransferLockCall(input)),
      list: async (input: Input<typeof workflowList.input>) =>
        unwrapWorkflowResult(await listCall(input)),
      read: async (input: Input<typeof workflowRead.input>) =>
        normalizeWorkflowEntry(unwrapWorkflowResult(await readCall(input))),
      save: async (input: Input<typeof workflowSave.input>) =>
        normalizeWorkflowEntry(unwrapWorkflowResult(await saveCall(input))),
      remove: async (input: Input<typeof workflowDelete.input>) =>
        unwrapWorkflowResult(await removeCall(input)),
      validate: async (input: Input<typeof workflowValidate.input>) =>
        unwrapWorkflowResult(await validateCall(input)),
      review: async (input: Input<typeof workflowReviewStart.input>) =>
        unwrapWorkflowResult(await reviewCall(input)),
      start: async (input: Input<typeof workflowStart.input>) =>
        normalizeWorkflowEntry(unwrapWorkflowResult(await startCall(input))),
      control: async (input: Input<typeof workflowControl.input>) =>
        normalizeWorkflowEntry(unwrapWorkflowResult(await controlCall(input))),
      storage: async (input: Input<typeof workflowReadStorage.input>) =>
        unwrapWorkflowResult(await storageCall(input)),
      setStorage: async (input: Input<typeof workflowSetStorage.input>) =>
        unwrapWorkflowResult(await setStorageCall(input)),
      transfer: async (input: Input<typeof workflowTransfer.input>) =>
        unwrapWorkflowResult(await transferCall(input)),
      inspect: async (input: Input<typeof workflowInspectRecovery.input>) =>
        unwrapWorkflowResult(await inspectCall(input)),
      recoverLock: async (input: Input<typeof workflowRecoverLock.input>) =>
        unwrapWorkflowResult(await recoverLockCall(input)),
      status: async (input: Input<typeof workflowHostStatus.input>) =>
        unwrapWorkflowResult(await statusCall(input)),
      output: async (input: Input<typeof workflowReadOutput.input>) =>
        unwrapWorkflowResult(await outputCall(input)),
      reconcile: async (input: Input<typeof workflowReconcile.input>) =>
        normalizeWorkflowEntry(unwrapWorkflowResult(await reconcileCall(input))),
      recover: async (input: Input<typeof workflowRecover.input>) =>
        normalizeWorkflowEntry(unwrapWorkflowResult(await recoverCall(input))),
      defaults: async (input: Input<typeof workflowHostSettings.input>) =>
        unwrapWorkflowResult(await defaultsCall(input)),
      setDefaults: async (input: Input<typeof workflowSaveHostSettings.input>) =>
        unwrapWorkflowResult(await setDefaultsCall(input)),
      export: async (input: Input<typeof workflowExport.input>) =>
        unwrapWorkflowResult(await exportCall(input)),
      reviewImport: async (input: Input<typeof workflowImportReview.input>) =>
        unwrapWorkflowResult(await reviewImportCall(input)),
      commitImport: async (input: Input<typeof workflowImportCommit.input>) =>
        unwrapWorkflowResult(await commitImportCall(input)),
      inspectImport: async (input: Input<typeof workflowImportInspect.input>) =>
        unwrapWorkflowResult(await inspectImportCall(input)),
      reconcileImport: async (input: Input<typeof workflowImportReconcile.input>) =>
        unwrapWorkflowResult(await reconcileImportCall(input)),
    }),
    [
      inspectTransferCall,
      reconcileTransferCall,
      recoverTransferLockCall,
      listCall,
      readCall,
      saveCall,
      removeCall,
      validateCall,
      reviewCall,
      startCall,
      controlCall,
      storageCall,
      setStorageCall,
      transferCall,
      inspectCall,
      recoverLockCall,
      statusCall,
      outputCall,
      reconcileCall,
      recoverCall,
      defaultsCall,
      setDefaultsCall,
      exportCall,
      reviewImportCall,
      commitImportCall,
      inspectImportCall,
      reconcileImportCall,
    ],
  );
}
export type WorkflowApi = ReturnType<typeof useComposedWorkflowApi>;
const Context = createContext<WorkflowApi | null>(null);
/** One authenticated callback table per contributed surface, not per run candidate. */
export function WorkflowApiProvider({ children }: { children: ReactNode }) {
  const value = useComposedWorkflowApi();
  return createElement(Context.Provider, { value }, children);
}
export function useWorkflowApi() {
  const value = useContext(Context);
  if (!value) throw new Error("Workflow surface has no owning API boundary.");
  return value;
}

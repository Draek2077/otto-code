import { z } from "zod";
import * as rpc from "@getpaseo/plugin/otto/workflows";
import { WorkflowLibrary, assertDocumentBudget } from "./library.js";
import { WorkflowHost } from "./host.js";
import { WorkflowTransfers } from "./transfers.js";
import { WorkflowChanges } from "./changes.js";
import { validateGraphForExecution } from "./graph-engine.js";
import { WorkflowError } from "./files.js";
import { WorkflowSharing } from "./sharing.js";
import { captureWorkflowTemplateClosure } from "./template-snapshot.js";
import { renderWorkflowTemplate } from "./templates.js";
import { WorkflowTransferReceipts } from "./transfer-receipts.js";
function failureCode(error: unknown) {
  if (error instanceof WorkflowError) return error.kind;
  return error instanceof z.ZodError ? "invalid" : "unavailable";
}
const mutationMethods = new Set([
  rpc.workflowReconcileTransfer.name,
  rpc.workflowRecoverTransferLock.name,
  rpc.workflowSave.name,
  rpc.workflowDelete.name,
  rpc.workflowStart.name,
  rpc.workflowControl.name,
  rpc.workflowDeclarePlan.name,
  rpc.workflowSetStorage.name,
  rpc.workflowTransfer.name,
  rpc.workflowRecover.name,
  rpc.workflowRecoverLock.name,
  rpc.workflowReconcile.name,
  rpc.workflowSaveHostSettings.name,
  rpc.workflowImportCommit.name,
  rpc.workflowImportReconcile.name,
]);

/** One authenticated daemon service backs app, CLI, MCP and future Schedule adapters. */
export class WorkflowDaemonService {
  private closed = false;
  private readonly mutations = new Set<Promise<unknown>>();
  readonly transfers: WorkflowTransfers;
  readonly sharing: WorkflowSharing;
  readonly receipts: WorkflowTransferReceipts;
  constructor(
    readonly library: WorkflowLibrary,
    readonly host: WorkflowHost,
    readonly changes: WorkflowChanges,
  ) {
    this.transfers = new WorkflowTransfers(library);
    this.sharing = new WorkflowSharing(library);
    this.receipts = new WorkflowTransferReceipts(library);
  }
  private hostId(hostId: string) {
    if (hostId !== this.library.ports.stores.ports.hostId)
      throw new WorkflowError("invalid", "Select the owning Workflow host.");
  }
  invoke(method: string, value: unknown): Promise<unknown> | undefined {
    if (this.closed)
      return Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "Workflow host has stopped." },
      });
    const result = this.dispatch(method, value);
    if (result && mutationMethods.has(method)) {
      this.mutations.add(result);
      const release = () => {
        this.mutations.delete(result);
      };
      void result.then(release, release);
    }
    return result;
  }
  private dispatch(method: string, value: unknown): Promise<unknown> | undefined {
    if (method === rpc.workflowPreviewTemplate.name) return this.preview(value);
    switch (method) {
      case rpc.workflowList.name:
        return this.guard(async () => {
          const i = rpc.workflowList.input.parse(value);
          const page = await this.library.list(i.scope, i.kind, i.offset, i.includeLegacy);
          return { ...page, version: this.changes.version(i.scope) };
        });
      case rpc.workflowRead.name:
        return this.guard(() => this.library.read(rpc.workflowRead.input.parse(value)));
      case rpc.workflowSave.name:
        return this.guard(() => {
          const i = rpc.workflowSave.input.parse(value);
          return this.library.write(i.scope, i.document, i.expectedRevision, i.ref, i.location);
        });
      case rpc.workflowDelete.name:
        return this.guard(async () => {
          const i = rpc.workflowDelete.input.parse(value);
          if (i.ref.kind === "run") this.host.assertInactive(i.ref);
          await this.library.remove(i.ref, i.expectedRevision);
          return { deleted: true };
        });
      case rpc.workflowValidate.name:
        return this.guard(async () => {
          const i = rpc.workflowValidate.input.parse(value);
          await this.library.ports.stores.project(i.scope);
          assertDocumentBudget({ kind: "graph", value: i.graph });
          return {
            issues: validateGraphForExecution(i.graph).map((message) => ({
              path: "graph",
              message,
              recovery: "Correct the selected Graph before starting a run.",
            })),
          };
        });
      case rpc.workflowReviewStart.name:
        return this.guard(() => {
          const i = rpc.workflowReviewStart.input.parse(value);
          return this.host.review(i.scope, i.workspaceId, i.launch, i.operationId);
        });
      case rpc.workflowStart.name:
        return this.guard(() => {
          const i = rpc.workflowStart.input.parse(value);
          return this.host.start(i.scope, i.token, i.operationId);
        });
      case rpc.workflowControl.name:
        return this.guard(() => {
          const i = rpc.workflowControl.input.parse(value);
          return this.host.control(i.ref, i.expectedRevision, i.action, i.phaseId, i.note);
        });
      case rpc.workflowDeclarePlan.name:
        return this.guard(() => {
          const i = rpc.workflowDeclarePlan.input.parse(value);
          return this.host.declarePlan(i.ref, i.plan);
        });
      case rpc.workflowReadOutput.name:
        return this.guard(() => {
          const input = rpc.workflowReadOutput.input.parse(value);
          return this.host.outputs.read(input.ref, input.agentId, input.revision);
        });
      case rpc.workflowReadStorage.name:
        return this.guard(() =>
          this.library.ports.stores.storage(rpc.workflowReadStorage.input.parse(value)),
        );
      case rpc.workflowSetStorage.name:
        return this.guard(() => {
          const i = rpc.workflowSetStorage.input.parse(value);
          return this.library.ports.stores.saveStorage(i.scope, i.expectedRevision, i.location);
        });
      case rpc.workflowTransfer.name:
        return this.guard(() => {
          const input = rpc.workflowTransfer.input.parse(value);
          if (input.source.kind === "run") this.host.assertInactive(input.source);
          return this.transfers.transfer(input);
        });
      case rpc.workflowWatch.name:
        return this.guard(async () => {
          const i = rpc.workflowWatch.input.parse(value);
          await this.library.ports.stores.project(i.scope);
          return this.changes.watch(i.scope, i.version);
        });
      case rpc.workflowHostSettings.name:
        return this.guard(async () => {
          this.hostId(rpc.workflowHostSettings.input.parse(value).hostId);
          const i = await this.library.ports.stores.defaults();
          return { revision: i.revision, location: i.location };
        });
      case rpc.workflowSaveHostSettings.name:
        return this.guard(() => {
          const i = rpc.workflowSaveHostSettings.input.parse(value);
          this.hostId(i.hostId);
          return this.library.ports.stores.saveDefaults(i.expectedRevision, i.location);
        });
    }
    return (
      this.receiptRpc(method, value) ??
      this.recovery(method, value) ??
      this.sharingRpc(method, value)
    );
  }
  private receiptRpc(method: string, value: unknown): Promise<unknown> | undefined {
    switch (method) {
      case rpc.workflowInspectTransfer.name:
        return this.guard(() => {
          const input = rpc.workflowInspectTransfer.input.parse(value);
          return this.receipts.inspect(input.scope, input.operationId);
        });
      case rpc.workflowReconcileTransfer.name:
        return this.guard(async () => {
          const input = rpc.workflowReconcileTransfer.input.parse(value),
            inspected = await this.receipts.inspect(input.scope, input.operationId);
          for (const ref of [inspected.receipt?.source, inspected.receipt?.destination])
            if (ref?.kind === "run") this.host.assertInactive(ref);
          return this.receipts.reconcile(input);
        });
      case rpc.workflowRecoverTransferLock.name:
        return this.guard(() => {
          const input = rpc.workflowRecoverTransferLock.input.parse(value);
          return this.receipts.recoverLock(
            input.scope,
            input.operationId,
            input.expectedRevision,
            input.expectedLockRevision,
          );
        });
    }
  }
  private sharingRpc(method: string, value: unknown): Promise<unknown> | undefined {
    switch (method) {
      case rpc.workflowExport.name:
        return this.guard(() => this.sharing.export(rpc.workflowExport.input.parse(value)));
      case rpc.workflowImportReview.name:
        return this.guard(() => this.sharing.review(rpc.workflowImportReview.input.parse(value)));
      case rpc.workflowImportCommit.name:
        return this.guard(() => {
          const input = rpc.workflowImportCommit.input.parse(value);
          return this.sharing.commit(input.scope, input.token, input.operationId);
        });
      case rpc.workflowImportInspect.name:
        return this.guard(() => {
          const input = rpc.workflowImportInspect.input.parse(value);
          return this.sharing.inspect(input.scope, input.operationId);
        });
      case rpc.workflowImportReconcile.name:
        return this.guard(() =>
          this.sharing.reconcile(rpc.workflowImportReconcile.input.parse(value)),
        );
    }
  }
  private preview(value: unknown) {
    return this.guard(async () => {
      const input = rpc.workflowPreviewTemplate.input.parse(value);
      if (Buffer.byteLength(JSON.stringify(input)) > 512000)
        throw new WorkflowError("invalid", "Template preview exceeds 500 KB.");
      const snapshots = await captureWorkflowTemplateClosure(
        this.library,
        input.scope,
        [input.template.id],
        input.allowCode === true,
        input.template,
      );
      const text = await renderWorkflowTemplate({
        id: input.template.id,
        templates: snapshots.map((item) => item.template),
        variables: input.variables,
        allowCode: input.allowCode === true,
        signal: AbortSignal.timeout(1500),
      });
      return { text };
    });
  }
  private recovery(method: string, value: unknown): Promise<unknown> | undefined {
    switch (method) {
      case rpc.workflowInspectRecovery.name:
        return this.guard(() =>
          this.transfers.inspect(rpc.workflowInspectRecovery.input.parse(value)),
        );
      case rpc.workflowRecover.name:
        return this.guard(async () => {
          const input = rpc.workflowRecover.input.parse(value);
          this.host.assertInactive(input.ref);
          await this.transfers.recover(
            input.ref,
            input.expectedRevision,
            input.expectedSnapshotRevision,
          );
          return this.library.read(input.ref);
        });
      case rpc.workflowRecoverLock.name:
        return this.guard(() => {
          const input = rpc.workflowRecoverLock.input.parse(value);
          this.host.assertInactive(input.ref);
          return this.transfers.recoverLock(
            input.ref,
            input.kind,
            input.expectedRevision,
            input.expectedLockRevision,
          );
        });
      case rpc.workflowHostStatus.name:
        return this.guard(async () => {
          this.hostId(rpc.workflowHostStatus.input.parse(value).hostId);
          return this.host.status();
        });
      case rpc.workflowReconcile.name:
        return this.guard(() => {
          const input = rpc.workflowReconcile.input.parse(value);
          return this.host.reconcile(input.ref, input.expectedRevision);
        });
    }
  }
  private async guard<T>(operation: () => Promise<T>) {
    try {
      return { ok: true as const, value: await operation() };
    } catch (error) {
      const code = failureCode(error);
      const message =
        error instanceof WorkflowError
          ? error.message
          : "Workflow could not acknowledge this operation. Refresh and review the owning origin before another write.";
      return { ok: false as const, error: { code, message } };
    }
  }
  async close() {
    this.closed = true;
    this.sharing.close();
    this.changes.close();
    await this.host.close();
    await Promise.allSettled(this.mutations);
  }
}

import path from "node:path";
import { z } from "zod";
import {
  WorkflowReceipt,
  type WorkflowDocument,
  type WorkflowRef,
  type WorkflowScope,
  type workflowReconcileTransfer,
} from "@getpaseo/plugin/otto/workflows";
import { WorkflowLibrary, parseWorkflowDocument } from "./library.js";
import { canonicalJson } from "./graph-identity.js";
import {
  WorkflowError,
  assertWorkflowId,
  workflowDigest,
  workflowDirectory,
  readWorkflowFile,
  publishWorkflowFile,
  workflowExclusive,
} from "./files.js";
import { inspectWorkflowLock, recoverWorkflowLock } from "./locks.js";
import { WorkflowRunOutputs } from "./run-outputs.js";
export const workflowTransferRecord = z
  .object({
    fingerprint: z.string(),
    receipt: WorkflowReceipt,
    proof: z.object({ sourceRevision: z.string(), destinationContentHash: z.string() }).optional(),
  })
  .passthrough();
export function workflowDocumentHash(document: WorkflowDocument) {
  const value = structuredClone(document);
  delete value.value.workflowStorage;
  return workflowDigest(JSON.stringify(canonicalJson(value)));
}
/** Reconciliation is an inspected decision, never a replay of the original copy or generation. */
export class WorkflowTransferReceipts {
  constructor(readonly library: WorkflowLibrary) {}
  private async file(scope: WorkflowScope, operationId: string) {
    assertWorkflowId(operationId);
    await this.library.ports.stores.project(scope);
    const home = this.library.ports.stores.ports.home,
      directory = path.join(home, "workflow-transfers");
    await workflowDirectory(home, directory);
    return path.join(directory, `${operationId}.json`);
  }
  private async record(scope: WorkflowScope, file: string) {
    const bytes = await readWorkflowFile(file);
    if (bytes === null) return null;
    const record = workflowTransferRecord.parse(JSON.parse(bytes));
    for (const ref of [record.receipt.source, record.receipt.destination])
      if (ref.scope.hostId !== scope.hostId || ref.scope.projectId !== scope.projectId)
        throw new WorkflowError("invalid", "Transfer receipt belongs to another project/host.");
    return { record, revision: workflowDigest(bytes) };
  }
  private async current(ref: WorkflowRef) {
    const stores = await this.library.ports.stores.resolve(ref);
    if (stores.length !== 1)
      throw new WorkflowError("conflict", "Choose an exact transfer origin.");
    const store = stores[0],
      directory = this.library.ports.stores.directory(store, ref.kind);
    await workflowDirectory(store.boundary, directory);
    const bytes = await readWorkflowFile(this.library.ports.stores.file(store, ref.kind, ref.id));
    if (bytes === null) return { revision: null, document: null };
    let document: WorkflowDocument | null = null;
    try {
      const parsed = parseWorkflowDocument(ref.kind, JSON.parse(bytes));
      if (parsed.value.id === ref.id) document = parsed;
    } catch {
      /* Retain malformed bytes and report their digest without granting reconciliation. */
    }
    return { revision: workflowDigest(bytes), document };
  }
  async inspect(scope: WorkflowScope, operationId: string) {
    const file = await this.file(scope, operationId),
      retained = await this.record(scope, file),
      lock = await inspectWorkflowLock(`${file}.transaction`);
    const receipt = retained?.record.receipt ?? null,
      proof = retained?.record.proof;
    const source = receipt ? await this.current(receipt.source) : null,
      destination = receipt ? await this.current(receipt.destination) : null;
    const destinationMatches =
      receipt && proof && destination?.document
        ? await this.matchesDestination(
            receipt.destination,
            destination.document,
            proof.destinationContentHash,
          )
        : false;
    return {
      scope,
      operationId,
      revision: retained?.revision ?? null,
      receipt,
      sourceRevision: source?.revision ?? null,
      destinationRevision: destination?.revision ?? null,
      sourceMatches: !!proof && source?.revision === proof.sourceRevision,
      destinationMatches,
      proofAvailable: !!proof,
      lock: lock ? { revision: lock.revision, canRecover: lock.canRecover } : null,
    };
  }
  private async matchesDestination(ref: WorkflowRef, document: WorkflowDocument, expected: string) {
    if (workflowDocumentHash(document) !== expected) return false;
    if (document.kind !== "run") return true;
    try {
      const outputs = new WorkflowRunOutputs(this.library);
      const candidates = document.value.phases.flatMap((phase) => phase.candidates ?? []);
      for (const candidate of candidates)
        if (candidate.outputRevision)
          await outputs.read(ref, candidate.agentId, candidate.outputRevision);
      return true;
    } catch {
      return false;
    }
  }
  async reconcile(input: z.input<typeof workflowReconcileTransfer.input>) {
    const file = await this.file(input.scope, input.operationId);
    return workflowExclusive(`${file}.transaction`, async () => {
      const inspected = await this.inspect(input.scope, input.operationId),
        retained = await this.record(input.scope, file);
      if (
        !retained ||
        retained.revision !== input.expectedRevision ||
        inspected.sourceRevision !== input.expectedSourceRevision ||
        inspected.destinationRevision !== input.expectedDestinationRevision
      )
        throw new WorkflowError(
          "conflict",
          "Inspected transfer content changed. Inspect both origins again.",
        );
      if (!inspected.proofAvailable || !inspected.destinationMatches)
        throw new WorkflowError(
          "conflict",
          "The destination does not match this retained transfer proof. No work was replayed.",
        );
      const receipt = retained.record.receipt;
      if (input.decision === "complete_move")
        await this.completeMove(inspected, receipt, retained.record.proof!.sourceRevision);
      else receipt.operation = "copy";
      receipt.status = "committed";
      receipt.message =
        input.decision === "complete_move"
          ? "Reconciled verified move; original source retained in recovery."
          : "Reconciled verified copy; source preserved by explicit decision.";
      await publishWorkflowFile(
        file,
        JSON.stringify(retained.record, null, 2) + "\n",
        retained.revision,
      );
      return this.inspect(input.scope, input.operationId);
    });
  }
  private async completeMove(
    inspected: Awaited<ReturnType<WorkflowTransferReceipts["inspect"]>>,
    receipt: z.infer<typeof WorkflowReceipt>,
    revision: string,
  ) {
    if (receipt.operation !== "move")
      throw new WorkflowError("invalid", "This receipt was authorized as a copy, not a move.");
    if (inspected.sourceRevision === null) return;
    if (!inspected.sourceMatches)
      throw new WorkflowError(
        "conflict",
        "Source changed after transfer. Keep the verified copy; source edits must not be retired.",
      );
    await this.library.remove(receipt.source, revision);
  }
  async recoverLock(
    scope: WorkflowScope,
    operationId: string,
    expectedRevision: string | null,
    expectedLockRevision: string,
  ) {
    const file = await this.file(scope, operationId),
      retained = await this.record(scope, file);
    if ((retained?.revision ?? null) !== expectedRevision)
      throw new WorkflowError("conflict", "Transfer receipt changed before lock recovery.");
    await recoverWorkflowLock(`${file}.transaction`, expectedLockRevision);
    return this.inspect(scope, operationId);
  }
}

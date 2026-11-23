import path from "node:path";
import { WorkflowReceipt, type WorkflowRef } from "@getpaseo/plugin/otto/workflows";
import { WorkflowLibrary, parseWorkflowDocument, assertDocumentBudget } from "./library.js";
import { canonicalJson } from "./graph-identity.js";
import { inspectWorkflowLock, recoverWorkflowLock } from "./locks.js";
import { WorkflowRunOutputs } from "./run-outputs.js";
import { workflowTransferRecord, workflowDocumentHash } from "./transfer-receipts.js";
import {
  WorkflowError,
  assertWorkflowId,
  workflowDigest,
  workflowDirectory,
  readWorkflowFile,
  publishWorkflowFile,
  workflowExclusive,
} from "./files.js";

const receiptSchema = workflowTransferRecord;
export interface WorkflowTransferInput {
  source: WorkflowRef;
  expectedRevision: string;
  destination: "repository" | "host";
  operation: "copy" | "move";
  operationId: string;
}
const terminal = new Set(["done", "failed", "canceled", "draft"]);

/** Explicit single-document transactions. Retained receipts fence replays after an unknown crash outcome. */
export class WorkflowTransfers {
  constructor(readonly library: WorkflowLibrary) {}
  async transfer(input: WorkflowTransferInput): Promise<WorkflowReceipt> {
    assertWorkflowId(input.operationId);
    await this.library.ports.stores.project(input.source.scope);
    const directory = path.join(this.library.ports.stores.ports.home, "workflow-transfers");
    await workflowDirectory(this.library.ports.stores.ports.home, directory, true);
    const file = path.join(directory, `${input.operationId}.json`);
    const fingerprint = workflowDigest(JSON.stringify(canonicalJson(input)));
    return workflowExclusive(`${file}.transaction`, async () => {
      const previous = await readWorkflowFile(file);
      if (previous !== null) {
        const retained = receiptSchema.parse(JSON.parse(previous));
        if (retained.fingerprint !== fingerprint)
          throw new WorkflowError(
            "conflict",
            "This transfer operation identity was already used for different content.",
          );
        return retained.receipt;
      }
      return this.perform(input, file, fingerprint);
    });
  }
  private async perform(
    input: WorkflowTransferInput,
    file: string,
    fingerprint: string,
  ): Promise<WorkflowReceipt> {
    const source = await this.library.locate(input.source);
    if (source.entry.revision !== input.expectedRevision)
      throw new WorkflowError("conflict", "Workflow source changed before transfer.");
    if (source.store.location === input.destination)
      throw new WorkflowError("invalid", "Choose a different Workflow storage location.");
    const document = structuredClone(source.entry.document);
    if (document.kind === "run" && !terminal.has(document.value.status))
      throw new WorkflowError("busy", "An active Workflow cannot be transferred.");
    if (source.store.location === "legacy" && input.operation === "move")
      throw new WorkflowError(
        "unsupported",
        "Copy legacy records into a project; shared legacy history is preserved.",
      );
    if (document.kind === "graph") document.value.builtIn = false;
    const store = await this.library.ports.stores.at(input.source.scope, input.destination);
    if (await this.library.readAt(store, document.kind, document.value.id))
      throw new WorkflowError(
        "conflict",
        "The destination already contains this Workflow identity. Review both records before transfer.",
      );
    const destination: WorkflowRef = {
      scope: input.source.scope,
      kind: document.kind,
      id: document.value.id,
      location: input.destination,
      storeKey: store.storeKey,
    };
    const receipt: WorkflowReceipt = {
      id: input.operationId,
      recordedAt: new Date().toISOString(),
      actorHostId: this.library.ports.stores.ports.hostId,
      source: source.entry.ref,
      destination,
      operation: input.operation,
      status: "reconciliation_required",
      message:
        "Transfer admitted. If interrupted, inspect the destination and retained source before any new operation.",
    };
    const proof = {
      sourceRevision: input.expectedRevision,
      destinationContentHash: workflowDocumentHash(document),
    };
    const prepared = JSON.stringify({ fingerprint, receipt, proof }, null, 2) + "\n";
    const revision = await publishWorkflowFile(file, prepared, null);
    try {
      if (document.kind === "run")
        await new WorkflowRunOutputs(this.library).copy(source.entry.ref, store, document.value);
      const written = await this.library.write(
        input.source.scope,
        document,
        null,
        undefined,
        input.destination,
      );
      const verified = await this.library.read(written.ref);
      if (verified.revision !== written.revision)
        throw new WorkflowError(
          "conflict",
          "The destination changed during transfer verification.",
        );
      receipt.destination = verified.ref;
      if (input.operation === "move")
        await this.library.remove(source.entry.ref, input.expectedRevision);
      receipt.status = "committed";
      receipt.message =
        input.operation === "move"
          ? "Destination verified; source retained in its recovery directory."
          : "Destination verified; original source preserved.";
    } catch {
      // No rollback or blind retry: destination publication or source retirement may already have committed.
      receipt.message =
        "Transfer needs reconciliation. Inspect both explicit origins; original/recovery bytes and this receipt are retained.";
    }
    await publishWorkflowFile(
      file,
      JSON.stringify({ fingerprint, receipt, proof }, null, 2) + "\n",
      revision,
    );
    return receipt;
  }

  /** Restore only a validated last-good document after an explicit raw-digest review. No read silently repairs data. */
  private async recoveryOrigin(ref: WorkflowRef) {
    if (ref.location === "legacy" || !ref.storeKey)
      throw new WorkflowError(
        "unsupported",
        "Recovery requires one explicit project-owned origin.",
      );
    const stores = await this.library.ports.stores.resolve(ref);
    if (stores.length !== 1)
      throw new WorkflowError("conflict", "Choose one exact Workflow origin for recovery.");
    const store = stores[0];
    const directory = this.library.ports.stores.directory(store, ref.kind);
    await workflowDirectory(store.boundary, directory);
    const file = this.library.ports.stores.file(store, ref.kind, ref.id);
    return { store, directory, file };
  }
  async inspect(ref: WorkflowRef) {
    const { file, directory } = await this.recoveryOrigin(ref);
    const current = await readWorkflowFile(file);
    const snapshot = await readWorkflowFile(
      path.join(directory, ".otto-last-good", `${ref.id}.json`),
    );
    let snapshotValid = false;
    if (snapshot !== null) {
      try {
        const document = parseWorkflowDocument(ref.kind, JSON.parse(snapshot));
        assertDocumentBudget(document);
        snapshotValid = document.value.id === ref.id;
      } catch {
        snapshotValid = false;
      }
    }
    return {
      ref,
      currentRevision: current === null ? null : workflowDigest(current),
      snapshotRevision: snapshot === null ? null : workflowDigest(snapshot),
      snapshotValid,
      locks: await this.inspectLocks(file, directory, ref.id),
    };
  }
  private lockFile(
    file: string,
    directory: string,
    id: string,
    kind: "record" | "transaction" | "snapshot",
  ) {
    if (kind === "transaction") return `${file}.transaction`;
    if (kind === "snapshot") return path.join(directory, ".otto-last-good", `${id}.json`);
    return file;
  }
  private async inspectLocks(file: string, directory: string, id: string) {
    const locks = [];
    for (const kind of ["record", "transaction", "snapshot"] as const) {
      const lock = await inspectWorkflowLock(this.lockFile(file, directory, id, kind));
      if (lock) locks.push({ kind, ...lock });
    }
    return locks;
  }
  async recoverLock(
    ref: WorkflowRef,
    kind: "record" | "transaction" | "snapshot",
    expectedRevision: string | null,
    expectedLockRevision: string,
  ) {
    const { file, directory } = await this.recoveryOrigin(ref);
    const current = await readWorkflowFile(file);
    if ((current === null ? null : workflowDigest(current)) !== expectedRevision)
      throw new WorkflowError("conflict", "Workflow bytes changed since lock review.");
    await recoverWorkflowLock(this.lockFile(file, directory, ref.id, kind), expectedLockRevision);
    this.library.ports.changed?.(ref.scope);
    return this.inspect(ref);
  }
  async recover(
    ref: WorkflowRef,
    expectedDamagedRevision: string,
    expectedSnapshotRevision: string,
  ): Promise<void> {
    const { store, directory, file } = await this.recoveryOrigin(ref);
    await workflowExclusive(`${file}.transaction`, async () => {
      const current = await readWorkflowFile(file);
      if (current === null || workflowDigest(current) !== expectedDamagedRevision)
        throw new WorkflowError("conflict", "Workflow bytes changed since recovery review.");
      const snapshot = await readWorkflowFile(
        path.join(directory, ".otto-last-good", `${ref.id}.json`),
      );
      if (snapshot === null)
        throw new WorkflowError("unavailable", "No last-good Workflow snapshot is available.");
      if (workflowDigest(snapshot) !== expectedSnapshotRevision)
        throw new WorkflowError(
          "conflict",
          "Last-good Workflow snapshot changed since recovery review.",
        );
      const document = parseWorkflowDocument(ref.kind, JSON.parse(snapshot));
      assertDocumentBudget(document);
      if (document.value.id !== ref.id)
        throw new WorkflowError("invalid", "Snapshot identity does not match this Workflow.");
      const provenance = document.value.workflowStorage;
      if (
        provenance &&
        typeof provenance === "object" &&
        "projectId" in provenance &&
        provenance.projectId !== ref.scope.projectId
      )
        throw new WorkflowError("invalid", "Snapshot belongs to another project.");
      if (document.kind === "run" && !terminal.has(document.value.status))
        throw new WorkflowError(
          "busy",
          "An active run snapshot cannot be restored or resumed. Inspect it manually.",
        );
      const recovery = path.join(directory, ".otto-recovery");
      await workflowDirectory(store.boundary, recovery, true);
      const backup = path.join(recovery, `${ref.id}.${workflowDigest(current)}.damaged`);
      const existing = await readWorkflowFile(backup);
      if (existing !== null && existing !== current)
        throw new WorkflowError("conflict", "Recovery backup content disagrees with its digest.");
      if (existing === null) await publishWorkflowFile(backup, current, null);
      await publishWorkflowFile(file, snapshot, expectedDamagedRevision);
    });
    this.library.ports.changed?.(ref.scope);
  }
}

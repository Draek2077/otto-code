import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  WorkflowPortablePackage,
  WorkflowAuthoredDocument,
  WorkflowRef,
  WorkflowScope,
  type WorkflowEntry,
  type WorkflowImportOutcome,
  GRAPH_DOCUMENT_FORMAT,
  GRAPH_DOCUMENT_FORMAT_VERSION,
} from "@getpaseo/plugin/otto/workflows";
import { WorkflowLibrary, assertDocumentBudget } from "./library.js";
import { canonicalJson, graphHash } from "./graph-identity.js";
import { validateGraphForExecution } from "./graph-engine.js";
import {
  WorkflowError,
  workflowDigest,
  assertWorkflowId,
  workflowDirectory,
  readWorkflowFile,
  publishWorkflowFile,
  workflowExclusive,
} from "./files.js";

interface ImportReview {
  token: string;
  scope: WorkflowScope;
  operationId: string;
  destination: WorkflowRef;
  document: z.infer<typeof WorkflowAuthoredDocument>;
  source: z.infer<typeof WorkflowPortablePackage>["source"];
  sourceHash: string;
  destinationHash: string;
  expiresAt: number;
}
const receiptSchema = z.object({
  scope: WorkflowScope,
  recordedAt: z.string().optional(),
  actorHostId: z.string().optional(),
  tokenHash: z.string(),
  destination: WorkflowRef,
  destinationHash: z.string(),
  status: z.enum(["committed", "reconciliation_required"]),
});
type Receipt = z.infer<typeof receiptSchema>;
function portable(
  document: z.infer<typeof WorkflowAuthoredDocument>,
): z.infer<typeof WorkflowAuthoredDocument> {
  const value = { ...document.value };
  delete value.workflowStorage;
  delete value.sharedFrom;
  delete value.builtIn;
  if (document.kind === "graph")
    return WorkflowAuthoredDocument.parse({
      kind: "graph",
      value: {
        ...value,
        format: GRAPH_DOCUMENT_FORMAT,
        formatVersion: GRAPH_DOCUMENT_FORMAT_VERSION,
      },
    });
  return WorkflowAuthoredDocument.parse({ kind: document.kind, value });
}
function documentHash(document: z.infer<typeof WorkflowAuthoredDocument>): string {
  return suppliedHash(portable(document));
}
function suppliedHash(document: z.infer<typeof WorkflowAuthoredDocument>): string {
  return document.kind === "graph"
    ? graphHash(document.value)
    : workflowDigest(JSON.stringify(canonicalJson(document)));
}
/** Integrity hashes are self-attested, never authority. Import creates data only after an exact daemon-side review. */
export class WorkflowSharing {
  private readonly reviews = new Map<string, ImportReview>();
  constructor(readonly library: WorkflowLibrary) {}
  async export(ref: WorkflowRef): Promise<WorkflowPortablePackage> {
    const found = await this.library.locate(ref);
    if (found.entry.document.kind === "run")
      throw new WorkflowError(
        "unsupported",
        "Export a definition/template; run history is transferred with its verified result files instead.",
      );
    const document = portable(found.entry.document),
      source = {
        storeKey: found.store.storeKey,
        location:
          found.store.location === "repository" ? ("repository" as const) : ("host" as const),
        source:
          found.store.location === "legacy"
            ? ("legacy-host-library" as const)
            : ("project-store" as const),
        ...(found.store.location !== "repository"
          ? { hostName: this.library.ports.stores.ports.hostLabel }
          : {}),
      };
    const common = {
      schemaVersion: 1 as const,
      source,
      exportedAt: new Date().toISOString(),
      contentHash: documentHash(document),
    };
    if (document.kind === "graph") return { ...common, graph: document.value };
    return { ...common, format: "otto.workflow.document", document };
  }
  async review(input: {
    scope: WorkflowScope;
    exported: WorkflowPortablePackage;
    destination: "repository" | "host";
    operationId: string;
    newId?: string;
  }) {
    if (Buffer.byteLength(JSON.stringify(input.exported)) > 512000)
      throw new WorkflowError("invalid", "Portable Workflow package exceeds 500 KB.");
    assertWorkflowId(input.operationId);
    const exported = WorkflowPortablePackage.parse(input.exported);
    const raw = WorkflowAuthoredDocument.parse(
      "graph" in exported ? { kind: "graph", value: exported.graph } : exported.document,
    );
    if (suppliedHash(raw) !== exported.contentHash)
      throw new WorkflowError(
        "invalid",
        "Workflow package content hash does not match. Re-export the source.",
      );
    assertDocumentBudget(raw);
    if (raw.kind === "graph") {
      const problems = validateGraphForExecution(raw.value);
      if (problems.length) throw new WorkflowError("unsupported", problems.join(" "));
    }
    let document = portable(raw);
    if (input.newId)
      document = WorkflowAuthoredDocument.parse({
        kind: document.kind,
        value: { ...document.value, id: input.newId },
      });
    assertDocumentBudget(document);
    if (document.kind === "graph") {
      const problems = validateGraphForExecution(document.value);
      if (problems.length) throw new WorkflowError("invalid", problems.join(" "));
    }
    const store = await this.library.ports.stores.at(input.scope, input.destination);
    if (await this.library.readAt(store, document.kind, document.value.id, undefined, true))
      throw new WorkflowError(
        "conflict",
        "Destination already has this identity. Choose a new id before reviewing the copy.",
      );
    for (const [token, value] of this.reviews)
      if (value.expiresAt < Date.now()) this.reviews.delete(token);
    if (this.reviews.size >= 16)
      throw new WorkflowError(
        "busy",
        "Too many pending import reviews. Finish or let a review expire.",
      );
    const review: ImportReview = {
      token: randomUUID(),
      scope: input.scope,
      operationId: input.operationId,
      destination: {
        scope: input.scope,
        kind: document.kind,
        id: document.value.id,
        location: input.destination,
        storeKey: store.storeKey,
      },
      document,
      source: exported.source,
      sourceHash: exported.contentHash,
      destinationHash: documentHash(document),
      expiresAt: Date.now() + 300000,
    };
    this.reviews.set(review.token, review);
    return {
      token: review.token,
      scope: review.scope,
      destination: review.destination,
      document: review.document,
      source: review.source,
      sourceHash: review.sourceHash,
      destinationHash: review.destinationHash,
      expiresAt: new Date(review.expiresAt).toISOString(),
      warnings: [
        "Package source and hash are supplied by its exporter. They do not prove authorship or authorize execution.",
        "Import copies data only. Review templates, query commands/network destinations and autonomous nodes again before a run.",
        "Referenced templates must exist in the selected project library; this copy does not silently import or overwrite them.",
      ],
    };
  }
  private receiptFile(operationId: string): string {
    assertWorkflowId(operationId);
    return path.join(
      this.library.ports.stores.ports.home,
      "workflow-imports",
      `${operationId}.json`,
    );
  }
  private async receipt(scope: WorkflowScope, operationId: string) {
    await this.library.ports.stores.project(scope);
    const file = this.receiptFile(operationId),
      bytes = await readWorkflowFile(file);
    if (bytes === null)
      throw new WorkflowError(
        "unavailable",
        "Import receipt is unavailable. Inspect the destination before another operation.",
      );
    const receipt = receiptSchema.parse(JSON.parse(bytes));
    if (receipt.scope.hostId !== scope.hostId || receipt.scope.projectId !== scope.projectId)
      throw new WorkflowError("invalid", "Import receipt belongs to another project/host.");
    return { file, receipt, revision: workflowDigest(bytes) };
  }
  async commit(
    scope: WorkflowScope,
    token: string,
    operationId: string,
  ): Promise<z.infer<typeof WorkflowImportOutcome>> {
    const file = this.receiptFile(operationId);
    await this.library.ports.stores.project(scope);
    const directory = path.dirname(file);
    await workflowDirectory(this.library.ports.stores.ports.home, directory, true);
    return workflowExclusive(`${file}.transaction`, async () => {
      const existing = await readWorkflowFile(file);
      if (existing !== null) {
        const retained = await this.receipt(scope, operationId);
        if (retained.receipt.tokenHash !== workflowDigest(token))
          throw new WorkflowError(
            "conflict",
            "Import operation id was already used. Inspect its receipt before another review.",
          );
        return this.outcome(operationId, retained.receipt);
      }
      const review = this.reviews.get(token);
      if (
        !review ||
        review.expiresAt < Date.now() ||
        review.operationId !== operationId ||
        review.scope.hostId !== scope.hostId ||
        review.scope.projectId !== scope.projectId
      )
        throw new WorkflowError(
          "conflict",
          "Import review expired or belongs to different content/scope.",
        );
      const store = await this.library.ports.stores.at(
        scope,
        review.destination.location === "host" ? "host" : "repository",
      );
      if (store.storeKey !== review.destination.storeKey)
        throw new WorkflowError("conflict", "Destination origin changed since import review.");
      if (
        await this.library.readAt(
          store,
          review.document.kind,
          review.document.value.id,
          undefined,
          true,
        )
      )
        throw new WorkflowError(
          "conflict",
          "Destination changed since review; nothing was overwritten.",
        );
      this.reviews.delete(token);
      const receipt: Receipt = {
        scope,
        recordedAt: new Date().toISOString(),
        actorHostId: this.library.ports.stores.ports.hostId,
        tokenHash: workflowDigest(token),
        destination: review.destination,
        destinationHash: review.destinationHash,
        status: "reconciliation_required",
      };
      const revision = await publishWorkflowFile(file, JSON.stringify(receipt) + "\n", null);
      try {
        const saved = await this.library.write(
          scope,
          review.document,
          null,
          undefined,
          store.location === "host" ? "host" : "repository",
        );
        const verified = await this.library.read(saved.ref);
        if (
          verified.document.kind === "run" ||
          documentHash(verified.document) !== review.destinationHash
        )
          throw new WorkflowError("conflict", "Imported copy did not verify.");
        receipt.destination = verified.ref;
        receipt.status = "committed";
        await publishWorkflowFile(file, JSON.stringify(receipt) + "\n", revision);
        return {
          status: "committed",
          receiptId: operationId,
          entry: verified,
          message: "Workflow copy verified. No execution was authorized or started.",
        };
      } catch {
        return {
          status: "reconciliation_required",
          receiptId: operationId,
          message:
            "Import outcome requires inspection. Source/destination bytes and the prepared receipt are preserved. Do not retry the write.",
        };
      }
    });
  }
  private async outcome(
    operationId: string,
    receipt: Receipt,
  ): Promise<z.infer<typeof WorkflowImportOutcome>> {
    if (receipt.status === "committed") {
      const entry = await this.library.read(receipt.destination);
      if (entry.document.kind !== "run" && documentHash(entry.document) === receipt.destinationHash)
        return {
          status: "committed",
          receiptId: operationId,
          entry,
          message: "Previously verified import; no document write was repeated.",
        };
    }
    return {
      status: "reconciliation_required",
      receiptId: operationId,
      message: "Inspect this import receipt and its exact destination before another write.",
    };
  }
  async inspect(scope: WorkflowScope, operationId: string) {
    const { receipt, revision } = await this.receipt(scope, operationId);
    let entry: WorkflowEntry | null = null;
    try {
      entry = await this.library.read(receipt.destination);
    } catch {
      entry = null;
    }
    return {
      receiptId: operationId,
      scope,
      revision,
      recordedAt: receipt.recordedAt,
      actorHostId: receipt.actorHostId,
      status: receipt.status,
      destination: receipt.destination,
      destinationHash: receipt.destinationHash,
      currentRevision: entry?.revision ?? null,
      matches:
        !!entry &&
        entry.document.kind !== "run" &&
        documentHash(entry.document) === receipt.destinationHash,
    };
  }
  async reconcile(input: {
    scope: WorkflowScope;
    operationId: string;
    expectedRevision: string;
    expectedDocumentRevision: string;
  }): Promise<z.infer<typeof WorkflowImportOutcome>> {
    const { file } = await this.receipt(input.scope, input.operationId);
    return workflowExclusive(`${file}.transaction`, async () => {
      const retained = await this.receipt(input.scope, input.operationId);
      if (retained.revision !== input.expectedRevision)
        throw new WorkflowError("conflict", "Import receipt changed since review.");
      const entry = await this.library.read(retained.receipt.destination);
      if (
        entry.revision !== input.expectedDocumentRevision ||
        entry.document.kind === "run" ||
        documentHash(entry.document) !== retained.receipt.destinationHash
      )
        throw new WorkflowError(
          "conflict",
          "Import destination does not match its reviewed copy. Preserve it for manual recovery.",
        );
      const receipt = { ...retained.receipt, status: "committed" as const };
      await publishWorkflowFile(file, JSON.stringify(receipt) + "\n", retained.revision);
      return {
        status: "committed",
        receiptId: input.operationId,
        entry,
        message:
          "Existing destination verified; only the receipt was reconciled. No document or agent work was replayed.",
      };
    });
  }
  close(): void {
    this.reviews.clear();
  }
}

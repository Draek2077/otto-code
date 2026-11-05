import path from "node:path";
import {
  WorkflowNodeResult,
  type WorkflowRef,
  type WorkflowRunRecord,
  type RunPhaseCandidate,
  workflowRefKey,
} from "@getpaseo/plugin/otto/workflows";
import type { WorkflowLibrary } from "./library.js";
import type { WorkflowStore } from "./stores.js";
import {
  WorkflowError,
  assertWorkflowId,
  workflowDirectory,
  readWorkflowFile,
  publishWorkflowFile,
  workflowDigest,
} from "./files.js";

export function workflowPreview(value: string | undefined, max = 2000): string | undefined {
  if (value === undefined || Buffer.byteLength(value) <= max) return value;
  const note = "\n[Preview truncated. Open the result or its chat for full output.]";
  return (
    new TextDecoder().decode(
      Buffer.from(value).subarray(0, Math.max(0, max - Buffer.byteLength(note))),
      { stream: true },
    ) + note
  );
}
/** Serialization projection only: engines continue using their full, bounded result values. */
export function workflowRunManifest(run: WorkflowRunRecord): WorkflowRunRecord {
  return {
    ...run,
    summary: workflowPreview(run.summary, 4000),
    phases: run.phases.map((phase) => ({
      ...phase,
      task: workflowPreview(phase.task, 2000) ?? phase.title,
      notes: workflowPreview(phase.notes, 2000),
      candidates: phase.candidates?.map(manifestCandidate),
    })),
  };
}
function manifestCandidate(candidate: RunPhaseCandidate): RunPhaseCandidate {
  if (!candidate.outputRevision) return candidate;
  const verdict = candidate.verdict;
  return {
    ...candidate,
    outputStored: true,
    outputFields: undefined,
    summary: workflowPreview(candidate.summary),
    verdict: verdict
      ? {
          verdict: verdict.verdict,
          score: verdict.score,
          summary: workflowPreview(verdict.summary),
        }
      : undefined,
  };
}

/** Immutable result blobs are part of the run's exact origin, never a second history/session store. */
export class WorkflowRunOutputs {
  private readonly captured = new Map<string, Set<string>>();
  constructor(readonly library: WorkflowLibrary) {}
  private directory(store: WorkflowStore, runId: string) {
    assertWorkflowId(runId);
    return path.join(this.library.ports.stores.directory(store, "run"), ".otto-results", runId);
  }
  private file(store: WorkflowStore, runId: string, agentId: string, revision: string) {
    assertWorkflowId(agentId);
    if (!/^[a-f0-9]{64}$/.test(revision))
      throw new WorkflowError("invalid", "Invalid Workflow result digest.");
    return path.join(this.directory(store, runId), `${agentId}.${revision}.json`);
  }
  private async store(ref: WorkflowRef): Promise<WorkflowStore> {
    if (ref.kind !== "run" || ref.location === "legacy" || !ref.storeKey)
      throw new WorkflowError(
        "unsupported",
        "Result blobs require an exact project-owned run origin.",
      );
    const stores = await this.library.ports.stores.resolve(ref);
    if (stores.length !== 1)
      throw new WorkflowError("conflict", "Select one exact Workflow result origin.");
    return stores[0];
  }
  async capture(ref: WorkflowRef, run: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    const snapshot = structuredClone(run);
    const store = await this.store(ref);
    const key = workflowRefKey(ref),
      known = this.captured.get(key) ?? new Set<string>();
    this.captured.set(key, known);
    for (const phase of snapshot.phases)
      for (const candidate of phase.candidates ?? [])
        await this.captureCandidate(store, ref, candidate, known);
    return workflowRunManifest(snapshot);
  }
  private async captureCandidate(
    store: WorkflowStore,
    ref: WorkflowRef,
    candidate: RunPhaseCandidate,
    known: Set<string>,
  ): Promise<void> {
    if (
      candidate.summary === undefined &&
      candidate.outputFields === undefined &&
      candidate.verdict === undefined
    )
      return;
    const result = WorkflowNodeResult.parse({
      version: 1,
      runId: ref.id,
      agentId: candidate.agentId,
      summary: candidate.summary ?? null,
      fields: candidate.outputFields ?? null,
      verdict: candidate.verdict ?? null,
    });
    const bytes = JSON.stringify(result) + "\n";
    if (Buffer.byteLength(bytes) > 512000)
      throw new WorkflowError(
        "invalid",
        "Workflow result exceeds 512 KB. Return references to larger files.",
      );
    const revision = workflowDigest(bytes);
    if (!known.has(revision)) {
      await this.publish(store, ref.id, candidate.agentId, revision, bytes);
      known.add(revision);
    }
    candidate.outputRevision = revision;
    candidate.outputStored = true;
  }
  private async publish(
    store: WorkflowStore,
    runId: string,
    agentId: string,
    revision: string,
    bytes: string,
  ): Promise<void> {
    await workflowDirectory(store.boundary, this.directory(store, runId), true);
    const file = this.file(store, runId, agentId, revision),
      existing = await readWorkflowFile(file, 512000);
    if (existing !== null) {
      if (existing !== bytes)
        throw new WorkflowError("conflict", "Immutable Workflow result bytes changed.");
      return;
    }
    await publishWorkflowFile(file, bytes, null);
  }
  async read(ref: WorkflowRef, agentId: string, revision: string) {
    const entry = await this.library.read(ref);
    if (
      entry.document.kind !== "run" ||
      !entry.document.value.phases.some((p) =>
        p.candidates?.some((c) => c.agentId === agentId && c.outputRevision === revision),
      )
    )
      throw new WorkflowError(
        "conflict",
        "This result no longer matches the selected run revision.",
      );
    const store = await this.store(ref),
      bytes = await this.bytes(store, ref.id, agentId, revision);
    return WorkflowNodeResult.parse(JSON.parse(bytes));
  }
  private async bytes(
    store: WorkflowStore,
    runId: string,
    agentId: string,
    revision: string,
  ): Promise<string> {
    await workflowDirectory(store.boundary, this.directory(store, runId));
    const bytes = await readWorkflowFile(this.file(store, runId, agentId, revision), 512000);
    if (bytes === null || workflowDigest(bytes) !== revision)
      throw new WorkflowError(
        "conflict",
        "Workflow result is missing or changed. Its run record is preserved.",
      );
    const result = WorkflowNodeResult.parse(JSON.parse(bytes));
    if (result.runId !== runId || result.agentId !== agentId)
      throw new WorkflowError("invalid", "Workflow result identity does not match its manifest.");
    return bytes;
  }
  async copy(
    source: WorkflowRef,
    destination: WorkflowStore,
    run: WorkflowRunRecord,
  ): Promise<void> {
    const stored = run.phases.flatMap((p) => p.candidates ?? []).filter((c) => c.outputRevision);
    if (!stored.length) return;
    const origin = await this.store(source);
    for (const candidate of stored) {
      const revision = candidate.outputRevision!;
      const bytes = await this.bytes(origin, run.id, candidate.agentId, revision);
      await this.publish(destination, run.id, candidate.agentId, revision, bytes);
    }
  }
  forget(ref: WorkflowRef): void {
    this.captured.delete(workflowRefKey(ref));
  }
}

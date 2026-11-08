import path from "node:path";
import { recoverWorkflowLock } from "../workflows/locks.js";
import type {
  ScheduleTransferInspection,
  ScheduleTransferLookup,
  ScheduleTransferReconciliation,
  ScheduleTransferLockRecovery,
} from "@getpaseo/plugin/otto/schedules";
import { inspectScheduleTransferLocks, scheduleTransferLockFiles } from "./transfer-locks.js";
import type { ScheduleRegistry, ScheduleTransferEntry } from "./registry.js";
import type { ProjectScheduleScope } from "./stores.js";
import {
  assertScheduleId,
  scheduleDirectory,
  scheduleDigest,
  scheduleExclusive,
  publishScheduleFile,
  readScheduleFile,
  ScheduleError,
} from "./files.js";
import {
  scheduleTransferPlan,
  type ScheduleTransferInput,
  type ScheduleTransferPlan,
} from "./transfer-plan.js";
import {
  scheduleTransferInput,
  scheduleTransferFingerprint,
  scheduleTransferProof,
  readScheduleTransfer,
  retainedScheduleTransferPlan,
  hasPendingScheduleTransfer,
  type ScheduleTransferRecord,
} from "./transfer-record.js";

type Retained = NonNullable<Awaited<ReturnType<typeof readScheduleTransfer>>>;
export type ScheduleTransferReconcile = ScheduleTransferReconciliation;
/** Explicit storage transactions only. The scheduler owns claims and never sees
 * pending transfer records. Durable receipts do not grant automatic replay. */
export class ScheduleTransfers {
  private closed = false;
  constructor(
    readonly registry: ScheduleRegistry,
    readonly now = () => new Date().toISOString(),
  ) {}
  close() {
    this.closed = true;
  }
  private assertOpen() {
    if (this.closed)
      throw new ScheduleError(
        "unavailable",
        "Schedules host is stopping. Inspect any admitted transfer before continuing.",
      );
  }
  private async file(scope: ProjectScheduleScope, operationId: string, create = false) {
    assertScheduleId(operationId);
    const project = await this.registry.ports.stores.project(scope);
    if (create && project.record.archivedAt)
      throw new ScheduleError(
        "invalid",
        "Restore the owning project before transferring its Schedules.",
      );
    const home = this.registry.ports.stores.ports.home;
    const directory = path.join(home, "schedule-transfers", operationId);
    const exists = await scheduleDirectory(home, directory, create);
    return { file: path.join(directory, "receipt.json"), directory, exists };
  }
  private checkScope(
    record: ScheduleTransferRecord,
    scope: ProjectScheduleScope,
    operationId: string,
  ) {
    if (
      record.input.scope.hostId !== scope.hostId ||
      record.input.scope.projectId !== scope.projectId ||
      record.input.operationId !== operationId
    )
      throw new ScheduleError(
        "invalid",
        "Select the transfer's owning host, project and operation.",
      );
  }
  private async retained(scope: ProjectScheduleScope, operationId: string) {
    const resolved = await this.file(scope, operationId);
    const retained = resolved.exists ? await readScheduleTransfer(resolved.file) : null;
    if (!retained)
      throw new ScheduleError(
        "invalid",
        "This transfer receipt is unavailable. Original records were not replayed.",
      );
    this.checkScope(retained.record, scope, operationId);
    return { ...resolved, retained };
  }
  async inspect(
    scope: ProjectScheduleScope,
    operationId: string,
  ): Promise<ScheduleTransferInspection> {
    const { file, retained } = await this.retained(scope, operationId);
    const { record } = retained;
    const sourceBytes = await this.registry.transferBytes(record.input.source);
    const destinationBytes = await this.registry.transferBytes(record.destination);
    const digest = (bytes: string | null) => (bytes === null ? null : scheduleDigest(bytes));
    const sourceDigest = digest(sourceBytes),
      destinationDigest = digest(destinationBytes);
    const locks = await inspectScheduleTransferLocks(this.registry, file, record);
    return {
      found: true,
      scope,
      operationId,
      revision: retained.revision,
      source: record.input.source,
      destination: record.destination,
      operation: record.input.operation,
      status: record.status,
      needsReconciliation:
        record.status === "reconciliation_required" ||
        hasPendingScheduleTransfer(sourceBytes, operationId) ||
        hasPendingScheduleTransfer(destinationBytes, operationId),
      recordedAt: record.at,
      sourceDigest,
      destinationDigest,
      sourceMatches:
        sourceDigest === record.proof.originalSource || sourceDigest === record.proof.fencedSource,
      destinationMatches:
        destinationDigest === record.proof.pendingDestination ||
        destinationDigest === record.proof.committedDestination,
      locks,
    };
  }
  /** Admission may be interrupted before a receipt exists. Report only packet
   * locks then; no source/destination path or transfer authority can be inferred. */
  async lookup(scope: ProjectScheduleScope, operationId: string): Promise<ScheduleTransferLookup> {
    const resolved = await this.file(scope, operationId);
    if (resolved.exists && (await readScheduleTransfer(resolved.file)))
      return this.inspect(scope, operationId);
    return {
      found: false,
      scope,
      operationId,
      locks: resolved.exists
        ? await inspectScheduleTransferLocks(this.registry, resolved.file, null)
        : [],
    };
  }
  async transfer(raw: ScheduleTransferInput) {
    this.assertOpen();
    const input = scheduleTransferInput.parse(raw);
    const { file, directory } = await this.file(input.scope, input.operationId, true);
    this.assertOpen();
    await scheduleExclusive(`${file}.transaction`, async () => {
      const previous = await readScheduleTransfer(file);
      if (previous) {
        this.checkScope(previous.record, input.scope, input.operationId);
        if (previous.record.fingerprint !== scheduleTransferFingerprint(input))
          throw new ScheduleError(
            "conflict",
            "This transfer operation already refers to different settings. Inspect its receipt.",
          );
        return; // Lost-response recovery is a read, never a repeat of source/destination effects.
      }
      await this.registry.transferRecord(
        input.source,
        input.expectedRevision,
        input.operationId,
        async (source) => {
          if (!(await this.registry.entry(source.ref.id, source.ref)))
            throw new ScheduleError("conflict", "Schedule source is unavailable or ambiguous.");
          await this.begin(input, source, file, directory);
        },
      );
    });
    return this.inspect(input.scope, input.operationId);
  }
  private async begin(
    input: ScheduleTransferInput,
    source: ScheduleTransferEntry,
    file: string,
    directory: string,
  ) {
    if (
      source.ref.scope.hostId !== input.scope.hostId ||
      (source.ref.scope.projectId !== null && source.ref.scope.projectId !== input.scope.projectId)
    )
      throw new ScheduleError(
        "invalid",
        "A Schedule transfer must keep its owning host and project. Assign a legacy record explicitly.",
      );
    if (source.schedule.otto?.transfer?.phase === "pending")
      throw new ScheduleError(
        "busy",
        "Reconcile the retained transfer before starting another operation.",
      );
    const stores = this.registry.ports.stores;
    const destination = (await stores.locations(input.scope)).find(
      (origin) => origin.location === input.destination,
    );
    if (!destination || destination.storeKey === source.ref.storeKey)
      throw new ScheduleError("invalid", "Choose a different Schedule storage location.");
    const pinned = await stores.pin(destination);
    const at = this.now();
    const plan = scheduleTransferPlan(source, input, pinned, at);
    if ((await this.registry.transferBytes(plan.destinationRef)) !== null)
      throw new ScheduleError(
        "conflict",
        "The destination already contains this Schedule identity. Inspect both origins.",
      );
    this.assertOpen();
    const backup = path.join(directory, "source.json");
    const previousBackup = await readScheduleFile(backup);
    if (previousBackup !== null && previousBackup !== source.bytes)
      throw new ScheduleError(
        "conflict",
        "An earlier transfer backup has different content. Inspect it before continuing.",
      );
    if (previousBackup === null) await publishScheduleFile(backup, source.bytes, null);
    const record: ScheduleTransferRecord = {
      version: 1,
      input,
      fingerprint: scheduleTransferFingerprint(input),
      at,
      destination: plan.destinationRef,
      status: "reconciliation_required",
      proof: scheduleTransferProof(plan),
    };
    const revision = await this.save(file, record, null);
    try {
      this.assertOpen();
      await this.registry.publishTransfer(
        source.origin,
        plan.fencedSource,
        record.proof.originalSource,
      );
      this.assertOpen();
      await this.registry.publishTransfer(pinned, plan.pendingDestination, null);
      await this.commit(file, { record, revision }, plan);
    } catch {
      // A failed publication can have committed. Keep both fences and the receipt;
      // only a later inspected decision can complete or abort this operation.
    }
  }
  private save(file: string, record: ScheduleTransferRecord, revision: string | null) {
    return publishScheduleFile(file, JSON.stringify(record, null, 2) + "\n", revision);
  }
  private async current(record: ScheduleTransferRecord) {
    const source = await this.registry.transferEntry(record.input.source);
    const destination = await this.registry.transferEntry(record.destination);
    return { source, destination };
  }
  private async commit(file: string, retained: Retained, plan: ScheduleTransferPlan) {
    this.assertOpen();
    const { record } = retained;
    const current = await this.current(record);
    const destinationDigest = current.destination
      ? scheduleDigest(current.destination.bytes)
      : null;
    if (
      !current.destination ||
      ![record.proof.pendingDestination, record.proof.committedDestination].includes(
        destinationDigest!,
      )
    )
      throw new ScheduleError("conflict", "Destination no longer matches the transfer proof.");
    if (record.input.operation === "move") await this.retireSource(record, current.source);
    else if (
      !current.source ||
      ![record.proof.originalSource, record.proof.fencedSource].includes(
        scheduleDigest(current.source.bytes),
      )
    )
      throw new ScheduleError(
        "conflict",
        "Copy source no longer matches its original or fenced bytes.",
      );
    this.assertOpen();
    if (record.status !== "committed") {
      record.status = "committed";
      await this.save(file, record, retained.revision);
    }
    this.assertOpen();
    if (destinationDigest === record.proof.pendingDestination)
      await this.registry.publishTransfer(
        current.destination.origin,
        plan.committedDestination,
        destinationDigest,
      );
    this.assertOpen();
    if (
      record.input.operation === "copy" &&
      current.source &&
      scheduleDigest(current.source.bytes) === record.proof.fencedSource
    )
      await this.registry.publishTransfer(
        current.source.origin,
        plan.originalSource,
        record.proof.fencedSource,
      );
  }
  private async retireSource(record: ScheduleTransferRecord, source: ScheduleTransferEntry | null) {
    if (!source) return;
    if (scheduleDigest(source.bytes) !== record.proof.fencedSource)
      throw new ScheduleError(
        "conflict",
        "Move source no longer matches its fenced bytes. It was not retired.",
      );
    this.assertOpen();
    await this.registry.retireTransfer(source);
  }
  async reconcile(input: ScheduleTransferReconcile) {
    this.assertOpen();
    const { file } = await this.retained(input.scope, input.operationId);
    await scheduleExclusive(`${file}.transaction`, async () => {
      const inspected = await this.inspect(input.scope, input.operationId);
      const retained = await readScheduleTransfer(file);
      if (
        !retained ||
        inspected.revision !== input.expectedRevision ||
        inspected.sourceDigest !== input.expectedSourceDigest ||
        inspected.destinationDigest !== input.expectedDestinationDigest
      )
        throw new ScheduleError(
          "conflict",
          "Transfer content changed since inspection. Inspect both origins again.",
        );
      const plan = await retainedScheduleTransferPlan(file, retained.record);
      const { source, destination } = await this.current(retained.record);
      const owner = source ?? destination;
      if (!owner)
        throw new ScheduleError(
          "conflict",
          "Neither transfer record remains. Inspect retained recovery bytes on the owning host.",
        );
      await this.registry.transferRecord(owner.ref, owner.revision, input.operationId, async () => {
        if (input.decision === "abort") await this.abort(file, retained, plan);
        else {
          if (retained.record.status === "aborted")
            throw new ScheduleError("conflict", "An aborted transfer cannot be completed.");
          await this.commit(file, retained, plan);
        }
      });
    });
    return this.inspect(input.scope, input.operationId);
  }
  private async abort(file: string, retained: Retained, plan: ScheduleTransferPlan) {
    const { record } = retained;
    const { source, destination } = await this.current(record);
    if (
      record.status === "committed" ||
      destination ||
      !source ||
      ![record.proof.originalSource, record.proof.fencedSource].includes(
        scheduleDigest(source.bytes),
      )
    )
      throw new ScheduleError(
        "conflict",
        "Only a transfer with no destination and an unchanged source can be aborted. No record was removed.",
      );
    this.assertOpen();
    if (record.status !== "aborted") {
      record.status = "aborted";
      await this.save(file, record, retained.revision);
    }
    this.assertOpen();
    if (scheduleDigest(source.bytes) === record.proof.fencedSource)
      await this.registry.publishTransfer(
        source.origin,
        plan.originalSource,
        record.proof.fencedSource,
      );
  }
  async recoverLock(input: ScheduleTransferLockRecovery) {
    this.assertOpen();
    const { file, exists } = await this.file(input.scope, input.operationId);
    const retained = exists ? await readScheduleTransfer(file) : null;
    if (retained) this.checkScope(retained.record, input.scope, input.operationId);
    if ((retained?.revision ?? null) !== input.expectedRevision || input.writersStopped !== true)
      throw new ScheduleError(
        "conflict",
        "Inspect the current receipt and explicitly verify that other writers stopped before recovering a lock.",
      );
    const files = await scheduleTransferLockFiles(this.registry, file, retained?.record ?? null);
    const lockFile = files[input.kind];
    if (!lockFile)
      throw new ScheduleError(
        "invalid",
        "No retained receipt identifies that source or destination lock.",
      );
    this.assertOpen();
    await recoverWorkflowLock(lockFile, input.expectedLockRevision);
    return this.lookup(input.scope, input.operationId);
  }
}

import type { z } from "zod";
import type * as rpc from "@getpaseo/plugin/otto/schedules";
import type { ScheduleService } from "../../schedule/service.js";
import type { ScheduleActionPort } from "./service.js";
import { scheduleCreationId, type ScheduleRegistry } from "./registry.js";
import type { ScheduleTarget, ScheduleVersionMutation, StoredSchedule } from "./types.js";
import { assertScheduleMutation, scheduleRevision } from "./legacy.js";
import { scheduleDocument } from "./projection.js";
import { ScheduleError, scheduleDigest } from "./files.js";

type ReviewInput = z.infer<typeof rpc.reviewScheduleTarget.input>;
type ReviewResult = Awaited<ReturnType<ScheduleActionPort["review"]>>;
export interface ScheduleTargetActions {
  review(input: ReviewInput): Promise<ReviewResult>;
  /** Revalidate saved approval against the target owner. Never approve new authority here. */
  validate(input: {
    scope: z.infer<typeof rpc.ScheduleProjectScope>;
    target: rpc.OttoScheduleTarget;
  }): Promise<void>;
  /** Original host-global native records retain their canonical native policy. */
  validateLegacyNative(
    target: Extract<ScheduleTarget, { type: "agent" | "new-agent" }>,
  ): Promise<void>;
  cancel(scheduleId: string, runId: string): Promise<void>;
}
export interface ScheduleActionPorts {
  registry: ScheduleRegistry;
  scheduler: Pick<ScheduleService, "create" | "update" | "pause" | "resume" | "delete" | "runOnce">;
  targets: ScheduleTargetActions;
  /** A background run may fail to persist settlement after its admission response was sent. */
  onSettlementError(scheduleId: string, error: unknown): void;
}
/** API actions delegate cadence/claims/history to Paseo. No timers, providers, or alternate run loop. */
export class ScheduleActions implements ScheduleActionPort {
  private closed = false;
  constructor(readonly ports: ScheduleActionPorts) {}
  private assertOpen() {
    if (this.closed) throw new ScheduleError("unavailable", "Schedules host is stopping.");
  }
  private async project(scope: rpc.ScheduleScope) {
    this.assertOpen();
    const project = await this.ports.registry.ports.stores.project(scope);
    if (project.record.archivedAt)
      throw new ScheduleError(
        "invalid",
        "Restore the owning project before changing this Schedule.",
      );
    return project;
  }
  private async current(ref: rpc.ScheduleRef, expectedRevision: string) {
    this.assertOpen();
    const entry = await this.ports.registry.entry(ref.id, ref);
    if (!entry) throw new ScheduleError("invalid", "Schedule is unavailable at this origin.");
    assertScheduleMutation(entry.schedule, { ref, expectedRevision });
    return entry;
  }
  private async document(schedule: StoredSchedule) {
    const entry = await this.ports.registry.entry(schedule.id);
    if (!entry)
      throw new ScheduleError(
        "unavailable",
        "Saved Schedule is unavailable. Inspect storage before creating another.",
      );
    return scheduleDocument(entry);
  }
  private scope(ref: rpc.ScheduleRef) {
    if (!ref.scope.projectId)
      throw new ScheduleError(
        "invalid",
        "Assign this legacy Schedule to its project before reviewing or running it from this editor.",
      );
    return { hostId: ref.scope.hostId, projectId: ref.scope.projectId };
  }
  private async validateExecution(ref: rpc.ScheduleRef, target: ScheduleTarget) {
    if (ref.scope.projectId) {
      const scope = this.scope(ref);
      await this.project(scope);
      this.assertOpen();
      return this.ports.targets.validate({ scope, target });
    }
    // Original Paseo native records execute from their existing host-global origin.
    // This does not create projectless Workflow or Artifact authority.
    if (ref.location === "legacy" && (target.type === "agent" || target.type === "new-agent"))
      return this.ports.targets.validateLegacyNative(target);
    throw new ScheduleError("invalid", "Select the owning project for this Schedule target.");
  }
  async review(input: ReviewInput) {
    await this.project(input.scope);
    this.assertOpen();
    return this.ports.targets.review(input);
  }
  async create(input: z.infer<typeof rpc.createSchedule.input>) {
    this.assertOpen();
    await this.ports.registry.ports.stores.project(input.scope);
    const fingerprint = scheduleDigest(
      JSON.stringify([input.scope, input.location ?? null, input.draft]),
    );
    await this.ports.registry.refresh(true);
    const replay = await this.ports.registry.entry(
      scheduleCreationId(input.scope, input.operationId),
    );
    if (replay) {
      if (replay.schedule.otto?.creation?.fingerprint !== fingerprint)
        throw new ScheduleError(
          "conflict",
          "This create operation already saved different Schedule settings. Reload the saved Schedule.",
        );
      return scheduleDocument(replay);
    }
    const project = await this.project(input.scope);
    this.assertOpen();
    await this.ports.targets.validate({ scope: input.scope, target: input.draft.target });
    const stores = this.ports.registry.ports.stores;
    const origin = input.location
      ? (await stores.locations(input.scope, project)).find(
          (item) => item.location === input.location,
        )
      : await stores.selected(input.scope, project);
    if (!origin) throw new ScheduleError("invalid", "Select an available Schedule store.");
    this.assertOpen();
    const saved = await this.ports.scheduler.create({
      ...input.draft,
      otto: {
        version: 1,
        scope: origin.scope,
        location: origin.location,
        storeKey: origin.storeKey,
        creation: {
          operationId: input.operationId,
          fingerprint,
        },
      },
    });
    return this.document(saved);
  }
  async update(input: z.infer<typeof rpc.updateSchedule.input>) {
    await this.current(input.ref, input.expectedRevision);
    const scope = this.scope(input.ref);
    await this.project(scope);
    this.assertOpen();
    await this.ports.targets.validate({ scope, target: input.draft.target });
    this.assertOpen();
    const saved = await this.ports.scheduler.update({
      ...input.draft,
      id: input.ref.id,
      mutation: { ref: input.ref, expectedRevision: input.expectedRevision, requireIdle: true },
    });
    return this.document(saved);
  }
  async control(
    input: z.infer<typeof rpc.controlSchedule.input>,
  ): ReturnType<ScheduleActionPort["control"]> {
    const entry = await this.current(input.ref, input.expectedRevision);
    const mutation: ScheduleVersionMutation = {
      ref: input.ref,
      expectedRevision: input.expectedRevision,
    };
    const { command } = input;
    switch (command.type) {
      case "pause":
        return {
          entry: await this.document(await this.ports.scheduler.pause(input.ref.id, mutation)),
        };
      case "delete":
        await this.ports.scheduler.delete(input.ref.id, mutation);
        return { deleted: true };
      case "cancel":
        if (
          !entry.schedule.runs.some((run) => run.id === command.runId && run.status === "running")
        )
          throw new ScheduleError(
            "conflict",
            "Select the exact running Schedule attempt to cancel.",
          );
        await this.ports.targets.cancel(input.ref.id, command.runId);
        return { entry: await this.document(entry.schedule) };
      case "resume":
      case "run-once": {
        this.assertOpen();
        if (entry.schedule.otto?.repairReason && !command.userConfirmedInspection)
          throw new ScheduleError(
            "conflict",
            "Inspect the previous outcome and explicitly acknowledge it before running again.",
          );
        await this.validateExecution(input.ref, entry.schedule.target);
        this.assertOpen();
        mutation.repairReviewed = command.userConfirmedInspection === true;
        mutation.requireIdle = true;
        if (command.type === "resume")
          return {
            entry: await this.document(await this.ports.scheduler.resume(input.ref.id, mutation)),
          };
        return this.runOnce(input.ref, mutation);
      }
    }
  }
  private runOnce(ref: rpc.ScheduleRef, mutation: ScheduleVersionMutation) {
    // A Human gate may remain open for days. Return only the durable admission;
    // the existing scheduler/target owners retain and settle the actual work.
    return new Promise<{ entry: rpc.ScheduleDocument; acceptedRunId: string }>(
      (resolve, reject) => {
        let admitted = false;
        const execution = this.ports.scheduler.runOnce(ref.id, mutation, (schedule, runId) => {
          admitted = true;
          resolve({
            entry: scheduleDocument({ ref, revision: scheduleRevision(schedule), schedule }),
            acceptedRunId: runId,
          });
        });
        void execution.then(
          () => {
            if (!admitted)
              reject(
                new ScheduleError(
                  "busy",
                  "No Schedule attempt was admitted. Refresh before trying again.",
                ),
              );
            return undefined;
          },
          (error: unknown) => {
            if (admitted) this.ports.onSettlementError(ref.id, error);
            else reject(error);
          },
        );
      },
    );
  }
  async close() {
    this.closed = true;
  }
}

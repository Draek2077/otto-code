import type {
  WorkflowRef,
  WorkflowSeats,
  WorkflowLimits,
  WorkflowScheduleSource,
} from "@getpaseo/plugin/otto/workflows";
import type { WorkflowHost } from "./host.js";
import { WorkflowError, workflowDigest } from "./files.js";

export interface WorkflowScheduleInvocation {
  source: WorkflowRef;
  expectedRevision: string;
  workspaceId: string;
  seats: WorkflowSeats;
  limits: WorkflowLimits;
  inputs: Record<string, string>;
  scheduleSource: WorkflowScheduleSource;
  allowTemplateCode?: boolean;
  allowQueryEffects?: boolean;
}
/** Adapter only: the existing scheduler owns cadence/admission. No second scheduler or implicit retries. */
export class WorkflowScheduleAdapter {
  constructor(readonly host: WorkflowHost) {}
  async start(input: WorkflowScheduleInvocation) {
    const entry = await this.host.library.read(input.source);
    if (entry.document.kind !== "graph" || entry.revision !== input.expectedRevision)
      throw new WorkflowError(
        "conflict",
        "Scheduled Graph changed. Review and save its schedule target again.",
      );
    const operationId = `schedule-${workflowDigest(JSON.stringify(input.scheduleSource)).slice(0, 40)}`;
    const review = await this.host.review(
      input.source.scope,
      input.workspaceId,
      {
        kind: "graph",
        graph: entry.document.value,
        source: { ref: entry.ref, revision: entry.revision },
        seats: input.seats,
        limits: input.limits,
        inputs: input.inputs,
        allowTemplateCode: input.allowTemplateCode,
        allowQueryEffects: input.allowQueryEffects,
      },
      operationId,
      input.scheduleSource,
    );
    return this.host.start(input.source.scope, review.token, operationId);
  }
  async cancel(ref: WorkflowRef, note = "Canceled by the owning Schedule.") {
    const entry = await this.host.library.read(ref);
    if (entry.document.kind !== "run" || !entry.document.value.scheduleSource)
      throw new WorkflowError("invalid", "This is not a Schedule-owned Workflow run.");
    await this.host.control(ref, entry.revision, "cancel", undefined, note);
    await this.host.settled(ref);
    return this.host.library.read(ref);
  }
}

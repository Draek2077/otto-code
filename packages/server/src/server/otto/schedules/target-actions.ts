import type { ArtifactSelection } from "@getpaseo/plugin/otto/artifacts";
import type { z } from "zod";
import type { ScheduleTargetActions } from "./actions.js";
import type { ScheduleTarget } from "./types.js";
import type { ProjectScheduleScope } from "./stores.js";
import type { SavedWorkflowScheduleAdapter } from "./workflow-adapter.js";
import type { ArtifactScheduleAdapter } from "./artifact-adapter.js";
import type { ScheduleRuntime } from "./runtime.js";
import { ScheduleError } from "./files.js";

export interface ScheduleTargetActionPorts {
  workflows: SavedWorkflowScheduleAdapter;
  artifacts: ArtifactScheduleAdapter;
  runtime: Pick<ScheduleRuntime, "cancel">;
  validateNative(
    target: Extract<ScheduleTarget, { type: "agent" | "new-agent" }>,
    scope: ProjectScheduleScope | null,
  ): Promise<string>;
  validateSelection(
    selection: z.infer<typeof ArtifactSelection>,
    scope: ProjectScheduleScope,
  ): Promise<void>;
  cancelNative(scheduleId: string, runId: string): Promise<void>;
  isNativeRun(scheduleId: string, runId: string): Promise<boolean>;
}
/** Review obtains owner fingerprints without starting a job. Save/fire validation
 * checks those fingerprints; it never silently approves changed authority/design. */
export function createScheduleTargetActions(
  ports: ScheduleTargetActionPorts,
): ScheduleTargetActions {
  return {
    async validateLegacyNative(target) {
      await ports.validateNative(target, null);
    },
    async review({ scope, target }) {
      if (target.type === "workflow") {
        const reviewed = await ports.workflows.reviewDetails(
          { ...target, approval: { ...target.approval, policyFingerprint: "0".repeat(64) } },
          scope,
        );
        return { target: reviewed.target, summary: reviewed.title, autopilot: reviewed.autopilot };
      }
      if (target.type === "artifact-update") {
        if (target.update.type === "instruction")
          await ports.validateSelection(target.update.selection, scope);
        const reviewed = await ports.artifacts.review(target, scope);
        return { target: reviewed.target, summary: reviewed.title, autopilot: null };
      }
      return { target, summary: await ports.validateNative(target, scope), autopilot: null };
    },
    async validate({ scope, target }) {
      if (target.type === "workflow") {
        const prepared = await ports.workflows.prepare(target, scope, {
          scheduleId: "validation",
          runId: "validation",
        });
        prepared.release?.();
      } else if (target.type === "artifact-update") {
        if (target.update.type === "instruction")
          await ports.validateSelection(target.update.selection, scope);
        await ports.artifacts.prepare(target, scope, {
          scheduleId: "validation",
          runId: "validation",
        });
      } else await ports.validateNative(target, scope);
    },
    async cancel(scheduleId, runId) {
      if (!scheduleId || !runId)
        throw new ScheduleError("invalid", "Select the exact Schedule run.");
      if (await ports.isNativeRun(scheduleId, runId)) await ports.cancelNative(scheduleId, runId);
      else await ports.runtime.cancel(scheduleId, runId);
    },
  };
}

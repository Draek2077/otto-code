import type { ArtifactDaemonService } from "../artifacts/service.js";
import type { ArtifactDataGeneration } from "../artifacts/data-generation.js";
import type { WorkflowScheduleAdapter } from "../workflows/schedule-adapter.js";
import { ArtifactScheduleAdapter } from "./artifact-adapter.js";
import { SavedWorkflowScheduleAdapter } from "./workflow-adapter.js";
import { ScheduleStores, type ScheduleStorePorts } from "./stores.js";
import { ScheduleRegistry, type ScheduleRegistryPorts } from "./registry.js";
import { ScheduleRuntime } from "./runtime.js";
import { ScheduleError } from "./files.js";
import { ScheduleNativeOwner, type ScheduleNativePorts } from "./native-owner.js";
import { ScheduleChanges } from "./changes.js";

export interface ScheduleCompositionPorts extends ScheduleStorePorts {
  projects: ScheduleRegistryPorts["projects"];
  workflows: WorkflowScheduleAdapter;
  artifacts: Pick<ArtifactDaemonService, "locate" | "change">;
  generateData: ArtifactDataGeneration;
  native?: Omit<ScheduleNativePorts, "registry">;
}

/** Compose owners, never another scheduler. Construction performs no discovery,
 * provider work, timer registration, file writes or model admission. */
export function createScheduleComposition(ports: ScheduleCompositionPorts) {
  const stores = new ScheduleStores(ports);
  const changes = new ScheduleChanges(ports.hostId);
  const registry: ScheduleRegistry = new ScheduleRegistry({
    stores,
    projects: ports.projects,
    changed: (scope) => changes.publish(scope),
    executionHeld: (scheduleId): boolean => runtime.ownsExecution(scheduleId),
  });
  const workflows = new SavedWorkflowScheduleAdapter(ports.workflows);
  const artifacts = new ArtifactScheduleAdapter({
    artifacts: ports.artifacts,
    generate: ports.generateData,
  });
  const native = ports.native ? new ScheduleNativeOwner({ ...ports.native, registry }) : undefined;
  const runtime = new ScheduleRuntime({
    native,
    onLateError: ports.native?.onLateError,
    prepare: async (schedule, runId) => {
      const meta = schedule.otto;
      if (!meta?.scope.projectId)
        throw new ScheduleError(
          "invalid",
          "Assign this Schedule to its owning project before running it.",
        );
      const scope = { hostId: meta.scope.hostId, projectId: meta.scope.projectId };
      const project = await stores.project(scope);
      if (project.record.archivedAt)
        throw new ScheduleError(
          "invalid",
          "Restore the owning project before resuming this Schedule.",
        );
      const identity = { scheduleId: schedule.id, runId };
      if (schedule.target.type === "workflow")
        return workflows.prepare(schedule.target, scope, identity);
      if (schedule.target.type === "artifact-update")
        return artifacts.prepare(schedule.target, scope, identity);
      throw new ScheduleError("unsupported", "Native agent Schedules use Paseo's execution owner.");
    },
  });
  return { stores, registry, runtime, workflows, artifacts, native, changes };
}

import type { ScheduleService } from "../../schedule/service.js";
import type { createScheduleComposition } from "./composition.js";
import type { ScheduleNativePolicy } from "./native-policy.js";
import { ScheduleActions } from "./actions.js";
import { createScheduleTargetActions } from "./target-actions.js";
import { ScheduleDaemonService } from "./service.js";
import { ScheduleError } from "./files.js";

interface ScheduleApiPorts {
  targets: ReturnType<typeof createScheduleComposition>;
  scheduler: ScheduleService;
  policy: ScheduleNativePolicy;
  onSettlementError(scheduleId: string, error: unknown): void;
}
/** Requires real owners for all targets. It never substitutes no-op executors or
 * reconstructs an old run's ownership from a Schedule's current target. */
export function createScheduleApi(ports: ScheduleApiPorts) {
  const { targets } = ports;
  const native = targets.native;
  if (!native) throw new Error("Compose native Schedule ownership before registering its API.");
  const actions = new ScheduleActions({
    registry: targets.registry,
    scheduler: ports.scheduler,
    onSettlementError: ports.onSettlementError,
    targets: createScheduleTargetActions({
      ...targets,
      validateNative: (target, scope) => ports.policy.validate(target, scope),
      validateSelection: (selection, scope) => ports.policy.validateSelection(selection, scope),
      cancelNative: (scheduleId, runId) => native.cancel(scheduleId, runId),
      isNativeRun: async (scheduleId, runId) => {
        const schedule = await targets.registry.get(scheduleId);
        const run = schedule?.runs.find((item) => item.id === runId);
        const target = run?.otto?.requestedTarget;
        if (!target)
          throw new ScheduleError(
            "conflict",
            "This run has no current-process ownership proof. Inspect its retained history; another chat will not be canceled.",
          );
        return target.type === "agent" || target.type === "new-agent";
      },
    }),
  });
  return new ScheduleDaemonService(targets.registry, actions, targets.changes);
}

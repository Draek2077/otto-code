import { ScheduleRequestError } from "./api";
import type { ScheduleScope } from "@getpaseo/plugin/otto/schedules";

interface VersionObservation extends ScheduleScope {
  version: number | undefined;
}
/** A cursor belongs to this scope's current page, not another project's clock.
 * A restarted daemon may legitimately publish a lower counter. */
export function observeScheduleVersion(
  previous: VersionObservation | undefined,
  scope: ScheduleScope,
  version: number | undefined,
): VersionObservation {
  const sameScope = previous?.hostId === scope.hostId && previous.projectId === scope.projectId;
  return { ...scope, version: version ?? (sameScope ? previous.version : undefined) };
}

/** Only canonical library reads use this bounded query-cache recovery. Neither
 * mutations, target execution, watches nor unknown transport outcomes use it. */
export function retryScheduleObservation(failureCount: number, error: unknown) {
  return (
    failureCount < 2 &&
    error instanceof ScheduleRequestError &&
    error.origin === "host-reply" &&
    error.code === "busy"
  );
}

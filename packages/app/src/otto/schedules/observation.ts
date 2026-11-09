import { ScheduleRequestError } from "./api";

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

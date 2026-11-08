import { useHostFeatureAvailabilityMap } from "@/runtime/host-features";
/** One app capability boundary shared by navigation and canonical settings. */
export function useScheduleAvailability(hostIds: readonly string[]) {
  // COMPAT(scheduleTargets): added v0.10.0; remove after 2027-05-08 when floor >= v0.10.0.
  return useHostFeatureAvailabilityMap(hostIds, "scheduleTargets");
}

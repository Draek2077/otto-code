import type { BrainHostStatus } from "./contracts/host";
import { useBrainDemand, useBrainView, useBrainSelection } from "./context";
export function useBrainStatus(options: { enabled: boolean; resources?: boolean }) {
  useBrainDemand(options.resources ? "statusResources" : "status", options.enabled);
  return useBrainView("status", false);
}
export function useBrainInventory(enabled: boolean) {
  return useBrainView("inventory", enabled);
}
export function useBrainModelNames(enabled: boolean) {
  return useBrainView("modelNames", enabled);
}
export function useBrainLogs(enabled: boolean) {
  return useBrainView("logs", enabled);
}
export function useBrainRuntimes(enabled: boolean) {
  return useBrainView("runtimes", enabled);
}
export function useBrainCatalog(enabled: boolean) {
  return useBrainView("catalog", enabled);
}
export function useBrainJobs(enabled: boolean) {
  return useBrainView("jobs", enabled);
}
export function useBrainCapabilities(status: BrainHostStatus | null) {
  return status?.capabilities ?? null;
}
export function useBrainModelRevision() {
  return useBrainSelection("modelRevision");
}

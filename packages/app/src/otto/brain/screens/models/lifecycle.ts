import type { BrainHostStatus } from "../contracts/host";
import type { BrainInventoryModel } from "../contracts/models";

/** Resident rows are authoritative, including absence after eviction. */
export function brainModelLifecycleState(
  model: BrainInventoryModel,
  status: BrainHostStatus | undefined,
): BrainInventoryModel["state"] | null {
  if (!status) return null;

  const resident = status.residents.find((candidate) => candidate.modelId === model.id);
  if (!resident) return "not-loaded";
  if (resident.state === "starting") return "loading";
  if (resident.state === "stopping") return "unloading";
  if (resident.state === "ready") return "loaded";
  return "not-loaded";
}

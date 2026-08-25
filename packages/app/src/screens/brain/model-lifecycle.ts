import type { BrainHostStatus, BrainInventoryModel } from "@otto-code/protocol/messages";

/**
 * Resolve one table row from the complete resident-process snapshot.
 *
 * `modelId`/`state` describe the legacy primary supervisor only. Once a host
 * advertises `residents`, that array is authoritative for every pool slot,
 * including the absence that proves an evicted model is no longer loaded.
 */
export function brainModelLifecycleState(
  model: BrainInventoryModel,
  status: BrainHostStatus | undefined,
): BrainInventoryModel["state"] | null {
  if (!status) return null;

  if (Array.isArray(status.residents)) {
    const resident = status.residents.find((candidate) => candidate.modelId === model.id);
    if (!resident) return "not-loaded";
    if (resident.state === "starting") return "loading";
    if (resident.state === "stopping") return "unloading";
    if (resident.state === "ready") return "loaded";
    return "not-loaded";
  }

  if (status.modelId !== model.id) return null;
  if (status.state === "starting") return "loading";
  if (status.state === "stopping") return "unloading";
  if (status.state === "ready") return "loaded";
  return "not-loaded";
}

import type { BrainOwnerRead, BrainSettingsSnapshot } from "./contracts";

/** Live owner facts can refresh without rebasing an in-progress config draft. */
export function currentOwnerFacts(
  snapshot: BrainSettingsSnapshot,
  origin: BrainOwnerRead,
): BrainOwnerRead {
  const current = snapshot.owner.data;
  return current?.owner.id === origin.owner.id ? current : origin;
}

import type { BrainInventoryModel } from "../contracts/models";
/** The adapter supplies canonical artifact ids; richer bundle observations win a duplicate row. */
export function uniqueBrainInventoryModels(
  inventory: BrainInventoryModel[],
): BrainInventoryModel[] {
  const unique = new Map<string, BrainInventoryModel>();
  for (const model of inventory) {
    const existing = unique.get(model.id);
    if (!existing || (!existing.hasProjector && model.hasProjector)) unique.set(model.id, model);
  }
  return [...unique.values()];
}
/** Host-owned catalog membership includes alternate quants and declared companions. */
export function nonCatalogHuggingFaceModels(
  inventory: BrainInventoryModel[],
): BrainInventoryModel[] {
  return uniqueBrainInventoryModels(inventory).filter((model) => !model.catalogOwned);
}

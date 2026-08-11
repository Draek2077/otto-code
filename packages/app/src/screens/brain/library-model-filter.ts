import type { BrainCatalogModel, BrainInventoryModel } from "@otto-code/protocol/messages";

/** Compare managed model paths with Hugging Face's case-insensitive artifact ids. */
function normalizeArtifactId(id: string): string {
  return id
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

/**
 * An inventory refresh can briefly contain both the pre- and post-bundle view
 * of one artifact. Identity is the normalized repo-relative GGUF path, not the
 * capabilities inferred by either scan. Keep the richer row so a newly found
 * projector is never hidden while suppressing the duplicate model row.
 */
export function uniqueBrainInventoryModels(
  inventory: BrainInventoryModel[],
): BrainInventoryModel[] {
  const uniqueInventory = new Map<string, BrainInventoryModel>();
  for (const model of inventory) {
    const identity = normalizeArtifactId(model.id);
    const existing = uniqueInventory.get(identity);
    if (!existing || (!existing.hasProjector && model.hasProjector)) {
      uniqueInventory.set(identity, model);
    }
  }
  return [...uniqueInventory.values()];
}

/**
 * The catalog already owns the display and management of its primary weights
 * and declared bundle artifacts. Keep this section for discovered Hugging Face
 * artifacts that have no catalog row instead of duplicating those rows.
 */
export function nonCatalogHuggingFaceModels(
  inventory: BrainInventoryModel[],
  catalog: BrainCatalogModel[],
): BrainInventoryModel[] {
  const catalogArtifactIds = new Set(
    catalog
      .flatMap((model) => [
        model.id,
        ...(model.components ?? []).map(
          (component) => `${component.hfRepo ?? model.repo}/${component.file}`,
        ),
      ])
      .map(normalizeArtifactId),
  );
  // A catalog row owns every quant from its repository, not merely the one
  // curated filename. Otherwise an installed alternate quant is duplicated in
  // Downloaded models, where it loses the row's Bundle options control.
  const catalogRepos = catalog.map((model) => `${normalizeArtifactId(model.repo)}/`);
  return uniqueBrainInventoryModels(inventory).filter((model) => {
    const id = normalizeArtifactId(model.id);
    return !catalogArtifactIds.has(id) && !catalogRepos.some((repo) => id.startsWith(repo));
  });
}

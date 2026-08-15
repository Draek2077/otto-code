/** Barrel for the models subsystem plus the config-aware union scan. */
import { resolveBrainPaths } from "../config/paths.js";
import type { BrainConfig, Catalog } from "../config/schema.js";
import { CatalogSchema } from "../config/schema.js";
import { loadCatalog } from "../config/store.js";
import type { Model } from "../types.js";
import { resolveModelsDirs } from "./dirs.js";
import { enrichWithCatalog, excludeCatalogComponentArtifacts } from "./enrich.js";
import { loadRenameMap } from "./rename-map.js";
import { scan } from "./scan.js";

export * from "./scan.js";
export { pickModel, pickAutoModel } from "./pick.js";
export { resolveModelsDirs, managedModelsDir, type ModelsDir } from "./dirs.js";
export {
  pullModel,
  bundleDownloadPlan,
  downloadRepoFiles,
  type PullOptions,
  type PullProgress,
  type DownloadFilesOptions,
} from "./download.js";
export {
  matchCatalogEntry,
  enrichWithCatalog,
  excludeCatalogComponentArtifacts,
} from "./enrich.js";
export {
  resolveHfToken,
  listRepoQuants,
  searchModels,
  clearCardSummaryCache,
  repoOfModel,
  quantRank,
  type QuantOption,
  type RepoQuants,
  type ModelSearchResult,
} from "./hf.js";
export {
  diskUsage,
  totalModelBytes,
  planDelete,
  deleteModelFiles,
  type DiskUsage,
  type DeletePlan,
} from "./manage.js";

export interface ScanModelsOptions {
  withMetadata?: boolean;
}

/** Scan every configured models directory (managed ∪ LM Studio), de-duplicated. */
export function scanModels(
  config: BrainConfig,
  env: NodeJS.ProcessEnv = process.env,
  options: ScanModelsOptions = {},
): Model[] {
  const dirs = resolveModelsDirs(config, env);
  // `Model.id` is the stable repo-relative artifact identity. The same file
  // can exist in the managed store and LM Studio's store at different absolute
  // paths; managed is scanned first and deliberately owns that collision.
  const seenIds = new Set<string>();
  const all: Model[] = [];
  for (const { dir, origin } of dirs) {
    for (const model of scan({
      modelsDir: dir,
      withMetadata: options.withMetadata ?? true,
      origin,
    })) {
      if (seenIds.has(model.id)) continue;
      seenIds.add(model.id);
      all.push(model);
    }
  }
  const catalog = loadCatalogSafe(env);
  const enriched = enrichWithCatalog(excludeCatalogComponentArtifacts(all, catalog), catalog);
  const renameMap = loadRenameMap(resolveBrainPaths(env));
  for (const model of enriched) {
    if (renameMap[model.id]) {
      model.displayName = renameMap[model.id];
    }
  }
  enriched.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return enriched;
}

/**
 * The download catalog for enrichment, or an empty catalog if it cannot be read.
 * Discovery must never fail because the catalog file is missing or corrupt, so a
 * load error degrades to no enrichment rather than throwing.
 */
function loadCatalogSafe(env: NodeJS.ProcessEnv): Catalog {
  try {
    return loadCatalog(resolveBrainPaths(env));
  } catch {
    return CatalogSchema.parse({ models: [] });
  }
}

/**
 * Reconciles scanned models back to their download-catalog entries so a model's
 * coding metadata (useCases, tier, thinking, contextMax) survives a `pull`. The
 * catalog carries this per entry, but once files land on disk scan.ts rebuilds a
 * Model from filename + GGUF header alone, dropping it - this is where it is
 * re-attached. Track B1 of the brain coding-capabilities work.
 *
 * The join key is the hfRepo path. download.ts writes each model to
 * `<modelsDir>/<hfRepo>/<file>.gguf` (LM Studio mirrors the same
 * `<publisher>/<repo>/<file>` layout), and scan.ts rebuilds `Model.id` as that
 * same modelsDir-relative path with forward slashes. So a scanned model's id
 * sits under its catalog entry's hfRepo directory, and that containment is the
 * match.
 *
 * Total and best-effort by design: an empty catalog, a model with no match, or a
 * repo carrying several quants all resolve without throwing. Discovery returns
 * things unenriched on absence rather than raising - the caller decides whether
 * absence matters.
 */
import type { Catalog, CatalogModel } from "../config/schema.js";
import type { Model } from "../types.js";

/** Normalize a repo/id path: forward slashes, lowercased, trailing slashes trimmed. */
function normalizePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  let end = normalized.length;
  while (end > 0 && normalized.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return normalized.slice(0, end).toLowerCase();
}

/** The final path segment (file name) of a scanned model's id. */
function basenameOf(id: string): string {
  const normalized = id.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

/**
 * Find the catalog entry a scanned model belongs to, or null. A model matches
 * when its id path sits directly under the entry's hfRepo directory. When a repo
 * ships several quants (several catalog entries share one hfRepo), the tie is
 * broken by exact file name first, then by matching quant, then by the most
 * specific (longest) hfRepo.
 */
export function matchCatalogEntry(model: Model, catalog: Catalog): CatalogModel | null {
  const id = normalizePath(model.id);
  const base = basenameOf(model.id).toLowerCase();
  let best: CatalogModel | null = null;
  let bestScore = -1;
  for (const entry of catalog.models) {
    const repo = normalizePath(entry.hfRepo);
    // The model file must live under the repo directory. The trailing slash
    // guards against a partial segment match (repo "a/b" vs id "a/b-30b/...").
    if (!repo || !id.startsWith(`${repo}/`)) continue;
    let score = repo.length; // most-specific repo wins otherwise-equal ties
    if (entry.quantFile && entry.quantFile.toLowerCase() === base) {
      score += 1_000_000;
    } else if (
      entry.quant &&
      model.quant &&
      entry.quant.toLowerCase() === model.quant.toLowerCase()
    ) {
      score += 1_000;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

/**
 * Return copies of the models with catalog coding metadata attached where a match
 * exists; models with no match (and every model when the catalog is empty) pass
 * through untouched. Never throws.
 */
export function enrichWithCatalog(models: Model[], catalog: Catalog): Model[] {
  if (catalog.models.length === 0) return models;
  return models.map((model) => {
    const entry = matchCatalogEntry(model, catalog);
    if (!entry) return model;
    return {
      ...model,
      catalogId: entry.id,
      catalogHfRepo: entry.hfRepo,
      useCases: entry.useCases,
      tier: entry.tier,
      thinking: entry.thinking,
      reasoningEfforts: entry.reasoningEfforts,
      contextMax: entry.contextMax,
    };
  });
}

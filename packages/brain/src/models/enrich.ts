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
import fs from "node:fs";
import path from "node:path";

import type { Catalog, CatalogModel } from "../config/schema.js";
import type { Model, ModelComponent } from "../types.js";

/**
 * Hosting-profile families deliberately use a small, curated vocabulary. It is
 * a mix of publisher and model-line identities, so GGUF architecture names
 * must be folded into the existing buckets rather than exposed directly.
 */
const FAMILY_BY_GGUF_IDENTIFIER: Record<string, string> = {
  chatglm: "chatglm",
  deepseek: "deepseek",
  gemma: "gemma",
  gptoss: "openai",
  llama: "meta",
  meta: "meta",
  microsoft: "microsoft",
  mistral: "mistral",
  mixtral: "mistral",
  nemotron: "nvidia",
  nvidia: "nvidia",
  openai: "openai",
  phi: "microsoft",
  qwen: "qwen",
};

/**
 * Normalize a GGUF identity into the catalog's hosting-profile vocabulary.
 * Architecture is a stable structural field; names are only fallbacks for
 * headers whose architecture is absent or unrecognised.
 */
export function familyFromGgufMetadata(model: Model): string | undefined {
  const metadata = model.metadata;
  if (!metadata) return undefined;
  for (const value of [metadata.arch, metadata.basename, metadata.name]) {
    if (typeof value !== "string") continue;
    const identifier = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/gu, "");
    for (const [prefix, family] of Object.entries(FAMILY_BY_GGUF_IDENTIFIER)) {
      if (identifier.startsWith(prefix)) return family;
    }
  }
  return undefined;
}

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
  return models.map((model) => {
    const entry = matchCatalogEntry(model, catalog);
    if (!entry) {
      const enriched = enrichDiscoveredProjector(model);
      const family = familyFromGgufMetadata(enriched);
      return family ? { ...enriched, family } : enriched;
    }
    const components = resolveComponents(model, entry);
    const projector = components?.find((component) => component.role === "vision_projector");
    return {
      ...model,
      catalogId: entry.id,
      catalogHfRepo: entry.hfRepo,
      family: entry.family,
      components,
      // A manifest is authoritative. Do not pair a random same-directory
      // projector when the catalog declares the exact companion artifact.
      mmprojPath: projector?.path ?? (components ? null : model.mmprojPath),
      mmprojBytes: projector?.bytes ?? (components ? 0 : model.mmprojBytes),
      useCases: entry.useCases,
      tier: entry.tier,
      thinking: entry.thinking,
      reasoningEfforts: entry.reasoningEfforts,
      contextMax: entry.contextMax,
    };
  });
}

/** Promote a scanner-paired projector in an arbitrary Hugging Face repository
 * into the same component inventory shape used by curated bundles. */
function enrichDiscoveredProjector(model: Model): Model {
  if (!model.mmprojPath) return model;
  return {
    ...model,
    components: [
      {
        id: "vision-projector",
        label: "Vision projector",
        description: "Adds image understanding",
        role: "vision_projector",
        path: model.mmprojPath,
        bytes: model.mmprojBytes,
        required: false,
        defaultDownload: false,
        defaultLoad: true,
        available: true,
      },
    ],
  };
}

function resolveComponents(model: Model, entry: CatalogModel): ModelComponent[] | undefined {
  if (!entry.components) return undefined;
  const modelDir = path.dirname(model.modelPath);
  return entry.components.map((component) => {
    const componentRepo = component.hfRepo ?? entry.hfRepo;
    // A selected catalog primary and its declared companions share a repo in the
    // managed layout. For a companion repository, derive its absolute path from
    // the scanned model's models root rather than accepting a client path.
    const repoTail = componentRepo.split("/").join(path.sep);
    const marker = entry.hfRepo.split("/").join(path.sep);
    const root = modelDir.endsWith(marker) ? modelDir.slice(0, -marker.length) : modelDir;
    const candidate = path.resolve(root, repoTail, component.file);
    let bytes = 0;
    try {
      bytes = fs.statSync(candidate).size;
    } catch {
      bytes = component.bytes ?? 0;
    }
    const available = fs.existsSync(candidate);
    return {
      id: component.id,
      label: component.label,
      description: component.description,
      role: component.role,
      path: available ? candidate : null,
      bytes,
      required: component.required,
      defaultDownload: component.defaultDownload,
      defaultLoad: component.defaultLoad,
      available,
      ...(available ? {} : { unavailableReason: "Not downloaded" }),
      ...(component.minRuntimeBuild ? { minRuntimeBuild: component.minRuntimeBuild } : {}),
    };
  });
}

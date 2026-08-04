/**
 * `otto brain catalog` - list the downloadable model catalog, each entry
 * annotated with whether it is already installed. The installed flag reuses the
 * authoritative catalog↔model join (enrichWithCatalog sets `catalogId` back-
 * references on scanned models), so it agrees with `scan`/`pull` and works with
 * no llama-server running. The daemon shells this out (`--json`) to power the
 * Brain "Models" UI, which is why the row carries rich fields (repo, size,
 * params, tier, use-cases) that only the JSON output surfaces.
 */
import type { Command } from "commander";

import { loadBrainConfig, loadCatalog } from "../config/index.js";
import { formatBytes, scanModels } from "../models/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";

export interface CatalogRow {
  id: string;
  name: string;
  installed: boolean;
  publisher: string;
  repo: string;
  quant: string;
  params: string;
  sizeBytes: number | null;
  size: string;
  vision: boolean;
  thinking: boolean;
  contextMax: number | null;
  tier: string;
  useCases: string[];
  why: string;
}

export const catalogSchema: OutputSchema<CatalogRow> = {
  idField: "id",
  columns: [
    { header: "NAME", field: "name", width: 34 },
    { header: "PARAMS", field: "params", width: 8 },
    { header: "SIZE", field: "size", width: 9, align: "right" },
    { header: "TIER", field: "tier", width: 8 },
    {
      // Format the boolean for the table only; JSON keeps the real `installed`.
      header: "INSTALLED",
      field: (row) => (row.installed ? "yes" : ""),
      width: 9,
      color: (v) => (v === "yes" ? "green" : undefined),
    },
  ],
};

export function addCatalogOptions(cmd: Command): Command {
  return cmd.description("List downloadable models from the catalog");
}

export async function runCatalogCommand(
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<CatalogRow>> {
  const config = loadBrainConfig();
  const catalog = loadCatalog();
  // Metadata-free scan: the catalog join is by path/repo, not GGUF headers, so
  // skip the header reads for speed.
  const installed = scanModels(config, process.env, { withMetadata: false });
  const installedCatalogIds = new Set(
    installed.map((model) => model.catalogId).filter((id): id is string => Boolean(id)),
  );

  const rows: CatalogRow[] = catalog.models.map((model) => ({
    id: model.id,
    name: model.name,
    installed: installedCatalogIds.has(model.id),
    publisher: model.publisher ?? "",
    repo: model.hfRepo,
    quant: model.quant,
    params: model.params ?? "",
    sizeBytes: model.approxWeightsBytes ?? null,
    size: model.approxWeightsBytes ? formatBytes(model.approxWeightsBytes) : "",
    vision: model.vision ?? false,
    thinking: model.thinking ?? false,
    contextMax: model.contextMax ?? null,
    tier: model.tier ?? "",
    useCases: model.useCases ?? [],
    why: model.why ?? "",
  }));

  return { type: "list", data: rows, schema: catalogSchema };
}

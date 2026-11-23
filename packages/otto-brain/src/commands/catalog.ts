/**
 * `otto brain catalog` - list the downloadable model catalog, each entry
 * annotated with whether it is already installed. The installed flag reuses the
 * authoritative catalog↔model join (enrichWithCatalog sets `catalogId` back-
 * references on scanned models), so it agrees with `scan`/`pull` and works with
 * no llama-server running. CLI output keeps its rich fields (repo, size, params,
 * tier and use-cases) while reading the same host catalog and inventory as the UI.
 */
import type { Command } from "commander";

import type { CatalogModel } from "../config/schema.js";
import { formatBytes } from "../models/scan.js";
import { withAcquisitionHost } from "./acquisition-host.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";

export interface CatalogRow {
  id: string;
  name: string;
  family: string | null;
  favorite: boolean;
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
  components?: CatalogModel["components"];
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

export async function runCatalogCommand(
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<CatalogRow>> {
  return withAcquisitionHost(async (host) => {
    const catalog = { models: await host.catalog() };
    const installedCatalogIds = new Set(
      (await host.inventory()).flatMap((model) => (model.catalogId ? [model.catalogId] : [])),
    );

    const rows: CatalogRow[] = catalog.models.map((model) => ({
      id: model.id,
      name: model.name,
      family: model.family ?? null,
      favorite: model.favorite,
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
      components: model.components,
    }));

    return { type: "list", data: rows, schema: catalogSchema };
  });
}

export { addCatalogOptions } from "./options.js";

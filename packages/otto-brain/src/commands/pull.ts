/** Catalog downloads use the owning host's credentials, destination and jobs. */
import type { Command } from "commander";
import type { CatalogModel } from "../config/schema.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import { formatBytes } from "../models/scan.js";
import { withAcquisitionHost } from "./acquisition-host.js";
export interface PullRow {
  model: string;
  repo: string;
  path: string;
  size: string;
}

const pullSchema: OutputSchema<PullRow> = {
  idField: "model",
  columns: [
    { header: "MODEL", field: "model", width: 32 },
    { header: "REPO", field: "repo", width: 40 },
    { header: "PATH", field: "path", width: 40 },
    { header: "SIZE", field: "size", width: 10, align: "right" },
  ],
};

interface QuantRow {
  quant: string;
  size: string;
  files: number;
  fileNames?: string[];
}

const quantSchema: OutputSchema<QuantRow> = {
  idField: "quant",
  columns: [
    { header: "QUANT", field: "quant", width: 12 },
    { header: "SIZE", field: "size", width: 10, align: "right" },
    { header: "FILES", field: "files", width: 6, align: "right" },
  ],
};

function findCatalogModel(models: CatalogModel[], needle: string): CatalogModel {
  const lower = needle.toLowerCase();
  const exact = models.find((m) => m.id === needle || m.name.toLowerCase() === lower);
  if (exact) return exact;
  const matches = models.filter(
    (m) => m.id.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower),
  );
  if (!matches.length) {
    throw new CommandError({ code: "NO_MATCH", message: `no catalog model matches "${needle}"` });
  }
  if (matches.length > 1) {
    throw new CommandError({
      code: "AMBIGUOUS",
      message: `"${needle}" matches ${matches.length} catalog models`,
      details: matches.map((m) => m.name).join(", "),
    });
  }
  return matches[0];
}

export interface PullOptionsInput {
  file?: string;
  quant?: string;
  listQuants?: boolean;
  component?: string[];
  componentsOnly?: boolean;
}

export async function runPullCommand(
  modelArg: string,
  options: PullOptionsInput,
  _command: Command,
): Promise<AnyCommandResult<PullRow>> {
  return withAcquisitionHost(async (host) => {
    const model = findCatalogModel(await host.catalog(), modelArg);
    if (options.listQuants) {
      const listing: AnyCommandResult<QuantRow> = {
        type: "list",
        data: await host.quantRows(model.hfRepo),
        schema: quantSchema,
      };
      // Retain the existing CLI's schema-driven heterogeneous listing contract.
      return listing as unknown as AnyCommandResult<PullRow>;
    }
    const result = await host.download("pull", {
      modelId: model.id,
      ...(options.file === undefined ? {} : { file: options.file }),
      ...(options.quant === undefined ? {} : { quant: options.quant }),
      ...(options.component === undefined ? {} : { components: options.component }),
      ...(options.componentsOnly === undefined ? {} : { componentsOnly: options.componentsOnly }),
    });
    return {
      type: "single",
      data: {
        model: options.quant ? `${model.name} (${options.quant})` : model.name,
        repo: result.repo,
        path: result.path,
        size: result.totalBytes === null ? "-" : formatBytes(result.totalBytes),
      },
      schema: pullSchema,
    };
  });
}

export { addPullOptions } from "./options.js";

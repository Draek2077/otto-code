/**
 * `otto brain pull <model>` — download a model from the catalog into the managed
 * models directory, using only Node's fetch (no external downloader). The catalog
 * is the same one seeded from docs/candidate-models.md.
 */
import type { Command } from "commander";

import { loadBrainConfig, loadCatalog } from "../config/index.js";
import type { CatalogModel } from "../config/schema.js";
import { managedModelsDir, pullModel } from "../models/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import { formatBytes } from "../models/scan.js";

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

export function addPullOptions(cmd: Command): Command {
  return cmd
    .description("Download a model from the catalog")
    .argument("<model>", "catalog id or name fragment")
    .option("--file <name.gguf>", "explicit GGUF file name in the repo");
}

export async function runPullCommand(
  modelArg: string,
  options: { file?: string },
  _command: Command,
): Promise<AnyCommandResult<PullRow>> {
  const config = loadBrainConfig();
  const catalog = loadCatalog();
  const model = findCatalogModel(catalog.models, modelArg);

  const destRoot = managedModelsDir(config);
  let lastPct = -1;
  const localPath = await pullModel({
    model,
    destRoot,
    file: options.file,
    onProgress: (p) => {
      if (!p.totalBytes) return;
      const pct = Math.floor((p.receivedBytes / p.totalBytes) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        process.stderr.write(`  ${model.name}: ${pct}%\r`);
      }
    },
  });
  process.stderr.write("\n");

  return {
    type: "single",
    data: {
      model: model.name,
      repo: model.hfRepo,
      path: localPath,
      size: model.approxWeightsBytes ? formatBytes(model.approxWeightsBytes) : "-",
    },
    schema: pullSchema,
  };
}

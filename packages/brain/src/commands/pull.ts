/**
 * `otto brain pull <model>` — download a model from the catalog into the managed
 * models directory, using only Node's fetch (no external downloader). The catalog
 * is the same one seeded from docs/candidate-models.md. `--list-quants` shows what
 * quantizations the repo offers and `--quant <label>` downloads a specific one.
 */
import type { Command } from "commander";

import { loadBrainConfig, loadCatalog } from "../config/index.js";
import type { CatalogModel } from "../config/schema.js";
import {
  downloadRepoFiles,
  listRepoQuants,
  managedModelsDir,
  pullModel,
  resolveHfToken,
} from "../models/index.js";
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

interface QuantRow {
  quant: string;
  size: string;
  files: number;
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

export function addPullOptions(cmd: Command): Command {
  return cmd
    .description("Download a model from the catalog")
    .argument("<model>", "catalog id or name fragment")
    .option("--file <name.gguf>", "explicit GGUF file name in the repo")
    .option("--quant <label>", "download a specific quantization (e.g. Q5_K_M)")
    .option("--list-quants", "list the quantizations the repo offers and exit");
}

export interface PullOptionsInput {
  file?: string;
  quant?: string;
  listQuants?: boolean;
}

export async function runPullCommand(
  modelArg: string,
  options: PullOptionsInput,
  _command: Command,
): Promise<AnyCommandResult<PullRow>> {
  const config = loadBrainConfig();
  const catalog = loadCatalog();
  const model = findCatalogModel(catalog.models, modelArg);
  const token = resolveHfToken(config);

  // Discover-and-choose paths both need the repo's quant listing.
  if (options.listQuants || options.quant) {
    const { quants, mmproj } = await listRepoQuants(model.hfRepo, token);

    if (options.listQuants) {
      const listing: AnyCommandResult<QuantRow> = {
        type: "list",
        data: quants.map((q) => ({
          quant: q.quant,
          size: formatBytes(q.sizeBytes),
          files: q.files.length,
        })),
        schema: quantSchema,
      };
      // withOutput infers one row type; the renderer is schema-driven, so a
      // differently-shaped result renders correctly at runtime.
      return listing as unknown as AnyCommandResult<PullRow>;
    }

    const wanted = options.quant!.toLowerCase();
    const choice = quants.find((q) => q.quant.toLowerCase() === wanted);
    if (!choice) {
      throw new CommandError({
        code: "NO_QUANT",
        message: `${model.hfRepo} has no ${options.quant} - available: ${quants.map((q) => q.quant).join(", ") || "none"}`,
      });
    }
    const files = [...choice.files, ...(mmproj ? mmproj.files : [])];
    const total = choice.sizeBytes + (mmproj?.sizeBytes ?? 0);
    let lastPct = -1;
    const written = await downloadRepoFiles({
      repo: model.hfRepo,
      files,
      destRoot: managedModelsDir(config),
      token,
      onProgress: (p) => {
        const pct = total ? Math.floor((p.receivedBytes / total) * 100) : 0;
        if (pct !== lastPct && pct % 5 === 0) {
          lastPct = pct;
          process.stderr.write(`  ${model.name} ${choice.quant}: ${pct}%\r`);
        }
      },
    });
    process.stderr.write("\n");
    return {
      type: "single",
      data: {
        model: `${model.name} (${choice.quant})`,
        repo: model.hfRepo,
        path: written[0] ?? "(already present)",
        size: formatBytes(total),
      },
      schema: pullSchema,
    };
  }

  const destRoot = managedModelsDir(config);
  let lastPct = -1;
  const localPath = await pullModel({
    model,
    destRoot,
    file: options.file,
    token,
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

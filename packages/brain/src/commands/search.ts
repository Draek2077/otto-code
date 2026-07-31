/**
 * `otto brain search <query>` and `otto brain repo-quants <repo>` — Hugging Face
 * model discovery. These wrap the surface-agnostic primitives in models/hf.ts so
 * the same code serves the TUI (in-process) and the Otto app (daemon shells out
 * to `--json`, mirroring `catalog`/`scan`).
 */
import type { Command } from "commander";

import { loadBrainConfig } from "../config/index.js";
import {
  downloadRepoFiles,
  listRepoQuants,
  managedModelsDir,
  resolveHfToken,
  searchModels,
} from "../models/index.js";
import { formatBytes } from "../models/scan.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";

export interface SearchRow {
  repo: string;
  downloads: number;
  likes: number;
  gated: string;
}

const searchSchema: OutputSchema<SearchRow> = {
  idField: "repo",
  columns: [
    { header: "REPO", field: "repo", width: 52 },
    { header: "DOWNLOADS", field: "downloads", width: 11, align: "right" },
    { header: "LIKES", field: "likes", width: 6, align: "right" },
    { header: "GATED", field: "gated", width: 6 },
  ],
};

export function addSearchOptions(cmd: Command): Command {
  return cmd
    .description("Search Hugging Face for GGUF models")
    .argument("<query>", "search text")
    .option("--limit <n>", "maximum results", "25");
}

export async function runSearchCommand(
  query: string,
  options: { limit?: string },
  _command: Command,
): Promise<AnyCommandResult<SearchRow>> {
  const token = resolveHfToken(loadBrainConfig());
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
  const results = await searchModels(query, { limit, token });
  return {
    type: "list",
    data: results.map((r) => ({
      repo: r.repo,
      downloads: r.downloads,
      likes: r.likes,
      gated: r.gated ? "yes" : "",
    })),
    schema: searchSchema,
  };
}

export interface AddRow {
  repo: string;
  quant: string;
  path: string;
  size: string;
}

interface AddQuantRow {
  quant: string;
  size: string;
  sizeBytes: number;
  files: number;
}

const addSchema: OutputSchema<AddRow> = {
  idField: "repo",
  columns: [
    { header: "REPO", field: "repo", width: 40 },
    { header: "QUANT", field: "quant", width: 12 },
    { header: "PATH", field: "path", width: 40 },
    { header: "SIZE", field: "size", width: 10, align: "right" },
  ],
};

const addQuantSchema: OutputSchema<AddQuantRow> = {
  idField: "quant",
  columns: [
    { header: "QUANT", field: "quant", width: 12 },
    { header: "SIZE", field: "size", width: 10, align: "right" },
    { header: "FILES", field: "files", width: 6, align: "right" },
  ],
};

export function addAddOptions(cmd: Command): Command {
  return cmd
    .description("Download a model from an arbitrary Hugging Face repo")
    .argument("<repo>", "owner/repo on Hugging Face")
    .option("--quant <label>", "quantization to download (e.g. Q5_K_M)")
    .option("--list-quants", "list the quantizations the repo offers and exit");
}

export async function runAddCommand(
  repo: string,
  options: { quant?: string; listQuants?: boolean },
  _command: Command,
): Promise<AnyCommandResult<AddRow>> {
  const config = loadBrainConfig();
  const token = resolveHfToken(config);
  const { quants, mmproj } = await listRepoQuants(repo, token);

  if (options.listQuants || !options.quant) {
    const listing: AnyCommandResult<AddQuantRow> = {
      type: "list",
      data: quants.map((q) => ({
        quant: q.quant,
        size: formatBytes(q.sizeBytes),
        sizeBytes: q.sizeBytes,
        files: q.files.length,
      })),
      schema: addQuantSchema,
    };
    // withOutput infers one row type; the renderer is schema-driven, so a
    // differently-shaped result renders correctly at runtime.
    return listing as unknown as AnyCommandResult<AddRow>;
  }

  const wanted = options.quant.toLowerCase();
  const choice = quants.find((q) => q.quant.toLowerCase() === wanted);
  if (!choice) {
    throw new CommandError({
      code: "NO_QUANT",
      message: `${repo} has no ${options.quant} - available: ${quants.map((q) => q.quant).join(", ") || "none"}`,
    });
  }
  const files = [...choice.files, ...(mmproj ? mmproj.files : [])];
  const total = choice.sizeBytes + (mmproj?.sizeBytes ?? 0);
  let lastPct = -1;
  const written = await downloadRepoFiles({
    repo,
    files,
    destRoot: managedModelsDir(config),
    token,
    onProgress: (p) => {
      const pct = total ? Math.floor((p.receivedBytes / total) * 100) : 0;
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        process.stderr.write(`  ${repo} ${choice.quant}: ${pct}%\r`);
      }
    },
  });
  process.stderr.write("\n");
  return {
    type: "single",
    data: {
      repo,
      quant: choice.quant,
      path: written[0] ?? "(already present)",
      size: formatBytes(total),
    },
    schema: addSchema,
  };
}

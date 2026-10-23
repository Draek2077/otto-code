/**
 * `otto brain search <query>` and `otto brain repo-quants <repo>` - Hugging Face
 * model discovery. These wrap the surface-agnostic primitives in models/hf.ts so
 * the same code serves the TUI (in-process) and the Otto app (daemon shells out
 * to `--json`, mirroring `catalog`/`scan`).
 */
import type { Command } from "commander";

import { loadBrainConfig } from "../config/index.js";
import {
  listRepoQuants,
  managedModelsDir,
  repoOfModel,
  resolveHfToken,
  scanModels,
  searchModels,
} from "../models/index.js";
import { formatBytes } from "../models/scan.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import { downloadRepoFilesWithProgress } from "./repo-download.js";

/** What is already on disk, so search + quant listings can mark installed rows. */
function installedIndex(config: ReturnType<typeof loadBrainConfig>): {
  repos: Set<string>;
  quants: Map<string, string>;
  projectorRepos: Set<string>;
} {
  const repos = new Set<string>();
  const quants = new Map<string, string>();
  const projectorRepos = new Set<string>();
  for (const model of scanModels(config)) {
    const repo = repoOfModel(model);
    if (!repo) continue;
    repos.add(repo.toLowerCase());
    if (model.quant) quants.set(`${repo.toLowerCase()} ${model.quant.toUpperCase()}`, model.id);
    if (model.mmprojPath) projectorRepos.add(repo.toLowerCase());
  }
  return { repos, quants, projectorRepos };
}

export interface SearchRow {
  repo: string;
  downloads: number;
  likes: number;
  gated: string;
  installed: boolean;
  summary: string | null;
}

const searchSchema: OutputSchema<SearchRow> = {
  idField: "repo",
  columns: [
    { header: "REPO", field: "repo", width: 48 },
    { header: "DOWNLOADS", field: "downloads", width: 11, align: "right" },
    { header: "LIKES", field: "likes", width: 6, align: "right" },
    { header: "GATED", field: "gated", width: 6 },
    { header: "HAVE", field: (r) => (r.installed ? "yes" : ""), width: 5 },
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
  const config = loadBrainConfig();
  const token = resolveHfToken(config);
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
  const results = await searchModels(query, { limit, token });
  const { repos } = installedIndex(config);
  return {
    type: "list",
    data: results.map((r) => ({
      repo: r.repo,
      downloads: r.downloads,
      likes: r.likes,
      gated: r.gated ? "yes" : "",
      installed: repos.has(r.repo.toLowerCase()),
      summary: r.summary,
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
  installed: boolean;
  projector?: { file: string; sizeBytes: number; installed: boolean };
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
    { header: "HAVE", field: (r) => (r.installed ? "yes" : ""), width: 5 },
  ],
};

export function addAddOptions(cmd: Command): Command {
  return cmd
    .description("Download a model from an arbitrary Hugging Face repo")
    .argument("<repo>", "owner/repo on Hugging Face")
    .option("--quant <label>", "quantization to download (e.g. Q5_K_M)")
    .option("--component <id...>", "download optional discovered component ids")
    .option("--primary-only", "download only the selected primary quant")
    .option("--components-only", "download selected bundle components without the primary quant")
    .option("--list-quants", "list the quantizations the repo offers and exit");
}

export async function runAddCommand(
  repo: string,
  options: {
    quant?: string;
    listQuants?: boolean;
    component?: string[];
    primaryOnly?: boolean;
    componentsOnly?: boolean;
  },
  _command: Command,
): Promise<AnyCommandResult<AddRow>> {
  const config = loadBrainConfig();
  const token = resolveHfToken(config);
  const { quants, mmproj } = await listRepoQuants(repo, token);

  if (options.listQuants || !options.quant) {
    const { quants: installedQuants, projectorRepos } = installedIndex(config);
    const listing: AnyCommandResult<AddQuantRow> = {
      type: "list",
      data: quants.map((q) => ({
        quant: q.quant,
        size: formatBytes(q.sizeBytes),
        sizeBytes: q.sizeBytes,
        files: q.files.length,
        modelId: installedQuants.get(`${repo.toLowerCase()} ${q.quant.toUpperCase()}`) ?? null,
        installed: installedQuants.has(`${repo.toLowerCase()} ${q.quant.toUpperCase()}`),
        ...(mmproj
          ? {
              projector: {
                file: mmproj.files[0],
                sizeBytes: mmproj.sizeBytes,
                installed: projectorRepos.has(repo.toLowerCase()),
              },
            }
          : {}),
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
  const requested = new Set(options.component ?? []);
  const unknown = [...requested].filter((id) => id !== "vision-projector");
  if (unknown.length)
    throw new CommandError({
      code: "NO_COMPONENT",
      message: `unknown bundle components: ${unknown.join(", ")}`,
    });
  const includeProjector =
    Boolean(mmproj) &&
    (requested.has("vision-projector") ||
      (!options.primaryOnly && options.component === undefined));
  if (options.componentsOnly && !includeProjector) {
    throw new CommandError({
      code: "NO_COMPONENT",
      message: "--components-only requires a selected bundle component",
    });
  }
  const files = [
    ...(options.componentsOnly ? [] : choice.files),
    ...(includeProjector ? mmproj!.files : []),
  ];
  const total =
    (options.componentsOnly ? 0 : choice.sizeBytes) + (includeProjector ? mmproj!.sizeBytes : 0);
  const written = await downloadRepoFilesWithProgress({
    activityTarget: `${repo} (${choice.quant})`,
    progressLabel: `${repo} ${choice.quant}`,
    totalBytes: total,
    repo,
    files,
    destRoot: managedModelsDir(config),
    token,
  });
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

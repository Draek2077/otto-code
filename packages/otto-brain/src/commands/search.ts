/** Search, quant discovery and direct additions use the canonical Brain owner. */
import type { Command } from "commander";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { formatBytes } from "../models/scan.js";
import { CommandError } from "../output/types.js";
import { withAcquisitionHost } from "./acquisition-host.js";
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
  const limit = Number(options.limit ?? 25);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new CommandError({
      code: "INVALID_LIMIT",
      message: "Choose a result limit from 1 to 100.",
    });
  return withAcquisitionHost(async (host) => ({
    type: "list",
    data: await host.search(query, limit),
    schema: searchSchema,
  }));
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
  return withAcquisitionHost(async (host) => {
    if (options.listQuants || !options.quant) {
      const listing: AnyCommandResult<AddQuantRow> = {
        type: "list",
        data: await host.quantRows(repo),
        schema: addQuantSchema,
      };
      // Retain the existing CLI's schema-driven heterogeneous listing contract.
      return listing as unknown as AnyCommandResult<AddRow>;
    }
    const result = await host.download("add", {
      repo,
      quant: options.quant,
      ...(options.component === undefined ? {} : { components: options.component }),
      ...(options.primaryOnly === undefined ? {} : { primaryOnly: options.primaryOnly }),
      ...(options.componentsOnly === undefined ? {} : { componentsOnly: options.componentsOnly }),
    });
    return {
      type: "single",
      data: {
        repo: result.repo,
        quant: options.quant,
        path: result.path,
        size: result.totalBytes === null ? "-" : formatBytes(result.totalBytes),
      },
      schema: addSchema,
    };
  });
}

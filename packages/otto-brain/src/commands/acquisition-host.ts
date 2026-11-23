/** CLI projection of the canonical Brain owner, with one capability gate. */
import { z } from "zod/v3";
import { CatalogModelSchema } from "../config/schema.js";
import { formatBytes } from "../models/scan.js";
import { CommandError } from "../output/types.js";
import { waitForCommandJob, withCommandHost, type HostCommandPort } from "./host-command.js";

const CatalogSchema = z.object({ models: z.array(CatalogModelSchema) });
const InventorySchema = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      repo: z.string().nullable(),
      catalogId: z.string().nullable(),
      quant: z.string().nullable(),
      hasProjector: z.boolean(),
    }),
  ),
});
const QuantsSchema = z.object({
  repo: z.string(),
  quants: z.array(
    z.object({
      quant: z.string(),
      files: z.array(z.string()),
      sizeBytes: z.number().nonnegative(),
    }),
  ),
  mmproj: z.object({ files: z.array(z.string()), sizeBytes: z.number().nonnegative() }).nullable(),
});
const SearchSchema = z.object({
  models: z.array(
    z.object({
      repo: z.string(),
      downloads: z.number(),
      likes: z.number(),
      gated: z.boolean(),
      summary: z.string().nullable(),
    }),
  ),
});
const ResultSchema = z.object({
  repo: z.string(),
  path: z.string(),
  files: z.array(z.string()),
  totalBytes: z.number().nullable(),
});
const CapabilitiesSchema = z.object({
  modelAcquisition: z.literal(true),
  catalog: z.literal(true),
  hfSearch: z.literal(true),
  inventory: z.literal(true),
  jobs: z.literal(true),
  events: z.literal(true),
});

export class AcquisitionHost {
  private constructor(
    private readonly port: HostCommandPort,
    private readonly signal: AbortSignal,
  ) {}
  static async connect(port: HostCommandPort, signal: AbortSignal) {
    if (!CapabilitiesSchema.safeParse(await port.request("/__host/capabilities", signal)).success)
      throw new CommandError({
        code: "UPDATE_HOST",
        message: "Update the Brain host to discover and download models.",
      });
    return new AcquisitionHost(port, signal);
  }
  async catalog() {
    return CatalogSchema.parse(await this.port.request("/__host/catalog", this.signal)).models;
  }
  async inventory() {
    return InventorySchema.parse(await this.port.request("/__host/models", this.signal)).models;
  }
  async quants(repo: string) {
    return QuantsSchema.parse(
      await this.port.request(`/__host/hf/quants?${new URLSearchParams({ repo })}`, this.signal),
    );
  }
  async quantRows(repo: string) {
    const listing = await this.quants(repo);
    const installed = await this.inventory();
    const models = installed.filter((model) => model.repo?.toLowerCase() === repo.toLowerCase());
    return listing.quants.map((choice) => {
      const matched = models.find(
        (model) => model.quant?.toUpperCase() === choice.quant.toUpperCase(),
      );
      return {
        quant: choice.quant,
        size: formatBytes(choice.sizeBytes),
        sizeBytes: choice.sizeBytes,
        files: choice.files.length,
        fileNames: choice.files,
        installed: Boolean(matched),
        modelId: matched?.id ?? null,
        projector: listing.mmproj
          ? {
              file: listing.mmproj.files[0],
              sizeBytes: listing.mmproj.sizeBytes,
              installed: models.some((model) => model.hasProjector),
            }
          : undefined,
      };
    });
  }
  async search(query: string, limit: number) {
    const params = new URLSearchParams({ query, limit: String(limit) });
    const result = SearchSchema.parse(
      await this.port.request(`/__host/hf/search?${params}`, this.signal),
    );
    const installed = new Set(
      (await this.inventory()).flatMap((model) => (model.repo ? [model.repo.toLowerCase()] : [])),
    );
    return result.models.map((row) => ({
      repo: row.repo,
      downloads: row.downloads,
      likes: row.likes,
      summary: row.summary,
      gated: row.gated ? "yes" : "",
      installed: installed.has(row.repo.toLowerCase()),
    }));
  }
  async download(kind: "pull" | "add", selection: unknown) {
    const admitted = z
      .object({ job: z.object({ id: z.string() }) })
      .parse(await this.port.request(`/__host/jobs/${kind}`, this.signal, selection));
    const job = await waitForCommandJob(this.port, admitted.job.id, this.signal);
    return ResultSchema.parse(job.result);
  }
}
export function withAcquisitionHost<T>(run: (host: AcquisitionHost) => Promise<T>) {
  return withCommandHost(async (port, signal) => run(await AcquisitionHost.connect(port, signal)));
}

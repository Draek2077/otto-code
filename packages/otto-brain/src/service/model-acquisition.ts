/** Catalog, discovery and downloads belong to the selected Brain owner. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod/v3";
import type { CatalogModel } from "../config/schema.js";
import {
  bundleDownloadPlan,
  destinationFor,
  type DownloadFilesOptions,
} from "../models/download.js";
import type { ModelSearchResult, QuantOption, RepoQuants } from "../models/hf.js";
import type { BrainJobs } from "./jobs.js";
import { readObject, RequestError, sendJson } from "./http-body.js";

const RepoSchema = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u);
const SelectionSchema = z
  .object({
    modelId: z.string().min(1).max(1024),
    quant: z.string().min(1).max(128).optional(),
    file: z.string().min(1).max(1024).optional(),
    components: z.array(z.string().min(1).max(128)).max(32).optional(),
    componentsOnly: z.boolean().optional(),
  })
  .strict();
const DirectSchema = z
  .object({
    repo: RepoSchema,
    quant: z.string().min(1).max(128),
    components: z.array(z.literal("vision-projector")).max(1).optional(),
    primaryOnly: z.boolean().optional(),
    componentsOnly: z.boolean().optional(),
  })
  .strict();
interface DownloadPlan {
  repo: string;
  files: string[];
  totalBytes: number | null;
}
export interface ModelAcquisitionPorts {
  jobs: BrainJobs;
  catalog(): CatalogModel[];
  destination(): string;
  token(): string | null;
  quants(repo: string, token: string | null, signal: AbortSignal): Promise<RepoQuants>;
  search(
    query: string,
    limit: number,
    token: string | null,
    signal: AbortSignal,
  ): Promise<ModelSearchResult[]>;
  download(options: DownloadFilesOptions): Promise<string[]>;
  changed(): void;
  requireWrite(request: IncomingMessage): void;
}
const ROUTES = new Set([
  "GET /__host/catalog",
  "GET /__host/hf/search",
  "GET /__host/hf/quants",
  "POST /__host/jobs/pull",
  "POST /__host/jobs/add",
]);
function chosenQuant(listing: RepoQuants, name: string) {
  const choice = listing.quants.find((quant) => quant.quant.toLowerCase() === name.toLowerCase());
  if (!choice)
    throw new RequestError(
      400,
      "This quant is not available on the owning host's repository listing",
    );
  return choice;
}
function directPlan(listing: RepoQuants, selection: z.infer<typeof DirectSchema>): DownloadPlan {
  const choice = chosenQuant(listing, selection.quant);
  const projector = listing.mmproj;
  const includeProjector =
    Boolean(projector) &&
    (selection.components?.includes("vision-projector") ||
      (!selection.primaryOnly && selection.components === undefined));
  if (
    (selection.components?.length && !projector) ||
    (selection.componentsOnly && !includeProjector)
  )
    throw new RequestError(400, "The selected projector is not available");
  return {
    repo: selection.repo,
    files: [
      ...(selection.componentsOnly ? [] : choice.files),
      ...(includeProjector ? projector!.files : []),
    ],
    totalBytes:
      (selection.componentsOnly ? 0 : choice.sizeBytes) +
      (includeProjector ? projector!.sizeBytes : 0),
  };
}
function catalogBundle(
  model: CatalogModel,
  selection: z.infer<typeof SelectionSchema>,
  choice: QuantOption | null,
): DownloadPlan {
  const primaryFiles = choice?.files ?? (selection.file ? [selection.file] : undefined);
  return bundleDownloadPlan(
    model,
    selection.components,
    selection.componentsOnly ? [] : primaryFiles,
    selection.componentsOnly ? 0 : choice?.sizeBytes,
    !selection.componentsOnly,
  );
}
export class ModelAcquisition {
  constructor(private readonly ports: ModelAcquisitionPorts) {}

  catalog() {
    return { models: this.ports.catalog() };
  }
  async search(query: string, limit: number, signal: AbortSignal) {
    if (
      !query.trim() ||
      query.length > 256 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new RequestError(400, "Supply a model search and a limit from 1 to 100");
    return { models: await this.ports.search(query.trim(), limit, this.ports.token(), signal) };
  }
  async quants(repo: string, signal: AbortSignal) {
    if (!RepoSchema.safeParse(repo).success)
      throw new RequestError(400, "Supply a Hugging Face repository id");
    return this.ports.quants(repo, this.ports.token(), signal);
  }
  pull(input: unknown) {
    const parsed = SelectionSchema.safeParse(input);
    if (!parsed.success) throw new RequestError(400, "Invalid catalog download selection");
    const selection = parsed.data;
    if (selection.file && selection.quant)
      throw new RequestError(400, "Choose a file or quant, not both");
    if (
      selection.componentsOnly &&
      (!selection.components?.length || selection.file || selection.quant)
    )
      throw new RequestError(
        400,
        "A component-only download needs component ids without a primary file or quant",
      );
    const model = this.ports.catalog().find((row) => row.id === selection.modelId);
    if (!model) throw new RequestError(404, "Brain catalog model not found");
    return this.admit(model.hfRepo, model.id, selection.quant ?? null, async (signal) => {
      const listing = selection.quant ? await this.quants(model.hfRepo, signal) : null;
      const choice = listing && selection.quant ? chosenQuant(listing, selection.quant) : null;
      if (model.components) return catalogBundle(model, selection, choice);
      if (selection.components?.length || selection.componentsOnly)
        throw new RequestError(400, "This model has no bundle components");
      if (choice && listing)
        return {
          repo: model.hfRepo,
          files: [...choice.files, ...(listing.mmproj?.files ?? [])],
          totalBytes: choice.sizeBytes + (listing.mmproj?.sizeBytes ?? 0),
        };
      return bundleDownloadPlan(model, [], selection.file ? [selection.file] : undefined);
    });
  }
  add(input: unknown) {
    const parsed = DirectSchema.safeParse(input);
    if (!parsed.success) throw new RequestError(400, "Choose a Hugging Face repository and quant");
    const { repo, quant } = parsed.data;
    return this.admit(repo, null, quant, async (signal) => {
      const listing = await this.quants(repo, signal);
      return directPlan(listing, parsed.data);
    });
  }
  private admit(
    repo: string,
    catalogModelId: string | null,
    quant: string | null,
    plan: (signal: AbortSignal) => Promise<DownloadPlan>,
  ) {
    if (!RepoSchema.safeParse(repo).success)
      throw new RequestError(400, "Invalid model repository");
    // Shared projectors must not be downloaded by two jobs in this host at once.
    if (
      this.ports.jobs
        .summaries()
        .some(
          (job) =>
            job.operation === "pull" &&
            (job.state === "queued" || job.state === "running") &&
            job.subject.repo?.toLowerCase() === repo.toLowerCase(),
        )
    )
      throw new RequestError(409, "A download from this repository is already active");
    const job = this.ports.jobs.start(
      "pull",
      { modelId: null, catalogModelId, repo, quant },
      async (context) => {
        context.started();
        const selected = await plan(context.signal);
        context.signal.throwIfAborted();
        const files = [...new Set(selected.files)];
        if (!files.length || files.length > 2048) throw new Error("Invalid model download plan");
        const destRoot = this.ports.destination();
        const destinations = files.map((file) => destinationFor(destRoot, selected.repo, file));
        try {
          await this.ports.download({
            repo: selected.repo,
            files,
            destRoot,
            token: this.ports.token(),
            signal: context.signal,
            onProgress: (event) =>
              context.progress({
                phase: "downloading",
                receivedBytes: event.receivedBytes,
                totalBytes: selected.totalBytes,
              }),
          });
        } finally {
          // Earlier files may be complete even when a later shard was canceled or failed.
          this.ports.changed();
        }
        context.signal.throwIfAborted();
        return {
          repo: selected.repo,
          files,
          path: destinations[0]!,
          totalBytes: selected.totalBytes,
        };
      },
    );
    return { job };
  }
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<boolean> {
    const url = new URL(request.url!, "http://brain.local");
    const route = `${request.method} ${url.pathname}`;
    if (!ROUTES.has(route)) return false;
    if (request.method === "POST") {
      this.ports.requireWrite(request);
      const body = await readObject(request, signal, 16 * 1024);
      sendJson(response, 202, route.endsWith("/pull") ? this.pull(body) : this.add(body));
    } else if (url.pathname === "/__host/catalog") sendJson(response, 200, this.catalog());
    else if (url.pathname === "/__host/hf/quants")
      sendJson(response, 200, await this.quants(url.searchParams.get("repo") ?? "", signal));
    else
      sendJson(
        response,
        200,
        await this.search(
          url.searchParams.get("query") ?? "",
          Number(url.searchParams.get("limit") ?? 25),
          signal,
        ),
      );
    return true;
  }
}

/** HTTP projection of host-owned operations; clients supply identities, never paths. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Model, GpuInfo } from "../types.js";
import type { BrainConfig, ProfilesStore } from "../config/schema.js";
import { getCalibrationForBudget } from "../config/profiles.js";
import { sanitizeProfilePatch } from "../config/profile-edit.js";
import { budget, maxContextThatFits, reserveBytesForGpu } from "../vram.js";
import type { ModelProfiles } from "./model-profiles.js";
import type { ModelOperations } from "./model-operations.js";
import { ModelJobRequestSchema } from "./model-job-options.js";
import type { BrainJobs } from "./jobs.js";
import type { InventoryRow } from "./inventory.js";
import type { DiskUsage } from "../models/manage.js";
import { readObject, RequestError, sendJson } from "./http-body.js";
import { ScanReplySchema, type ScanRow } from "../commands/scan-contract.js";

function discoveryMetadata(url: URL): boolean {
  const metadata = url.searchParams.getAll("metadata");
  if (
    metadata.length !== 1 ||
    (metadata[0] !== "true" && metadata[0] !== "false") ||
    [...url.searchParams.keys()].some((key) => key !== "metadata")
  )
    throw new RequestError(400, "An explicit metadata selection is required");
  return metadata[0] === "true";
}

interface ManagementPorts {
  config: BrainConfig;
  models(refresh?: boolean): Model[];
  discover(withMetadata: boolean): ScanRow[];
  profiles: ModelProfiles;
  readProfiles(): ProfilesStore;
  gpu(signal: AbortSignal): Promise<GpuInfo | null>;
  operations: ModelOperations;
  jobs: BrainJobs;
  requireWrite(request: IncomingMessage): void;
  changed(): void;
  requiresRestart(modelId: string, revision: string): boolean;
  inventory(
    signal: AbortSignal,
  ): Promise<{ models: InventoryRow[]; disk: (DiskUsage & { modelBytes: number }) | null }>;
}

export class EngineManagement {
  constructor(private readonly ports: ManagementPorts) {}

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<boolean> {
    const url = new URL(request.url!, "http://brain.local");
    if (url.pathname === "/__host/models/discover" && request.method === "GET") {
      sendJson(
        response,
        200,
        ScanReplySchema.parse({
          models: this.ports.discover(discoveryMetadata(url)),
        }),
      );
      return true;
    }
    if (url.pathname === "/__host/models" && request.method === "GET") {
      sendJson(response, 200, await this.ports.inventory(signal));
      return true;
    }
    if (url.pathname === "/__host/jobs/status" && request.method === "GET") {
      const job = this.ports.jobs.get(url.searchParams.get("id") ?? "");
      if (!job) throw new RequestError(404, "Brain job not found");
      sendJson(response, 200, { job });
      return true;
    }
    if (url.pathname === "/__host/jobs") return this.jobs(request, response, signal);
    if (url.pathname === "/__host/jobs/cancel" && request.method === "POST") {
      this.ports.requireWrite(request);
      const body = await readObject(request, signal);
      if (typeof body.id !== "string" || !this.ports.jobs.cancel(body.id))
        throw new RequestError(404, "Brain job not found");
      sendJson(response, 200, { ok: true });
      return true;
    }
    if (
      (url.pathname === "/__host/models/scan" || url.pathname === "/__host/models/rescan") &&
      request.method === "POST"
    ) {
      this.ports.requireWrite(request);
      sendJson(response, 200, {
        models: this.ports
          .models(true)
          .map((model) => ({ id: model.id, displayName: model.displayName })),
      });
      this.ports.changed();
      return true;
    }
    if (url.pathname === "/__host/model/profile")
      return this.profile(request, response, url, signal);
    if (url.pathname === "/__host/model/budget")
      return this.previewBudget(request, response, url, signal);
    return false;
  }

  private async previewBudget(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (request.method !== "POST") return false;
    const model = this.model(url);
    const current = this.ports.profiles.read(model);
    const body = await readObject(request, signal);
    const { profile } = sanitizeProfilePatch(current.profile, body.patch ?? {}, model);
    const gpu = await this.ports.gpu(signal);
    const calibration = getCalibrationForBudget(this.ports.readProfiles(), model, profile);
    const options = gpu
      ? {
          model,
          profile,
          calibration,
          totalVramBytes: gpu.totalBytes,
          reserveBytes: reserveBytesForGpu(gpu),
        }
      : null;
    sendJson(response, 200, {
      profile,
      revision: current.revision,
      budget: options ? budget(options) : null,
      maxContextThatFits: options ? maxContextThatFits(options) : null,
    });
    return true;
  }

  private model(url: URL): Model {
    const id = url.searchParams.get("id");
    if (!id) throw new RequestError(400, "A model id is required");
    const model = this.ports.models().find((candidate) => candidate.id === id);
    if (!model) throw new RequestError(404, "Brain model not found");
    return model;
  }

  private async profile(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (request.method !== "GET" && request.method !== "POST") return false;
    const model = this.model(url);
    if (request.method === "GET") {
      const metadata = this.ports.profiles.read(model);
      sendJson(response, 200, {
        ...metadata,
        requiresRestart: this.ports.requiresRestart(model.id, metadata.revision),
      });
    } else {
      this.ports.requireWrite(request);
      const body = await readObject(request, signal);
      if (typeof body.expectedRevision !== "string")
        throw new RequestError(400, "A profile revision is required");
      const saved = this.ports.profiles.save(model, body.patch, body.expectedRevision);
      this.ports.changed();
      const gpu = await this.ports.gpu(signal);
      const calibration = getCalibrationForBudget(this.ports.readProfiles(), model, saved.profile);
      const options = gpu
        ? {
            model,
            profile: saved.profile,
            calibration,
            totalVramBytes: gpu.totalBytes,
            reserveBytes: reserveBytesForGpu(gpu),
          }
        : null;
      sendJson(response, 200, {
        ...saved,
        requiresRestart: this.ports.requiresRestart(model.id, saved.revision),
        budget: options ? budget(options) : null,
        maxContextThatFits: options ? maxContextThatFits(options) : null,
      });
    }
    return true;
  }

  private async jobs(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (request.method === "GET") sendJson(response, 200, { jobs: this.ports.jobs.list(false) });
    else if (request.method === "POST") {
      this.ports.requireWrite(request);
      const body = await readObject(request, signal);
      // COMPAT(brainBenchJobName): added in v0.10.0; remove after 2027-04-23.
      const parsed = ModelJobRequestSchema.safeParse({
        ...body,
        operation: body.operation === "bench" ? "benchmark" : body.operation,
      });
      if (!parsed.success) throw new RequestError(400, "Invalid Brain job options");
      const options = parsed.data;
      const model = this.ports.models().find((candidate) => candidate.id === options.modelId);
      if (!model) throw new RequestError(404, "Brain model not found");
      sendJson(response, 202, {
        job: this.ports.operations.start(model, options.operation, options),
      });
    } else return false;
    return true;
  }
}

/** Batch projection of the canonical host library, without paths, secrets or per-model RPCs. */
import { z } from "zod/v3";
import type { Model, Runtime } from "../types.js";
import type { HostEngine } from "./engine.js";
import type { BrainJobs, BrainJob } from "./jobs.js";
import type { RuntimeManagement } from "./runtime-management.js";
import type { ModelAcquisition } from "./model-acquisition.js";
import type { BrainHostResources } from "./resource-reader.js";
import { profileFieldDescriptors } from "../config/profile-edit.js";
import type { RunRecord } from "../ops/results.js";
import { rankModels, latestPerConfig } from "../ops/results.js";
import { repoOfModel } from "../models/hf.js";
import {
  BrainTuiSnapshotSchema,
  TUI_ACTIONS,
  TUI_READ_ACTIONS,
  TuiProfileSchema,
  TuiBenchmarkSchema,
} from "../tui/contracts.js";
import { BrainTuiLiveSchema, tuiResidents } from "../tui/live.js";
import type { BrainTuiSnapshot, TuiModel, TuiJob } from "../tui/host.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./http-body.js";
import { tuiJob } from "../tui/jobs.js";

export interface TuiProjectionPorts {
  revision(): { library: number; jobs: number };
  status(): ReturnType<HostEngine["snapshot"]>;
  resources(signal: AbortSignal): Promise<BrainHostResources>;
  inventory(
    signal: AbortSignal,
    gpu: BrainHostResources["gpu"],
  ): ReturnType<HostEngine["inventory"]>;
  models(): Model[];
  runtime(): Runtime | null;
  runtimes(): ReturnType<RuntimeManagement["list"]>;
  catalog(): ReturnType<ModelAcquisition["catalog"]>;
  jobs: BrainJobs;
  results(): RunRecord[];
  names(): Record<string, string>;
  deletion(modelId: string): { bytes: number | null; blocked: string | null };
  requireWrite(request: IncomingMessage): void;
}

export class BrainTuiReadService {
  constructor(private readonly ports: TuiProjectionPorts) {}
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (request.method !== "GET") return false;
    switch (request.url?.split("?")[0]) {
      case "/__host/tui": {
        let writable = true;
        try {
          this.ports.requireWrite(request);
        } catch {
          writable = false;
        }
        sendJson(response, 200, await projectBrainTui(this.ports, writable, signal));
        return true;
      }
      case "/__host/tui/resources":
        sendJson(response, 200, await this.ports.resources(signal));
        return true;
      case "/__host/tui/jobs":
        sendJson(response, 200, tuiJobs(this.ports.jobs.list()));
        return true;
      default:
        return false;
    }
  }
}
const Sweep = z.object({
  recommended: z.number().nullable(),
  results: z.array(
    z.object({
      budget: z.number(),
      error: z.string().nullable(),
      contentChars: z.number(),
      filesDelivered: z.number(),
      elapsedSeconds: z.number().nullable().optional(),
    }),
  ),
});

export function tuiJobs(jobs: BrainJob[]): TuiJob[] {
  return jobs.map(tuiJob);
}
function sweepFor(jobs: BrainJob[], modelId: string): TuiModel["sweep"] {
  const job = jobs
    .toReversed()
    .find(
      (row) =>
        row.operation === "sweep" && row.subject.modelId === modelId && row.state === "completed",
    );
  const value = Sweep.safeParse(job?.result);
  if (!value.success) return null;
  return {
    recommended: value.data.recommended,
    results: value.data.results.map((row) => ({
      budget: row.budget,
      error: row.error,
      contentChars: row.contentChars,
      filesDelivered: row.filesDelivered,
      elapsedSeconds: row.elapsedSeconds ?? undefined,
    })),
  };
}

export async function projectBrainTui(
  ports: TuiProjectionPorts,
  writable: boolean,
  signal: AbortSignal,
): Promise<BrainTuiSnapshot> {
  // Tag the read's origin rather than claiming a peer's later revision for older rows.
  const revision = ports.revision();
  const resources = await ports.resources(signal);
  const inventory = await ports.inventory(signal, resources.gpu);
  signal.throwIfAborted();
  const status = BrainTuiLiveSchema.parse(await ports.status());
  const models = new Map(ports.models().map((model) => [model.id, model]));
  const names = ports.names();
  const jobs = ports.jobs.list();
  const rows: TuiModel[] = inventory.models.flatMap((row) => {
    const model = models.get(row.id);
    if (!model) return [];
    const profile = TuiProfileSchema.parse(row.profile);
    const deletion = ports.deletion(row.id);
    const kv = row.calibration.kvBytesPerToken;
    return [
      {
        model: {
          id: model.id,
          displayName: model.displayName,
          repo: repoOfModel(model),
          hasProjector: row.hasProjector,
          quant: model.quant,
          mmprojBytes: model.mmprojBytes,
          sizeBytes: model.sizeBytes,
          features: model.features,
          metadata: model.metadata,
          thinking: model.thinking,
        },
        profile,
        revision: row.revision,
        fields: profileFieldDescriptors(model, row.profile).filter((field) =>
          Object.hasOwn(profile, field.key),
        ),
        warnings: row.warnings,
        calibration:
          kv === null
            ? null
            : { kvBytesPerToken: kv, inherited: row.calibration.state === "inherited" },
        calibrationStale: row.calibration.state === "stale",
        budget: row.budget,
        maxContext: row.maxContextThatFits,
        sweep: sweepFor(jobs, model.id),
        renamed: Object.hasOwn(names, model.id),
        deleteBytes: deletion.bytes,
        deleteBlocked: deletion.blocked,
      },
    ];
  });
  const runtimes = ports.runtimes();
  const runtime = ports.runtime();
  const results = ports.results();
  return BrainTuiSnapshotSchema.parse({
    instanceId: status.instanceId,
    libraryRevision: revision.library,
    jobRevision: revision.jobs,
    version: status.version,
    connection: "connected",
    state: status.state,
    message: null,
    endpoint: null,
    runtime: runtime && { label: runtime.displayName ?? runtime.label, version: runtime.version },
    gpu: resources.gpu,
    system: {
      ...resources,
      gpu: resources.gpu && {
        ...resources.gpu,
        utilization: resources.gpu.utilization ?? null,
        temperature: resources.gpu.temperature ?? null,
      },
    },
    models: rows,
    residents: tuiResidents(status),
    logs: [],
    jobs: tuiJobs(jobs),
    storage: inventory.disk,
    catalog: ports.catalog().models.map((entry) => ({
      id: entry.id,
      displayName: entry.name,
      description: entry.why ?? "",
      installed: entry.installed,
    })),
    runtimes: [
      ...runtimes.runtimes.map((entry) => ({
        id: entry.id,
        label: entry.displayName,
        version: entry.version,
        installed: true,
        selected: entry.selected,
        unavailableReason: null,
      })),
      ...runtimes.candidates.map((entry) => ({
        id: entry.id,
        label: `${entry.build} / ${entry.variant}`,
        version: entry.build,
        installed: false,
        selected: false,
        unavailableReason: null,
      })),
    ],
    telemetry: status.telemetry,
    rankings: rankModels(results),
    benchmarks: latestPerConfig(results).map((record) => TuiBenchmarkSchema.parse(record)),
    availableActions: TUI_ACTIONS.filter((action) => writable || TUI_READ_ACTIONS.has(action)),
  });
}

/** Capacity/quality jobs use the resident pool's exclusive operation lease. */
import type { Model, GpuInfo } from "../types.js";
import type { Profile } from "../config/schema.js";
import { calibrate } from "../ops/calibrate.js";
import { sweep } from "../ops/sweep.js";
import { runSuite } from "../bench/index.js";
import * as archive from "../ops/archive.js";
import * as results from "../ops/results.js";
import type { ManagedModelProcess } from "./process-pool.js";
import type { EngineProcess } from "./engine-process.js";
import { BrainJobs, type BrainJobContext, type JobValue } from "./jobs.js";
import type { ModelProfiles } from "./model-profiles.js";
import { maxContextThatFits, reserveBytesForGpu } from "../vram.js";
import type { ModelJobRequest } from "./model-job-options.js";

export type ModelOperation = "calibrate" | "sweep" | "benchmark";
export interface ModelOperationPorts {
  env: NodeJS.ProcessEnv;
  profiles: ModelProfiles;
  gpu(signal: AbortSignal): Promise<GpuInfo | null>;
  readUsedBytes(signal?: AbortSignal): Promise<number | null>;
  operation<T>(
    model: Model,
    kind: ModelOperation,
    run: (lease: ManagedModelProcess<EngineProcess>) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T>;
  calibrate?: typeof calibrate;
  sweep?: typeof sweep;
  runSuite?: typeof runSuite;
  save?: typeof results.save;
}

/** Public progress carries measured fields, never a nested native exception. */
function progress(context: BrainJobContext, event: object): void {
  const safe: { [key: string]: JobValue } = {};
  const failed = "phase" in event && event.phase === "failed";
  for (const [key, value] of Object.entries(event)) {
    if (key === "error" || key === "reason" || key === "detail") continue;
    if (typeof value === "string") {
      safe[key] = failed && key === "summary" ? "Brain benchmark task failed" : value.slice(0, 256);
      continue;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      safe[key] = value;
  }
  context.progress(safe);
}

export class ModelOperations {
  constructor(
    private readonly jobs: BrainJobs,
    private readonly ports: ModelOperationPorts,
  ) {}

  start(model: Model, operation: ModelOperation, options?: ModelJobRequest) {
    return this.jobs.start(
      operation,
      { modelId: model.id, catalogModelId: null, repo: null, quant: null },
      (context) =>
        this.ports.operation(
          model,
          operation,
          async (lease) => {
            context.started();
            const { profile, revision } = this.ports.profiles.read(model);
            if (operation === "calibrate") return this.calibration(model, profile, lease, context);
            if (operation === "sweep")
              return this.reasoningSweep(
                model,
                profile,
                revision,
                lease,
                context,
                options?.operation === "sweep" ? options.budgets : undefined,
              );
            return this.benchmark(model, lease, context);
          },
          context.signal,
        ),
    );
  }

  private async calibration(
    model: Model,
    profile: Profile,
    lease: ManagedModelProcess<EngineProcess>,
    context: BrainJobContext,
  ): Promise<JobValue> {
    const gpu = await this.ports.gpu(context.signal);
    const prior = this.ports.profiles.measurement(model, profile);
    context.signal.throwIfAborted();
    const measurement = await (this.ports.calibrate ?? calibrate)({
      model,
      profile,
      process: lease,
      gpu,
      signal: context.signal,
      readUsedBytes: this.ports.readUsedBytes,
      priorCalibration: prior && !prior.inherited ? prior : null,
      onProgress: (event) => progress(context, event),
    });
    context.signal.throwIfAborted();
    this.ports.profiles.recordCalibration(model, profile, measurement);
    return {
      kvBytesPerToken: measurement.kvBytesPerToken,
      baseOverheadBytes: measurement.baseOverheadBytes,
      measuredAt: measurement.measuredAt,
      theoreticalKvBytesPerToken: measurement.theoreticalKvBytesPerToken,
      maxContext: gpu
        ? maxContextThatFits({
            model,
            profile,
            calibration: measurement,
            totalVramBytes: gpu.totalBytes,
            reserveBytes: reserveBytesForGpu(gpu),
          })
        : null,
    };
  }

  private async reasoningSweep(
    model: Model,
    profile: Profile,
    revision: string,
    lease: ManagedModelProcess<EngineProcess>,
    context: BrainJobContext,
    budgets?: number[],
  ): Promise<JobValue> {
    const report = await (this.ports.sweep ?? sweep)({
      process: lease,
      profile,
      budgets,
      signal: context.signal,
      onProgress: (event) => progress(context, event),
    });
    context.signal.throwIfAborted();
    const applied = this.ports.profiles.recordSweep(model, revision, report.recommended);
    return {
      recommended: report.recommended,
      applied,
      sweptAt: report.sweptAt,
      results: report.results.map((trial) => ({
        budget: trial.budget,
        error: trial.error ? "Brain sweep trial failed" : null,
        contentChars: trial.contentChars,
        filesDelivered: trial.filesDelivered,
        tokensPerSecond: trial.tokensPerSecond ?? null,
        elapsedSeconds: trial.elapsedSeconds ?? null,
      })),
    };
  }

  private async benchmark(
    model: Model,
    lease: ManagedModelProcess<EngineProcess>,
    context: BrainJobContext,
  ): Promise<JobValue> {
    try {
      await lease.start();
      const actual = lease.supervisor.profile;
      if (!actual) throw new Error("Brain benchmark has no loaded profile");
      const archiveId = archive.runId(model);
      const report = await (this.ports.runSuite ?? runSuite)({
        env: this.ports.env,
        host: lease.supervisor.host,
        port: lease.supervisor.internalPort,
        signal: context.signal,
        archiveId,
        reasoningBudget: actual.reasoningBudget,
        contextWindow: actual.contextSize,
        onProgress: (event) => progress(context, event),
      });
      context.signal.throwIfAborted();
      const saved = (this.ports.save ?? results.save)(
        {
          model,
          profile: actual,
          report,
          archiveId,
          runtime: lease.supervisor.runtime?.label ?? null,
          args: lease.supervisor.args,
          calibration: this.ports.profiles.measurement(model, actual),
          fit: lease.supervisor.fit,
          gpu: lease.supervisor.gpu,
        },
        this.ports.env,
      );
      return {
        overall: saved.record.overall,
        grade: saved.record.grade,
        ranAt: saved.record.ranAt,
        archiveId,
      };
    } finally {
      await lease.stop();
    }
  }
}

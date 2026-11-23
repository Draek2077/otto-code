/** Presentation normalization after the owning daemon's allowlist validation. */
import { z } from "zod";
import {
  BrainCatalogSchema,
  BrainQuantsSchema,
  BrainJobSchema,
  BrainProfileReadSchema,
  BrainEvalsSchema,
} from "@getpaseo/protocol/otto/brain-library";
import type {
  BrainCatalogModel,
  BrainRepoQuant,
  BrainJob,
  BrainProfileRead,
} from "../screens/contracts/models";
import type { BrainEvals, LatestRun, RunProfile, RunSetup } from "../screens/contracts/benchmark";

function size(bytes: number | undefined): string {
  if (bytes === undefined) return "Unknown size";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
export function catalogToView(value: z.infer<typeof BrainCatalogSchema>): BrainCatalogModel[] {
  return value.models.map((model) => ({
    id: model.id,
    name: model.name,
    family: model.family,
    favorite: model.favorite,
    installed: model.installed,
    publisher: model.publisher ?? "",
    repo: model.hfRepo,
    quant: model.quant,
    params: model.params ?? "",
    sizeBytes: model.approxWeightsBytes,
    size: size(model.approxWeightsBytes),
    vision: model.vision ?? false,
    thinking: model.thinking ?? false,
    contextMax: model.contextMax,
    tier: model.tier ?? "",
    useCases: model.useCases ?? [],
    why: model.why ?? "",
    components: model.components,
  }));
}
export function quantsToView(value: z.infer<typeof BrainQuantsSchema>): BrainRepoQuant[] {
  return value.quants.map((quant) => ({
    quant: quant.quant,
    size: size(quant.sizeBytes),
    sizeBytes: quant.sizeBytes,
    files: quant.files.length,
    fileNames: quant.files,
    installed: quant.installed,
    modelId: quant.modelId,
    ...(value.mmproj
      ? {
          projector: {
            file: value.mmproj.files.join(", "),
            sizeBytes: value.mmproj.sizeBytes,
            installed: value.mmproj.installed,
          },
        }
      : {}),
  }));
}
export function profileToView(value: z.infer<typeof BrainProfileReadSchema>): BrainProfileRead {
  return {
    ...value,
    fields: value.fields.map((field) =>
      Object.assign({}, field, {
        options: field.options ?? [],
        optionLabels: field.optionLabels ?? [],
      }),
    ),
  };
}
const JOB_LABELS = {
  calibrate: "Calibrate model",
  sweep: "Compare reasoning budgets",
  benchmark: "Benchmark model",
  pull: "Download model",
  "runtime-install": "Install runtime",
  "runtime-remove": "Remove runtime",
} as const;
export function jobToView(job: z.infer<typeof BrainJobSchema>): BrainJob {
  const progress = job.progress;
  let percent = progress?.percent ?? null;
  if (
    percent === null &&
    progress?.receivedBytes !== null &&
    progress?.receivedBytes !== undefined &&
    progress.totalBytes &&
    progress.totalBytes > 0
  )
    percent = (progress.receivedBytes / progress.totalBytes) * 100;
  return {
    id: job.id,
    kind: job.operation === "benchmark" ? "bench" : job.operation,
    label: job.benchmarkMode === "rescore" ? "Rescore saved benchmark" : JOB_LABELS[job.operation],
    ...job.subject,
    status: jobStatus(job.state),
    percent: percent === null ? null : Math.max(0, Math.min(100, percent)),
    message: progress?.message ?? progress?.summary ?? progress?.phase ?? null,
    error: job.error,
    startedAt: job.startedAt ?? job.createdAt,
    finishedAt: job.finishedAt,
  };
}
function jobStatus(state: z.infer<typeof BrainJobSchema>["state"]): BrainJob["status"] {
  if (state === "queued") return "running";
  if (state === "completed") return "succeeded";
  return state;
}
type Evals = z.infer<typeof BrainEvalsSchema>;
type RecordedProfile = NonNullable<Evals["latest"][number]["profile"]>;
function runSampling(profile: RecordedProfile) {
  return {
    temperature: profile.temperature ?? null,
    topP: profile.topP ?? null,
    topK: profile.topK ?? null,
    minP: profile.minP ?? null,
    presencePenalty: profile.presencePenalty ?? null,
    repeatPenalty: profile.repeatPenalty ?? null,
  };
}
function runProfile(profile: RecordedProfile): RunProfile {
  return {
    contextSize: profile.contextSize ?? null,
    cacheTypeK: profile.cacheTypeK ?? null,
    cacheTypeV: profile.cacheTypeV ?? null,
    reasoningBudget: profile.reasoningBudget ?? null,
    vision: profile.vision ?? null,
    flashAttention: profile.flashAttention ?? null,
    gpuLayers: profile.gpuLayers ?? null,
    parallelSlots: profile.parallelSlots ?? null,
    batchSize: profile.batchSize ?? null,
    ubatchSize: profile.ubatchSize ?? null,
    extraArgs: profile.extraArgs ?? [],
    preserveReasoning: profile.preserveReasoning ?? null,
    contextMultiplier: profile.contextMultiplier ?? null,
    cachedChats: profile.cachedChats ?? null,
    ...runSampling(profile),
    hostingProfileId: profile.hostingProfileId ?? null,
  };
}
function runSetup(setup: NonNullable<Evals["latest"][number]["setup"]>): RunSetup {
  return {
    args: setup.args ?? [],
    adjusted: setup.adjusted,
    requestedContextSize: setup.requestedContextSize ?? null,
    adjustReason: setup.adjustReason ?? null,
    kvSource: setup.kvSource ?? null,
    kvInherited: setup.kvInherited ?? false,
    kvBytesPerToken: setup.kvBytesPerToken ?? null,
    theoreticalKvBytesPerToken: setup.theoreticalKvBytesPerToken ?? null,
    predictedVramBytes: setup.predictedVramBytes ?? null,
    headroomBytes: setup.headroomBytes ?? null,
  };
}
function runToView(run: Evals["latest"][number]): LatestRun {
  return {
    key: JSON.stringify([run.model.id, run.model.displayName, run.configKey, run.ranAt]),
    modelId: run.model.id ?? null,
    modelName: run.model.displayName,
    configKey: run.configKey,
    ranAt: run.ranAt,
    overall: run.overall,
    grade: run.grade,
    seconds: run.seconds,
    executedCode: run.executedCode ?? null,
    vramBytes: run.vramBytes ?? null,
    loadSeconds: run.loadSeconds ?? null,
    runtime: run.runtime ?? null,
    gpuName: run.gpu?.name ?? null,
    nativeContextLength: run.model.contextLength ?? null,
    blockCount: run.model.blockCount ?? null,
    profile: run.profile ? runProfile(run.profile) : null,
    setup: run.setup ? runSetup(run.setup) : null,
    suite: run.suite ?? null,
    tasks: run.tasks.map((task) => ({
      key: task.id,
      category: task.category,
      summary: task.summary ?? null,
      weight: task.weight ?? null,
      score: task.score,
      seconds: task.seconds ?? null,
      error: task.error ?? null,
    })),
  };
}
export function evalsToView(value: Evals): BrainEvals {
  return {
    rankings: value.rankings.map((row, index) => ({
      id: row.id ?? row.displayName,
      name: row.displayName,
      overall: row.overall,
      runs: row.runs,
      std: row.std,
      grade: row.grade,
      rank: row.rank ?? index + 1,
    })),
    variance: value.variance.map((row) => ({
      key: row.key,
      modelId: row.model.id ?? null,
      modelName: row.model.displayName,
      configKey: row.configKey,
      count: row.count,
      mean: row.overall?.mean ?? null,
      std: row.overall?.std ?? null,
    })),
    latest: value.latest.map(runToView),
    runCount: value.runCount,
  };
}

/** Terminal presentation contract, independent of Otto's app and WebSocket protocol. */
import { z } from "zod/v3";
import type { BrainTuiSnapshot, TuiBenchmark } from "./host.js";

const Text = z.string().max(32768);
const Number = z.number().finite();
const NullableNumber = Number.nullable();
const NullableText = Text.nullable();
export const TuiProfileSchema = z.object({
  contextSize: Number,
  cacheTypeK: Text,
  cacheTypeV: Text,
  flashAttention: z.boolean(),
  gpuLayers: Number,
  vision: z.boolean(),
  enabledComponents: z.array(Text).max(100),
  reasoningBudget: Number,
  reasoningBudgetMessage: Text,
  preserveReasoning: z.boolean().nullable().optional(),
  temperature: Number,
  topP: Number,
  topK: Number,
  minP: Number,
  presencePenalty: Number,
  repeatPenalty: Number,
  parallelSlots: Number,
  cachedChats: Number,
  contextMultiplier: Number,
  calibrationRequired: z.boolean(),
  hostingProfileId: NullableText,
  hostingProfileMode: z.enum(["inherit", "off", "custom"]),
});
const State = z.enum(["starting", "ready", "stopping", "stopped", "failed"]);
const Metadata = z.object({
  arch: NullableText.optional(),
  name: NullableText.optional(),
  contextLength: NullableNumber.optional(),
  blockCount: NullableNumber.optional(),
  headCountKv: NullableNumber.optional(),
  reasoning: z.boolean().optional(),
});
const Gpu = z.object({
  name: Text,
  totalBytes: Number,
  usedBytes: NullableNumber,
  freeBytes: NullableNumber,
  driver: Text,
  computeCapability: Text,
});
export const TuiFieldSchema = z.object({
  key: Text,
  label: Text,
  kind: z.enum(["number", "toggle", "cycle"]),
  description: Text.optional(),
  step: Number.optional(),
  min: Number.optional(),
  max: Number.optional(),
  precision: Number.optional(),
  options: z
    .array(z.union([Text, Number]))
    .max(1000)
    .optional(),
  optionLabels: z.array(Text).max(1000).optional(),
  optionValues: z
    .array(z.union([Text, Number, z.boolean(), z.null()]))
    .max(1000)
    .optional(),
  available: z.boolean(),
  unavailableReason: Text.optional(),
});
export const TuiWarningSchema = z.object({
  field: NullableText,
  severity: z.enum(["error", "warn", "info"]),
  message: Text,
  blocksStart: z.boolean(),
});
export const TuiBudgetSchema = z.object({
  weightsBytes: Number,
  mmprojBytes: Number,
  componentBytes: Number,
  drafterKvBytes: Number,
  imageProcessingBytes: Number,
  kvBytes: Number,
  overheadBytes: Number,
  totalBytes: Number,
  usableBytes: Number,
  totalVramBytes: Number,
  reserveBytes: Number,
  kvBytesPerToken: Number,
  source: z.enum(["measured", "theoretical", "unknown"]),
  theoreticalKvBytesPerToken: NullableNumber,
  fits: z.boolean(),
  headroomBytes: Number,
  utilization: Number,
});
const Sweep = z.object({
  results: z
    .array(
      z.object({
        budget: Number,
        error: NullableText,
        contentChars: Number,
        filesDelivered: Number,
        elapsedSeconds: Number.optional(),
      }),
    )
    .max(100),
  recommended: NullableNumber,
});
const Model = z.object({
  model: z.object({
    id: Text,
    displayName: Text,
    repo: NullableText,
    hasProjector: z.boolean(),
    mmprojBytes: Number,
    quant: NullableText,
    sizeBytes: Number,
    features: z.object({ mtp: z.boolean(), imatrix: z.boolean(), distilled: z.boolean() }),
    metadata: Metadata.nullable(),
    thinking: z.boolean().optional(),
  }),
  revision: Text,
  profile: TuiProfileSchema,
  fields: z.array(TuiFieldSchema).max(100),
  warnings: z.array(TuiWarningSchema).max(100),
  calibration: z.object({ kvBytesPerToken: Number, inherited: z.boolean() }).nullable(),
  calibrationStale: z.boolean(),
  budget: TuiBudgetSchema.nullable(),
  maxContext: NullableNumber,
  sweep: Sweep.nullable(),
  renamed: z.boolean(),
  deleteBytes: NullableNumber,
  deleteBlocked: NullableText,
});
const Job = z.object({
  id: Text,
  operation: z.enum(["calibrate", "sweep", "bench", "pull", "runtime"]),
  modelId: NullableText,
  state: z.enum(["queued", "running", "completed", "failed", "canceled"]),
  progress: z.array(Text).max(100),
  fraction: NullableNumber,
  error: NullableText,
  cancelable: z.boolean(),
});
export const BrainTuiJobsSchema = z.array(Job).max(100);
export const BrainTuiResourcesSchema = z.object({
  cpu: NullableNumber,
  cpuCount: Number,
  ramUsedBytes: Number,
  ramTotalBytes: Number,
  gpu: Gpu.extend({
    utilization: NullableNumber.optional(),
    temperature: NullableNumber.optional(),
  }).nullable(),
});
const Detail = z.object({
  concurrency: Number.optional(),
  genPerSecond: NullableNumber.optional(),
  promptPerSecond: NullableNumber.optional(),
  contextUtilization: NullableNumber.optional(),
  peakPromptTokens: NullableNumber.optional(),
});
export const TuiBenchmarkSchema: z.ZodType<TuiBenchmark> = z.object({
  ranAt: Text,
  configKey: Text,
  overall: Number,
  grade: Text,
  seconds: Number,
  model: z.object({ id: NullableText.optional(), displayName: Text }),
  tasks: z
    .array(
      z.object({ id: Text, category: Text, score: Number, detail: Detail.nullable().optional() }),
    )
    .max(1000),
});
export const TUI_ACTIONS = [
  "refresh",
  "profile.save",
  "profile.fit",
  "model.load",
  "model.unload",
  "model.rename",
  "model.resetName",
  "model.delete",
  "hf.search",
  "hf.quants",
  "hf.add",
  "catalog.pull",
  "runtime.install",
  "runtime.select",
  "runtime.remove",
  "job.start",
  "job.cancel",
] as const;
export const TUI_READ_ACTIONS: ReadonlySet<string> = new Set(["refresh", "hf.search", "hf.quants"]);

export const BrainTuiSnapshotSchema: z.ZodType<BrainTuiSnapshot> = z.object({
  instanceId: Text,
  libraryRevision: Number,
  jobRevision: Number,
  version: Text,
  connection: z.enum(["connected", "connecting", "disconnected"]),
  endpoint: NullableText,
  state: State,
  message: NullableText,
  runtime: z.object({ label: Text, version: Text }).nullable(),
  gpu: Gpu.nullable(),
  system: z
    .object({
      cpu: NullableNumber,
      cpuCount: Number,
      ramUsedBytes: Number,
      ramTotalBytes: Number,
      gpu: Gpu.extend({ utilization: NullableNumber, temperature: NullableNumber }).nullable(),
    })
    .nullable(),
  models: z.array(Model).max(10000),
  residents: z
    .array(
      z.object({
        residentId: Text,
        modelId: Text,
        displayName: Text,
        phase: State,
        pid: NullableNumber,
        slots: z
          .array(
            z.object({
              slot: Number,
              phase: z.enum(["idle", "processing", "thinking", "generating"]),
            }),
          )
          .max(256),
      }),
    )
    .max(16),
  logs: z.array(Text).max(2000),
  jobs: z.array(Job).max(100),
  catalog: z
    .array(z.object({ id: Text, displayName: Text, description: Text, installed: z.boolean() }))
    .max(10000),
  runtimes: z
    .array(
      z.object({
        id: Text,
        label: Text,
        version: Text,
        installed: z.boolean(),
        selected: z.boolean(),
        unavailableReason: NullableText,
      }),
    )
    .max(1064),
  storage: z.object({ modelBytes: Number, freeBytes: Number, totalBytes: Number }).nullable(),
  telemetry: z.object({
    requests: Number,
    ok: Number,
    reasoningOnly: Number,
    truncated: Number,
    warning: NullableText,
  }),
  rankings: z
    .array(
      z.object({
        id: NullableText,
        displayName: Text,
        overall: Number,
        runs: Number,
        std: Number,
        grade: Text,
        rank: Number.optional(),
      }),
    )
    .max(10000),
  benchmarks: z.array(TuiBenchmarkSchema).max(10000),
  availableActions: z.array(z.enum(TUI_ACTIONS)).max(100),
});

/** Allowlisted Brain library data inside the existing encrypted plugin RPC channel. */
import { z } from "zod";

const Text = z.string();
const Numeric = z.number().finite();
const NullableNumber = Numeric.nullable();
const NullableText = Text.nullable();
const FieldValue = z.union([Text, Numeric, z.boolean(), z.null()]);
export const BrainProfileSchema = z.object({
  contextSize: Numeric,
  cacheTypeK: Text,
  cacheTypeV: Text,
  flashAttention: z.boolean(),
  gpuLayers: Numeric,
  vision: z.boolean(),
  enabledComponents: z.array(Text),
  reasoningBudget: Numeric,
  reasoningBudgetMessage: Text,
  preserveReasoning: z.boolean().nullable().optional(),
  temperature: Numeric,
  topP: Numeric,
  topK: Numeric,
  minP: Numeric,
  presencePenalty: Numeric,
  repeatPenalty: Numeric,
  parallelSlots: Numeric,
  cachedChats: Numeric,
  contextMultiplier: Numeric,
  calibrationRequired: z.boolean(),
  hostingProfileId: NullableText,
  hostingProfileMode: z.enum(["inherit", "off", "custom"]),
});
export const BrainProfileWarningSchema = z.object({
  field: NullableText,
  severity: Text,
  message: Text,
  blocksStart: z.boolean(),
});
const Calibration = z.object({
  state: Text,
  kvBytesPerToken: NullableNumber,
  measuredAt: NullableText,
  measuredOn: NullableText,
});
export const BrainBudgetSchema = z.object({
  weightsBytes: Numeric,
  mmprojBytes: Numeric,
  componentBytes: Numeric.optional(),
  drafterKvBytes: Numeric.optional(),
  imageProcessingBytes: Numeric.optional(),
  kvBytes: Numeric,
  overheadBytes: Numeric,
  totalBytes: Numeric,
  usableBytes: Numeric,
  totalVramBytes: Numeric,
  reserveBytes: Numeric,
  kvBytesPerToken: Numeric,
  source: Text,
  theoreticalKvBytesPerToken: NullableNumber,
  fits: z.boolean(),
  headroomBytes: Numeric,
  utilization: Numeric,
});
const ProfileField = z.object({
  key: Text,
  label: Text,
  kind: z.enum(["number", "toggle", "cycle"]),
  description: NullableText.optional(),
  step: NullableNumber.optional(),
  min: NullableNumber.optional(),
  max: NullableNumber.optional(),
  precision: NullableNumber.optional(),
  options: z.array(z.union([Text, Numeric])).optional(),
  optionLabels: z.array(Text).optional(),
  optionValues: z.array(FieldValue).optional(),
  available: z.boolean(),
  unavailableReason: NullableText.optional(),
});
const HostingProfile = z.object({
  id: Text,
  name: Text,
  family: Text,
  description: Text,
  template: NullableText,
  systemPromptAddendum: NullableText,
  templateKwargs: z.record(Text, z.json()),
});
export const BrainProfileReadSchema = z.object({
  revision: Text,
  profile: BrainProfileSchema.nullable(),
  fields: z.array(ProfileField).max(100),
  warnings: z.array(BrainProfileWarningSchema).max(100),
  calibration: Calibration.nullable(),
  requiresRestart: z.boolean(),
  hostingProfiles: z.array(HostingProfile).max(1000),
  familyHostingProfileId: NullableText,
});
export const BrainProfileSavedSchema = BrainProfileReadSchema.extend({
  budget: BrainBudgetSchema.nullable(),
  maxContextThatFits: NullableNumber,
  adjustments: z.array(Text),
});
export const BrainBudgetPreviewSchema = z.object({
  budget: BrainBudgetSchema.nullable(),
  maxContextThatFits: NullableNumber,
});
const Component = z.object({
  id: Text,
  label: Text,
  description: Text,
  role: Text,
  bytes: Numeric,
  available: z.boolean(),
  unavailableReason: Text.optional(),
  required: z.boolean(),
  defaultDownload: z.boolean(),
  defaultLoad: z.boolean(),
  minRuntimeBuild: Numeric.optional(),
});
export const BrainInventorySchema = z.object({
  lastModelId: NullableText.optional(),
  models: z
    .array(
      z.object({
        id: Text,
        repo: NullableText,
        catalogOwned: z.boolean(),
        displayName: Text,
        family: NullableText.optional(),
        publisher: NullableText,
        quant: NullableText,
        sizeBytes: Numeric,
        mmprojBytes: Numeric,
        origin: NullableText,
        arch: NullableText,
        contextLength: NullableNumber,
        blockCount: NullableNumber,
        headCountKv: NullableNumber,
        hasProjector: z.boolean(),
        components: z.array(Component).nullable().optional(),
        reasoning: z.boolean(),
        mtp: z.boolean(),
        distilled: z.boolean(),
        useCases: z.array(Text),
        tier: NullableText,
        profile: BrainProfileSchema.nullable(),
        calibration: Calibration.nullable(),
        budget: BrainBudgetSchema.nullable(),
        maxContextThatFits: NullableNumber,
        score: z
          .object({
            id: NullableText,
            displayName: Text,
            overall: Numeric,
            runs: Numeric,
            std: Numeric,
            grade: Text,
            rank: NullableNumber.optional(),
          })
          .nullable(),
        state: Text,
        warnings: z.array(BrainProfileWarningSchema),
      }),
    )
    .max(10000),
  disk: z.object({ freeBytes: Numeric, totalBytes: Numeric, modelBytes: Numeric }).nullable(),
});
export const BrainCatalogSchema = z.object({
  models: z
    .array(
      z.object({
        id: Text,
        name: Text,
        family: Text.optional(),
        favorite: z.boolean(),
        installed: z.boolean(),
        hfRepo: Text,
        quant: Text,
        publisher: Text.optional(),
        params: Text.optional(),
        approxWeightsBytes: Numeric.optional(),
        vision: z.boolean().optional(),
        thinking: z.boolean().optional(),
        contextMax: Numeric.optional(),
        useCases: z.array(Text).optional(),
        tier: Text.optional(),
        why: Text.optional(),
        components: z
          .array(
            z.object({
              id: Text,
              label: Text,
              description: Text,
              role: Text,
              file: Text,
              hfRepo: Text.optional(),
              bytes: NullableNumber.optional(),
              required: z.boolean(),
              defaultDownload: z.boolean(),
              defaultLoad: z.boolean(),
              minRuntimeBuild: Numeric.optional(),
            }),
          )
          .optional(),
      }),
    )
    .max(10000),
});
export const BrainSearchSchema = z.object({
  models: z
    .array(
      z.object({
        repo: Text,
        downloads: Numeric,
        likes: Numeric,
        gated: z.boolean(),
        summary: NullableText,
        installed: z.boolean(),
      }),
    )
    .max(100),
});
export const BrainQuantsSchema = z.object({
  repo: Text,
  quants: z
    .array(
      z.object({
        quant: Text,
        files: z.array(Text),
        sizeBytes: Numeric,
        installed: z.boolean(),
        modelId: NullableText,
      }),
    )
    .max(10000),
  mmproj: z.object({ files: z.array(Text), sizeBytes: Numeric, installed: z.boolean() }).nullable(),
});
export const BrainRuntimeListSchema = z.object({
  runtimes: z
    .array(z.object({ id: Text, label: Text, displayName: Text, version: Text, source: Text }))
    .max(1000),
  candidates: z.array(z.object({ id: Text, build: Text, variant: Text })).max(64),
});
export const BrainJobSchema = z.object({
  id: Text,
  benchmarkMode: z.literal("rescore").optional(),
  operation: z.enum([
    "calibrate",
    "sweep",
    "benchmark",
    "pull",
    "runtime-install",
    "runtime-remove",
  ]),
  subject: z.object({
    modelId: NullableText,
    catalogModelId: NullableText,
    repo: NullableText,
    quant: NullableText,
  }),
  state: z.enum(["queued", "running", "completed", "failed", "canceled"]),
  createdAt: Text,
  startedAt: NullableText,
  finishedAt: NullableText,
  error: NullableText,
  progress: z
    .object({
      phase: Text.optional(),
      summary: Text.optional(),
      message: Text.optional(),
      receivedBytes: NullableNumber.optional(),
      totalBytes: NullableNumber.optional(),
      percent: NullableNumber.optional(),
    })
    .nullable(),
});
export const BrainJobListSchema = z.object({ jobs: z.array(BrainJobSchema).max(100) });
export const BrainJobSummarySchema = BrainJobSchema.omit({ progress: true });
export const BrainAdmittedJobSchema = z.object({ job: BrainJobSchema });
export const BrainTelemetrySchema = z.object({
  requests: Numeric,
  ok: Numeric,
  reasoningOnly: Numeric,
  truncated: Numeric,
  warning: NullableText,
});
export const BrainResourcesSchema = z.object({
  telemetry: BrainTelemetrySchema,
  cpu: NullableNumber,
  cpuCount: Numeric,
  ramUsedBytes: Numeric,
  ramTotalBytes: Numeric,
  gpu: z
    .object({
      name: Text,
      driver: NullableText.optional(),
      totalBytes: Numeric,
      usedBytes: NullableNumber.optional(),
      utilization: NullableNumber.optional(),
      temperature: NullableNumber.optional(),
    })
    .nullable(),
});
export const BrainAcceptedSchema = z.object({ ok: z.literal(true) });

const RunProfile = z.object({
  contextSize: NullableNumber.optional(),
  cacheTypeK: NullableText.optional(),
  cacheTypeV: NullableText.optional(),
  reasoningBudget: NullableNumber.optional(),
  vision: z.boolean().nullable().optional(),
  flashAttention: z.boolean().nullable().optional(),
  gpuLayers: NullableNumber.optional(),
  parallelSlots: NullableNumber.optional(),
  batchSize: NullableNumber.optional(),
  ubatchSize: NullableNumber.optional(),
  extraArgs: z.array(Text).optional(),
  preserveReasoning: z.boolean().nullable().optional(),
  contextMultiplier: NullableNumber.optional(),
  cachedChats: NullableNumber.optional(),
  temperature: NullableNumber.optional(),
  topP: NullableNumber.optional(),
  topK: NullableNumber.optional(),
  minP: NullableNumber.optional(),
  presencePenalty: NullableNumber.optional(),
  repeatPenalty: NullableNumber.optional(),
  hostingProfileId: NullableText.optional(),
});
const RunSetup = z.object({
  args: z.array(Text).nullable().optional(),
  adjusted: z.boolean(),
  requestedContextSize: NullableNumber.optional(),
  adjustReason: NullableText.optional(),
  kvSource: NullableText.optional(),
  kvInherited: z.boolean().optional(),
  kvBytesPerToken: NullableNumber.optional(),
  theoreticalKvBytesPerToken: NullableNumber.optional(),
  predictedVramBytes: NullableNumber.optional(),
  headroomBytes: NullableNumber.optional(),
});
const RunModel = z.object({
  id: NullableText.optional(),
  displayName: Text,
  contextLength: NullableNumber.optional(),
  blockCount: NullableNumber.optional(),
});
const Run = z.object({
  model: RunModel,
  configKey: Text,
  ranAt: Text,
  overall: Numeric,
  grade: Text,
  seconds: Numeric,
  executedCode: z.boolean().optional(),
  vramBytes: NullableNumber.optional(),
  loadSeconds: NullableNumber.optional(),
  runtime: NullableText.optional(),
  gpu: z.object({ name: Text }).nullable().optional(),
  profile: RunProfile.nullable().optional(),
  setup: RunSetup.nullable().optional(),
  suite: z
    .object({
      execute: z.boolean().nullable(),
      concurrency: NullableNumber,
      depths: z.array(Numeric).nullable(),
      only: z.array(Text).nullable(),
      mined: z.boolean(),
    })
    .nullable()
    .optional(),
  tasks: z
    .array(
      z.object({
        id: Text,
        category: Text,
        score: Numeric,
        weight: Numeric.optional(),
        seconds: Numeric.optional(),
        summary: Text.optional(),
        error: NullableText.optional(),
      }),
    )
    .max(10000),
});
export const BrainEvalsSchema = z.object({
  rankings: z
    .array(
      z.object({
        id: NullableText,
        displayName: Text,
        overall: Numeric,
        runs: Numeric,
        std: Numeric,
        grade: Text,
        rank: Numeric.optional(),
      }),
    )
    .max(10000),
  variance: z
    .array(
      z.object({
        key: Text,
        model: RunModel,
        configKey: Text,
        count: Numeric,
        overall: z.object({ mean: Numeric, std: Numeric }).nullable(),
      }),
    )
    .max(10000),
  latest: z.array(Run).max(10000),
  runCount: Numeric,
});

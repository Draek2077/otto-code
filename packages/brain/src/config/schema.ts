/**
 * Zod schemas for everything otto-brain persists. Following Otto's config
 * conventions: a `version` literal, camelCase keys, `.strict()` on config the tool
 * owns, `.passthrough()` on stores that must survive version skew (profiles carry
 * measured data we never want a schema bump to silently drop).
 */
import { z } from "zod";

export const DEFAULT_REASONING_MESSAGE = "Enough analysis. Write the complete answer now.";

// --------------------------------------------------------------- profiles store

export const ProfileSchema = z
  .object({
    modelId: z.string().nullable().default(null),
    modelPath: z.string().nullable().default(null),
    mmprojPath: z.string().nullable().default(null),
    contextSize: z.number(),
    cacheTypeK: z.string().default("q8_0"),
    cacheTypeV: z.string().default("q8_0"),
    flashAttention: z.boolean().default(true),
    gpuLayers: z.number().default(999),
    vision: z.boolean().default(false),
    reasoningBudget: z.number().default(1536),
    reasoningBudgetMessage: z.string().default(DEFAULT_REASONING_MESSAGE),
    parallelSlots: z.number().default(1),
    batchSize: z.number().nullable().default(null),
    ubatchSize: z.number().nullable().default(null),
    extraArgs: z.array(z.string()).default([]),
  })
  .passthrough();
export type Profile = z.infer<typeof ProfileSchema>;

export const CalibrationSampleSchema = z
  .object({
    contextSize: z.number(),
    deltaBytes: z.number(),
    loadSeconds: z.number().nullable().optional(),
  })
  .strip();

export const CalibrationSchema = z
  .object({
    kvBytesPerToken: z.number(),
    baseOverheadBytes: z.number(),
    theoreticalKvBytesPerToken: z.number().nullable().optional(),
    theoreticalRatio: z.number().nullable().optional(),
    samples: z.array(CalibrationSampleSchema).optional(),
    cacheTypeK: z.string().optional(),
    cacheTypeV: z.string().optional(),
    vision: z.boolean().optional(),
    measuredAt: z.string().optional(),
    measuredOn: z.string().optional(),
    inherited: z.boolean().optional(),
  })
  .strip();
export type Calibration = z.infer<typeof CalibrationSchema>;

export const GeometryCalibrationSchema = z
  .object({
    kvBytesPerTokenPerLayer: z.number(),
    baseOverheadBytes: z.number(),
    measuredAt: z.string().optional(),
    measuredOn: z.string().optional(),
    measuredLayers: z.number().optional(),
  })
  .passthrough();
export type GeometryCalibration = z.infer<typeof GeometryCalibrationSchema>;

export const ProfilesStoreSchema = z
  .object({
    version: z.literal(1).default(1),
    profiles: z.record(ProfileSchema).default({}),
    calibrations: z.record(z.record(CalibrationSchema)).default({}),
    geometryCalibrations: z.record(GeometryCalibrationSchema).default({}),
    lastModelId: z.string().nullable().default(null),
  })
  .passthrough();
export type ProfilesStore = z.infer<typeof ProfilesStoreSchema>;

// --------------------------------------------------------------- brain config

export const ListenSchema = z
  .object({
    host: z.string().default("127.0.0.1"),
    port: z.number().default(1234),
  })
  .strict();
export type Listen = z.infer<typeof ListenSchema>;

/**
 * Remote auth. `none` is only safe on a loopback bind; exposing the brain on a
 * non-loopback host should carry a token. The service layer enforces this.
 */
export const AuthSchema = z
  .object({
    mode: z.enum(["none", "token"]).default("none"),
    token: z.string().nullable().default(null),
  })
  .strict();
export type Auth = z.infer<typeof AuthSchema>;

export const RuntimeConfigSchema = z
  .object({
    // auto = prefer a managed runtime, fall back to LM Studio discovery.
    source: z.enum(["auto", "managed", "lmstudio"]).default("auto"),
    path: z.string().nullable().default(null),
  })
  .strict();
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const ProfileDefaultsSchema = z
  .object({
    cacheTypeK: z.string().default("q8_0"),
    cacheTypeV: z.string().default("q8_0"),
    flashAttention: z.boolean().default(true),
    reasoningBudget: z.number().default(1536),
    parallelSlots: z.number().default(1),
    contextCap: z.number().default(225000),
  })
  .strict();
export type ProfileDefaults = z.infer<typeof ProfileDefaultsSchema>;

export const BrainConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    // Opt-in: Otto ships with the local brain off and never auto-starts it.
    enabled: z.boolean().default(false),
    autoStart: z.boolean().default(false),
    listen: ListenSchema.default({}),
    auth: AuthSchema.default({}),
    runtime: RuntimeConfigSchema.default({}),
    // null => managed default ($OTTO_HOME/otto-brain/models), unioned with LM Studio.
    modelsDir: z.string().nullable().default(null),
    defaultModel: z.string().nullable().default(null),
    defaults: ProfileDefaultsSchema.default({}),
  })
  .strict();
export type BrainConfig = z.infer<typeof BrainConfigSchema>;

export const DEFAULT_BRAIN_CONFIG: BrainConfig = BrainConfigSchema.parse({});

// --------------------------------------------------------------- download catalog

export const CatalogModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    publisher: z.string().optional(),
    hfRepo: z.string(),
    quant: z.string(),
    quantFile: z.string().optional(),
    approxWeightsBytes: z.number().optional(),
    params: z.string().optional(),
    moe: z.boolean().optional(),
    vision: z.boolean().optional(),
    thinking: z.boolean().optional(),
    contextMax: z.number().optional(),
    useCases: z.array(z.string()).optional(),
    tier: z.string().optional(),
    why: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();
export type CatalogModel = z.infer<typeof CatalogModelSchema>;

export const CatalogSchema = z
  .object({
    version: z.literal(1).default(1),
    note: z.string().optional(),
    vramBudgetBytes: z.number().optional(),
    systemRamBytes: z.number().optional(),
    models: z.array(CatalogModelSchema).default([]),
  })
  .passthrough();
export type Catalog = z.infer<typeof CatalogSchema>;

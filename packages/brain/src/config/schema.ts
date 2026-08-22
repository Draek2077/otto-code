/**
 * Zod schemas for everything otto-brain persists. Following Otto's config
 * conventions: a `version` literal, camelCase keys, `.strict()` on config the tool
 * owns, `.passthrough()` on stores that must survive version skew (profiles carry
 * measured data we never want a schema bump to silently drop).
 */
import { z } from "zod";

export const DEFAULT_REASONING_MESSAGE = "Enough analysis. Write the complete answer now.";

const TemplateArgumentSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);

/**
 * Model-native names for reasoning controls exposed by its chat template.
 * These are catalog metadata, not caller-provided flags: the host owns the
 * translation from the OpenAI-compatible request into template arguments.
 */
export const ReasoningTemplateSchema = z
  .object({
    enableThinkingArgument: TemplateArgumentSchema,
    effortArgument: TemplateArgumentSchema,
  })
  .strict();
export type ReasoningTemplate = z.infer<typeof ReasoningTemplateSchema>;

/** A template's native spelling for Brain's provider-neutral preservation setting. */
export const ReasoningPreservationSchema = z
  .object({
    templateArgument: TemplateArgumentSchema,
    default: z.boolean().optional(),
  })
  .strict();
export type ReasoningPreservation = z.infer<typeof ReasoningPreservationSchema>;

// --------------------------------------------------------------- profiles store

export const ProfileSchema = z
  .object({
    modelId: z.string().nullable().default(null),
    modelPath: z.string().nullable().default(null),
    mmprojPath: z.string().nullable().default(null),
    /** Stable bundle component ids enabled for this load. Paths are re-derived. */
    enabledComponents: z.array(z.string()).default([]),
    /** Derived component paths for the launcher; never accepted from clients. */
    componentPaths: z.record(z.string()).default({}),
    contextSize: z.number(),
    cacheTypeK: z.string().default("q8_0"),
    cacheTypeV: z.string().default("q8_0"),
    flashAttention: z.boolean().default(true),
    gpuLayers: z.number().default(999),
    vision: z.boolean().default(false),
    reasoningBudget: z.number().default(1536),
    reasoningBudgetMessage: z.string().default(DEFAULT_REASONING_MESSAGE),
    /**
     * Tri-state, matching llama-server's own `--reasoning-preserve` /
     * `--no-reasoning-preserve` / unset: `true` keeps the reasoning trace in the
     * whole history, `false` forces it to the last assistant message only, and
     * null/undefined leaves the template's own default alone. Null is the
     * default precisely so an untouched profile emits no flag and launches
     * exactly as it did before this field existed.
     */
    preserveReasoning: z.boolean().nullable().optional(),
    // ------------------------------------------------------------- sampling
    // Defaults are llama.cpp's own, read from `llama-server --help` on the
    // pinned build (b10433) so an untouched profile runs identically to one
    // that never emitted these flags. They are stored and emitted explicitly
    // rather than left implicit because a sampler the user can see is one they
    // can reason about; re-check them when DEFAULT_LLAMA_BUILD moves.
    temperature: z.number().default(0.8),
    topP: z.number().default(0.95),
    topK: z.number().default(40),
    minP: z.number().default(0.05),
    presencePenalty: z.number().default(0),
    repeatPenalty: z.number().default(1),
    parallelSlots: z.number().default(1),
    /**
     * How many chats' KV state llama-server may park in system RAM when they
     * lose their GPU slot, so returning to one costs a bulk copy instead of a
     * full re-prefill. Stored as a count, not a size: the byte budget it turns
     * into (`--cache-ram`) depends on the measured KV bytes/token and the
     * per-slot context, both of which move when other fields are edited.
     * 0 means "leave llama.cpp's own default alone" - the flag is not emitted.
     */
    cachedChats: z.number().default(0),
    /** RoPE extension factor; 1 keeps the GGUF-native context window. */
    contextMultiplier: z.number().default(1),
    /** Cleared only by a successful calibration of this saved model profile. */
    calibrationRequired: z.boolean().default(true),
    batchSize: z.number().nullable().default(null),
    ubatchSize: z.number().nullable().default(null),
    extraArgs: z.array(z.string()).default([]),
    /** The selected profile id when `hostingProfileMode` is `custom`. */
    hostingProfileId: z.string().nullable().default(null),
    /**
     * Whether this model inherits its family's profile, disables profiles, or
     * selects one itself. `inherit` is the default because it is what a profile
     * stored before this field existed meant: the family default applied to
     * every model in the family that had not overridden it. Defaulting to `off`
     * would silently drop that default on every profile written by an older
     * Brain. With no family default set, `inherit` resolves to nothing, which
     * is exactly what `off` does, so the safe default costs nothing.
     */
    hostingProfileMode: z.enum(["inherit", "off", "custom"]).default("inherit"),
    /** Derived at load time from the selected Brain-owned hosting profile. */
    chatTemplateFile: z.string().nullable().default(null),
    /** Derived at load time; passed directly to llama-server's Jinja engine. */
    chatTemplateKwargs: z.record(z.unknown()).default({}),
    /**
     * Derived at load time from the selected hosting profile's system-prompt
     * addendum. The router injects it per request rather than the launcher
     * baking it into a CLI flag; see `hosting-profiles.ts` for why.
     */
    chatSystemAddendum: z.string().nullable().default(null),
  })
  .passthrough();
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * A named, Brain-owned inference composition. The template is intentionally
 * text, rather than a user-owned path: remote Brains must be able to apply the
 * same profile and no client is allowed to make llama-server read arbitrary
 * files from its host.
 */
export const HostingProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    family: z.string(),
    description: z.string().default(""),
    template: z.string().nullable().default(null),
    systemPromptAddendum: z.string().nullable().default(null),
    templateKwargs: z.record(z.unknown()).default({}),
  })
  .strict();
export type HostingProfile = z.infer<typeof HostingProfileSchema>;

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
    /** Named reusable profiles, scoped to this Brain rather than any client. */
    hostingProfiles: z.record(HostingProfileSchema).default({}),
    /** Optional family default; individual model profiles may override it. */
    familyHostingProfileIds: z.record(z.string().nullable()).default({}),
    /**
     * A saved edit made while that model was resident. It stays visible when
     * the user leaves and revisits the model settings, and clears only after a
     * successful fresh llama-server load of that model.
     */
    pendingReloadModelIds: z.record(z.boolean()).default({}),
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

/**
 * TLS termination, built into the brain so it can be exposed over HTTPS with no
 * relay in front. Four modes:
 *  - `off`      - plain HTTP (the default; loopback-only is the safe posture).
 *  - `files`    - bring your own cert/key (a real cert, or one you manage).
 *  - `self-signed` - generate a local keypair on first run, cached under `certDir`.
 *  - `tailscale` - issue and auto-renew a real Let's Encrypt cert for this
 *                  machine's MagicDNS name via `tailscaled` (no cert warnings on
 *                  the tailnet). `hostname` is auto-detected when null.
 * The service layer enforces that a non-loopback bind still carries auth.
 */
export const TlsSchema = z
  .object({
    mode: z.enum(["off", "files", "self-signed", "tailscale"]).default("off"),
    // files mode:
    certFile: z.string().nullable().default(null),
    keyFile: z.string().nullable().default(null),
    // tailscale / self-signed:
    hostname: z.string().nullable().default(null),
    // where issued/generated certs are cached; null => $OTTO_HOME/otto-brain/certs.
    certDir: z.string().nullable().default(null),
    renewBeforeDays: z.number().default(21),
    checkIntervalMs: z.number().default(43_200_000),
    tailscaleExe: z.string().nullable().default(null),
  })
  .strict();
export type Tls = z.infer<typeof TlsSchema>;

export const RuntimeConfigSchema = z
  .object({
    // auto = prefer a managed runtime, fall back to LM Studio discovery.
    source: z.enum(["auto", "managed", "lmstudio"]).default("auto"),
    path: z.string().nullable().default(null),
    /** llama.cpp's `--log-verbosity`: 0 generic output through 5 debug. */
    logVerbosity: z.number().int().min(0).max(5).default(3),
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
    tls: TlsSchema.default({}),
    runtime: RuntimeConfigSchema.default({}),
    // null => managed default ($OTTO_HOME/otto-brain/models), unioned with LM Studio.
    modelsDir: z.string().nullable().default(null),
    // Hugging Face access token for gated/private repo downloads. Env
    // HF_TOKEN / HUGGING_FACE_HUB_TOKEN take precedence at read time; this is the
    // persisted fallback so users can set it once (config set hfToken <token>).
    hfToken: z.string().nullable().default(null),
    defaultModel: z.string().nullable().default(null),
    /** Maximum independently hosted llama-server model processes. */
    maxLoadedModels: z.number().int().min(1).max(16).default(1),
    /** Stable ids selected for residency while model locking is enabled. */
    lockedModels: z.array(z.string()).default([]),
    // Pin the host to the selected resident set and refuse completion requests
    // that name a different model. With a one-process host this preserves the
    // original single-model lock behavior.
    lockModel: z.boolean().default(false),
    // Sharing/control gates (off by default - a brain is not remotely
    // controllable until its owner opts in). `allowRemoteConfig`: a client with
    // the token may CHANGE config over the network (POST /__host/config), not
    // just use/read. `allowInsecureBind`: permit a non-loopback bind with no
    // token (an "open, trusted network" share) - otherwise the service refuses.
    allowRemoteConfig: z.boolean().default(false),
    allowInsecureBind: z.boolean().default(false),
    defaults: ProfileDefaultsSchema.default({}),
  })
  .strict();
export type BrainConfig = z.infer<typeof BrainConfigSchema>;

export const DEFAULT_BRAIN_CONFIG: BrainConfig = BrainConfigSchema.parse({});

// --------------------------------------------------------------- download catalog

export const CatalogModelSchema = z
  .object({
    id: z.string(),
    /** Retired Otto-curated ids this canonical catalog entry replaces. */
    replaces: z.array(z.string()).optional(),
    name: z.string(),
    /** Stable UI family identity. Otto clients resolve this to a monochrome glyph. */
    family: z.string().optional(),
    /** Otto-curated favorite shown as a gold premium badge in the Brain Library. */
    favorite: z.boolean().default(false),
    publisher: z.string().optional(),
    hfRepo: z.string(),
    quant: z.string(),
    quantFile: z.string().optional(),
    approxWeightsBytes: z.number().optional(),
    params: z.string().optional(),
    moe: z.boolean().optional(),
    vision: z.boolean().optional(),
    thinking: z.boolean().optional(),
    reasoningEfforts: z.array(z.string()).optional(),
    reasoningEffortDefault: z.string().optional(),
    reasoningTemplate: ReasoningTemplateSchema.optional(),
    reasoningPreservation: ReasoningPreservationSchema.optional(),
    contextMax: z.number().optional(),
    useCases: z.array(z.string()).optional(),
    tier: z.string().optional(),
    why: z.string().optional(),
    status: z.string().optional(),
    /** Declared only for multi-artifact model bundles. Plain models omit it. */
    components: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            description: z.string(),
            role: z.enum(["vision_projector", "speculative_drafter"]),
            hfRepo: z.string().optional(),
            file: z.string(),
            bytes: z.number().nullable().optional(),
            required: z.boolean().default(false),
            defaultDownload: z.boolean().default(false),
            defaultLoad: z.boolean().default(false),
            minRuntimeBuild: z.number().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .passthrough();
export type CatalogModel = z.infer<typeof CatalogModelSchema>;

export const CatalogSchema = z
  .object({
    version: z.literal(1).default(1),
    note: z.string().optional(),
    vramBudgetBytes: z.number().optional(),
    systemRamBytes: z.number().optional(),
    /** Retired curated ids that no longer belong to any canonical catalog entry. */
    retiredModelIds: z.array(z.string()).default([]),
    models: z.array(CatalogModelSchema).default([]),
  })
  .passthrough();
export type Catalog = z.infer<typeof CatalogSchema>;

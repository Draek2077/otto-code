import { z } from "zod";

/**
 * Otto Brain wire schemas and their inferred types.
 *
 * Otto Brain is a fork-only capability, so its schemas live in their own
 * protocol module rather than inside `messages.ts`, matching how `kanban.ts`,
 * `artifacts/rpc-schemas.ts`, `communications.ts` and `orchestration.ts` already
 * work. `messages.ts` imports what it needs and composes the message unions.
 */

export const BrainProfileSchema = z
  .object({
    contextSize: z.number().default(0),
    cacheTypeK: z.string().default(""),
    cacheTypeV: z.string().default(""),
    flashAttention: z.boolean().default(true),
    gpuLayers: z.number().default(0),
    vision: z.boolean().default(false),
    enabledComponents: z.array(z.string()).optional(),
    reasoningBudget: z.number().default(0),
    /**
     * Tri-state: true keeps the reasoning trace across the whole history, false
     * trims it to the last assistant message, null/absent leaves the chat
     * template's own default in charge. Nullable rather than plain optional
     * because "the template decides" is a real stored state, not a missing one.
     */
    // COMPAT(brainPreserveReasoningTriState): widened from boolean in v0.8.11.
    preserveReasoning: z.boolean().nullable().optional(),
    /**
     * Sampler settings, all optional: a brain older than these fields simply
     * does not send them, and the editor renders whatever `fields` describes.
     */
    // COMPAT(brainSamplerProfile): added in v0.8.11, drop the gate when floor >= v0.8.11.
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
    minP: z.number().optional(),
    presencePenalty: z.number().optional(),
    repeatPenalty: z.number().optional(),
    parallelSlots: z.number().default(1),
    /** Chats whose KV state may be parked in host RAM; 0 = the engine default. */
    cachedChats: z.number().default(0),
    contextMultiplier: z.number().default(1),
    calibrationRequired: z.boolean().default(true),
    hostingProfileId: z.string().nullable().default(null),
    /** Matches the brain's own default: a profile written before this field
     * existed meant "use the family default", which is `inherit`. */
    hostingProfileMode: z.enum(["inherit", "off", "custom"]).default("inherit"),
  })
  .passthrough();

export const BrainProfileFieldSchema = z
  .object({
    key: z.string(),
    label: z.string().default(""),
    kind: z.string().default("number"),
    /** One sentence on what the field does, for the client's tooltip. */
    // COMPAT(brainFieldDescription): added in v0.8.11, drop the gate when floor >= v0.8.11.
    description: z.string().nullable().optional(),
    step: z.number().nullable().optional(),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    /** Decimal places the value carries; absent means an integer. */
    // COMPAT(brainFieldPrecision): added in v0.8.11, drop the gate when floor >= v0.8.11.
    precision: z.number().nullable().optional(),
    options: z.array(z.union([z.string(), z.number()])).default([]),
    optionLabels: z.array(z.string()).default([]),
    /**
     * What each option stores, index-aligned with `options`. Absent means the
     * option is itself the value; present when the stored value cannot be an
     * option, as for a true/false/null tri-state.
     */
    // COMPAT(brainFieldOptionValues): added in v0.8.11, drop the gate when floor >= v0.8.11.
    optionValues: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    available: z.boolean().default(true),
    unavailableReason: z.string().nullable().optional(),
  })
  .passthrough();

export const BrainCalibrationInfoSchema = z
  .object({
    state: z.string().default("unknown"),
    kvBytesPerToken: z.number().nullable().default(null),
    measuredAt: z.string().nullable().default(null),
    measuredOn: z.string().nullable().default(null),
  })
  .passthrough();

export const BrainModelScoreSchema = z
  .object({
    id: z.string().nullable().default(null),
    displayName: z.string().default(""),
    overall: z.number().default(0),
    runs: z.number().default(0),
    std: z.number().default(0),
    grade: z.string().default(""),
    rank: z.number().nullable().optional(),
  })
  .passthrough();

export const BrainLogsWatchRequestSchema = z.object({
  type: z.literal("brain.logs.watch.request"),
  watching: z.boolean(),
  requestId: z.string(),
});

export const BrainLogLineAddedStatusPayloadSchema = z
  .object({
    status: z.literal("brain_log_line_added"),
    line: z.string(),
  })
  .passthrough();

/**
 * What the brain on the far side can actually serve. Passthrough so it can grow.
 *
 * Declared here rather than beside the Brain Console RPCs below because
 * BrainHostStatusSchema carries it, and a zod const must be initialised before
 * the schema that references it (see docs on the AOT validator's declaration
 * ordering). Moving it back down produces a module-evaluation TDZ error.
 */
export const BrainCapabilitiesSchema = z
  .object({
    profiles: z.boolean().default(false),
    budget: z.boolean().default(false),
    logs: z.boolean().default(false),
    delete: z.boolean().default(false),
    load: z.boolean().default(false),
    resources: z.boolean().default(false),
    inventory: z.boolean().default(false),
    /**
     * GET /__host/events: a live SSE stream of complete status snapshots.
     *
     * The daemon reads this before deciding how to watch the brain. False (the
     * default, and what every brain built before the stream reports) keeps the
     * daemon on the ordinary status poll, which is why nothing else about the
     * management API had to change for pushed status to ship.
     */
    events: z.boolean().default(false),
    logEvents: z.boolean().default(false),
    /**
     * Status events include bounded live inference stages, token counts and
     * throughput. False for the first event-stream generation, whose snapshots
     * only moved at phase boundaries.
     */
    liveInference: z.boolean().default(false),
    /** Whether writes are permitted right now (the brain's allowRemoteConfig). */
    writable: z.boolean().default(false),
    /** The remote brain owns benchmark jobs and can list/cancel them. */
    jobs: z.boolean().default(false),
    /** The brain can ask its owning daemon to restart it. */
    restart: z.boolean().default(false),
    /** The host can keep multiple independently supervised model processes resident. */
    processPool: z.boolean().default(false),
  })
  .passthrough();
export type BrainCapabilities = z.infer<typeof BrainCapabilitiesSchema>;

// The brain's host status, as the daemon derives it: liveness plus the fields
// proxied from the brain's own `/__host/status`. Passthrough on the opaque
// sub-objects so the brain can evolve them without a protocol bump.
export const BrainHostStatusSchema = z
  .object({
    running: z.boolean(),
    pid: z.number().nullable().optional(),
    version: z.string().nullable().optional(),
    /** The llama.cpp runtime resolved by the Brain host, or "not installed". */
    runtime: z.string().nullable().optional(),
    /**
     * Which generation of the brain's management contract the far side speaks.
     *
     * Additive and separate from `version`, which is the package build. A daemon
     * reads this plus `capabilities` instead of pinning an exact brain version;
     * absent means a brain from before the field existed.
     */
    apiVersion: z.number().nullable().optional(),
    host: z.string().nullable().optional(),
    port: z.number().nullable().optional(),
    displayHost: z.string().nullable().optional(),
    secure: z.boolean().optional(),
    state: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    modelId: z.string().nullable().optional(),
    /** Every independently hosted resident model process. */
    residents: z
      .array(
        z
          .object({
            state: z.string(),
            model: z.string().nullable().optional(),
            modelId: z.string().nullable().optional(),
            pid: z.number().nullable().optional(),
            upstream: z.string().nullable().optional(),
            vramBytes: z.number().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    vramBytes: z.number().nullable().optional(),
    loadSeconds: z.number().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    lastError: z.string().nullable().optional(),
    telemetry: z.record(z.string(), z.unknown()).nullable().optional(),
    scheduler: z.record(z.string(), z.unknown()).nullable().optional(),
    recent: z.array(z.record(z.string(), z.unknown())).optional(),
    /**
     * What the brain on the far side can serve. Carried here rather than fetched
     * from /__host/capabilities so the client gets it with the status it is
     * already polling, and so it cannot go stale when the owner toggles remote
     * configuration. Null from a brain that predates the management API.
     */
    capabilities: BrainCapabilitiesSchema.nullable().optional(),
    /** Live CPU/RAM/GPU telemetry, only when the request asked for it. */
    resources: z.record(z.string(), z.unknown()).nullable().optional(),
    /** How many log lines the brain currently holds, for the Logs tab. */
    logLineCount: z.number().nullable().optional(),
    /**
     * Which long-running op currently owns the brain, if any. Cheap to carry:
     * the brain reads it from a small file beside its pid file, so this rides on
     * the liveness poll rather than needing `resources: true`.
     *
     * `kind` is a plain string, not an enum: the brain may grow ops this client
     * has never heard of, and the protocol contract forbids narrowing a field
     * later. Unknown kinds fall through to the ordinary busy states.
     */
    activity: z
      .object({
        kind: z.string(),
        target: z.string().nullable().optional(),
        /** Completion in [0,1], for ops that can measure it. */
        progress: z.number().nullable().optional(),
        startedAt: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    /**
     * Whether any in-flight completion is currently mid-reasoning: reasoning
     * deltas have arrived and no content has yet. Also on the liveness poll,
     * because it is one boolean the router already knows.
     */
    reasoning: z.boolean().nullable().optional(),
    /**
     * Exact aggregate lifecycle counts for requests currently dispatched to
     * llama-server. Additive in host API v2; absent on older brains.
     */
    inference: z
      .object({
        activeRequests: z.number().int().nonnegative().optional(),
        processing: z.number().int().nonnegative().optional(),
        thinking: z.number().int().nonnegative().optional(),
        generating: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    /**
     * Slot occupancy split by phase, so a client can tell a prompt being
     * ingested from a model that has started answering. Rides here rather than
     * inside `resources` on purpose: `resources` costs an `nvidia-smi` spawn and
     * is off by default, and this is the half the status rail needs every poll.
     */
    slots: z
      .object({
        total: z.number().nullable().optional(),
        busy: z.number().nullable().optional(),
        idle: z.number().nullable().optional(),
        prefill: z.number().nullable().optional(),
        decode: z.number().nullable().optional(),
        /** Bounded-rate per-slot performance samples; host API v2 and newer. */
        threads: z
          .array(
            z
              .object({
                slot: z.number().optional(),
                phase: z.enum(["prefill", "decode"]).optional(),
                promptTokens: z.number().nullable().optional(),
                generatedTokens: z.number().nullable().optional(),
                promptTokensPerSecond: z.number().nullable().optional(),
                tokensPerSecond: z.number().nullable().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    /** Jobs the scheduler is holding because no slot is free, or a swap is mid-flight. */
    queued: z.number().nullable().optional(),
    /** Whether the daemon reached the brain on its last probe. */
    reachable: z.boolean().nullable().optional(),
  })
  .passthrough();
export type BrainHostStatus = z.infer<typeof BrainHostStatusSchema>;

export const BrainHostStatusResultSchema = z.object({
  status: BrainHostStatusSchema,
  error: z.string().nullable(),
  requestId: z.string(),
});

export const BrainHostStatusRequestSchema = z.object({
  type: z.literal("brain.host.status.request"),
  /**
   * Ask for live CPU/RAM/GPU telemetry alongside the status. Off by default on
   * purpose: it costs an `nvidia-smi` spawn on the brain, and this RPC is also
   * the liveness poll. Only a surface actually
   * rendering the numbers should turn it on.
   */
  resources: z.boolean().default(false),
  requestId: z.string(),
});

export const BrainHostStatusResponseSchema = z.object({
  type: z.literal("brain.host.status.response"),
  payload: BrainHostStatusResultSchema,
});

export const BrainHostStartRequestSchema = z.object({
  type: z.literal("brain.host.start.request"),
  // Optional model fragment/id to load on start; null = the brain's default.
  model: z.string().nullable().default(null),
  requestId: z.string(),
});

export const BrainHostStartResponseSchema = z.object({
  type: z.literal("brain.host.start.response"),
  payload: BrainHostStatusResultSchema,
});

export const BrainHostStopRequestSchema = z.object({
  type: z.literal("brain.host.stop.request"),
  requestId: z.string(),
});

export const BrainHostStopResponseSchema = z.object({
  type: z.literal("brain.host.stop.response"),
  payload: BrainHostStatusResultSchema,
});

export const BrainHostRestartRequestSchema = z.object({
  type: z.literal("brain.host.restart.request"),
  model: z.string().nullable().default(null),
  requestId: z.string(),
});

export const BrainHostRestartResponseSchema = z.object({
  type: z.literal("brain.host.restart.response"),
  payload: BrainHostStatusResultSchema,
});

// Benchmark rankings/variance/latest, proxied from the brain's `/__host/evals`.
export const BrainEvalsSchema = z
  .object({
    rankings: z.array(z.record(z.string(), z.unknown())).default([]),
    latest: z.array(z.record(z.string(), z.unknown())).default([]),
    variance: z.array(z.record(z.string(), z.unknown())).default([]),
    runCount: z.number().default(0),
  })
  .passthrough();
export type BrainEvals = z.infer<typeof BrainEvalsSchema>;

export const BrainEvalsGetRequestSchema = z.object({
  type: z.literal("brain.evals.get.request"),
  requestId: z.string(),
});

export const BrainEvalsGetResponseSchema = z.object({
  type: z.literal("brain.evals.get.response"),
  payload: z.object({
    evals: BrainEvalsSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Brain network auto-discovery: the daemon enumerates this host's bind
// addresses and probes the local `tailscale` CLI so the client can offer the
// operator a pick-list of likely listen hosts (and pre-fill the tailscale TLS
// mode) instead of asking them to hunt for IPs by hand.
// Gated by server_info.features.brainNetworkDiscovery.
export const BrainTailscaleInfoSchema = z
  .object({
    // Whether the tailscale CLI is present and its daemon answers.
    available: z.boolean(),
    // This machine's MagicDNS name, e.g. greyskull.tail279562.ts.net.
    hostname: z.string().nullable().optional(),
    // The tailnet IPv4 address, for a tailnet-only bind.
    ipv4: z.string().nullable().optional(),
    // The default directory the brain writes issued certificates to.
    certDir: z.string().nullable().optional(),
  })
  .passthrough();
export type BrainTailscaleInfo = z.infer<typeof BrainTailscaleInfoSchema>;

// One candidate value for `listen.host`, with a human label for the pick-list.
export const BrainBindAddressSchema = z
  .object({
    // The literal value written to listen.host (an IP, 0.0.0.0, or "tailscale").
    value: z.string(),
    // Display label, e.g. "Local only", "All interfaces", "192.168.1.42 (en0)".
    label: z.string(),
    kind: z.enum(["loopback", "all", "lan", "tailscale"]),
  })
  .passthrough();
export type BrainBindAddress = z.infer<typeof BrainBindAddressSchema>;

export const BrainNetworkInfoSchema = z
  .object({
    addresses: z.array(BrainBindAddressSchema).default([]),
    tailscale: BrainTailscaleInfoSchema.nullable().optional(),
  })
  .passthrough();
export type BrainNetworkInfo = z.infer<typeof BrainNetworkInfoSchema>;

// Detected model names for the settings pickers. Read from the brain's
// /v1/models when it is reachable (local child up, or remote); empty otherwise,
// which the client renders as a disabled picker. Gated by features.brainStatus.
export const BrainModelsListRequestSchema = z.object({
  type: z.literal("brain.models.list.request"),
  requestId: z.string(),
});

export const BrainModelsListResponseSchema = z.object({
  type: z.literal("brain.models.list.response"),
  payload: z.object({
    models: z.array(z.string()).default([]),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Read/write a *remote* brain's own config (its /__host/config). Only valid in
// brain.mode "remote"; the config is the remote brain's effective config with
// secrets redacted. Editable fields are model-related (defaultModel,
// maxLoadedModels, lockedModels, lockModel);
// network/TLS/auth stay host-owned. Gated by features.brainRemote.
export const BrainRemoteConfigSchema = z.record(z.string(), z.unknown());
export type BrainRemoteConfig = z.infer<typeof BrainRemoteConfigSchema>;

export const BrainRemoteConfigGetRequestSchema = z.object({
  type: z.literal("brain.remote.config.get.request"),
  requestId: z.string(),
});

export const BrainRemoteConfigGetResponseSchema = z.object({
  type: z.literal("brain.remote.config.get.response"),
  payload: z.object({
    config: BrainRemoteConfigSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const BrainRemoteConfigPatchRequestSchema = z.object({
  type: z.literal("brain.remote.config.patch.request"),
  patch: BrainRemoteConfigSchema,
  requestId: z.string(),
});

export const BrainRemoteConfigPatchResponseSchema = z.object({
  type: z.literal("brain.remote.config.patch.response"),
  payload: z.object({
    config: BrainRemoteConfigSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const BrainNetworkDiscoverRequestSchema = z.object({
  type: z.literal("brain.network.discover.request"),
  requestId: z.string(),
});

export const BrainNetworkDiscoverResponseSchema = z.object({
  type: z.literal("brain.network.discover.response"),
  payload: z.object({
    info: BrainNetworkInfoSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// An installed local model, from `otto-brain scan`. Passthrough so the brain's
// scan row can grow fields without a protocol bump.
export const BrainInstalledModelSchema = z
  .object({
    model: z.string().default(""),
    arch: z.string().default(""),
    quant: z.string().default(""),
    size: z.string().default(""),
    ctx: z.string().default(""),
    vision: z.string().default(""),
    calibrated: z.string().default(""),
    features: z.string().default(""),
    source: z.string().default(""),
  })
  .passthrough();
export type BrainInstalledModel = z.infer<typeof BrainInstalledModelSchema>;

// A downloadable catalog model, annotated with whether it is already installed
// (the daemon reuses the brain's authoritative catalog↔model join). Passthrough
// over the catalog entry's optional metadata.
export const BrainCatalogModelSchema = z
  .object({
    id: z.string(),
    name: z.string().default(""),
    family: z.string().nullable().optional(),
    favorite: z.boolean().default(false),
    installed: z.boolean().default(false),
    publisher: z.string().default(""),
    repo: z.string().default(""),
    quant: z.string().default(""),
    params: z.string().default(""),
    sizeBytes: z.number().nullable().optional(),
    size: z.string().default(""),
    vision: z.boolean().default(false),
    thinking: z.boolean().default(false),
    contextMax: z.number().nullable().optional(),
    tier: z.string().default(""),
    useCases: z.array(z.string()).default([]),
    why: z.string().default(""),
    components: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().default(""),
          description: z.string().default(""),
          role: z.string().default(""),
          hfRepo: z.string().optional(),
          file: z.string().default(""),
          bytes: z.number().nullable().optional(),
          required: z.boolean().default(false),
          defaultDownload: z.boolean().default(false),
          defaultLoad: z.boolean().default(false),
          minRuntimeBuild: z.number().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
export type BrainCatalogModel = z.infer<typeof BrainCatalogModelSchema>;

// An installed llama.cpp runtime, from `otto-brain runtime list`.
export const BrainRuntimeSchema = z
  .object({
    label: z.string().default(""),
    // A human-readable runtime identity. The filesystem-safe `label` remains
    // for older hosts and destructive operations, not for UI presentation.
    displayName: z.string().default(""),
    version: z.string().default(""),
    source: z.string().default(""),
    dir: z.string().default(""),
  })
  .passthrough();
export type BrainRuntime = z.infer<typeof BrainRuntimeSchema>;

// A tracked long-running brain operation. The client polls brain.jobs.list and
// renders progress. `percent` is null when the job reports no measurable
// progress (indeterminate). Terminal jobs linger briefly so the UI can show
// the outcome before they are pruned.
export const BrainJobKindSchema = z.enum([
  "pull",
  "runtime-install",
  "runtime-remove",
  "calibrate",
  "sweep",
  "bench",
]);
export type BrainJobKind = z.infer<typeof BrainJobKindSchema>;

export const BrainJobStatusSchema = z.enum(["running", "succeeded", "failed", "canceled"]);
export type BrainJobStatus = z.infer<typeof BrainJobStatusSchema>;

export const BrainJobSchema = z
  .object({
    id: z.string(),
    kind: BrainJobKindSchema,
    // A short human label, e.g. "Download Phi-4 (14B)".
    label: z.string().default(""),
    // The subject id (catalog id, model name, or build tag) this job acts on.
    target: z.string().nullable().default(null),
    status: BrainJobStatusSchema.default("running"),
    /** Null once admitted; a positive value means this operation is pending. */
    queuePosition: z.number().int().positive().nullable().optional(),
    percent: z.number().nullable().default(null),
    // The latest progress line (e.g. "extracting…", "budget 512: done").
    message: z.string().nullable().default(null),
    error: z.string().nullable().default(null),
    startedAt: z.string().default(""),
    finishedAt: z.string().nullable().default(null),
  })
  .passthrough();
export type BrainJob = z.infer<typeof BrainJobSchema>;

// Every job-starting RPC returns the created (or refused) job under this shape.
export const BrainJobResultSchema = z.object({
  job: BrainJobSchema.nullable(),
  error: z.string().nullable(),
  requestId: z.string(),
});

// Every job-listing RPC returns the active + recently-finished jobs.
export const BrainJobsResultSchema = z.object({
  jobs: z.array(BrainJobSchema).default([]),
  error: z.string().nullable(),
  requestId: z.string(),
});

// Installed models - `otto-brain scan`.
export const BrainModelsScanRequestSchema = z.object({
  type: z.literal("brain.models.scan.request"),
  requestId: z.string(),
});

export const BrainModelsScanResponseSchema = z.object({
  type: z.literal("brain.models.scan.response"),
  payload: z.object({
    models: z.array(BrainInstalledModelSchema).default([]),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Downloadable catalog - `otto-brain catalog`.
export const BrainCatalogListRequestSchema = z.object({
  type: z.literal("brain.catalog.list.request"),
  requestId: z.string(),
});

export const BrainCatalogListResponseSchema = z.object({
  type: z.literal("brain.catalog.list.response"),
  payload: z.object({
    models: z.array(BrainCatalogModelSchema).default([]),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Installed runtimes - `otto-brain runtime list`.
export const BrainRuntimeListRequestSchema = z.object({
  type: z.literal("brain.runtime.list.request"),
  requestId: z.string(),
});

export const BrainRuntimeListResponseSchema = z.object({
  type: z.literal("brain.runtime.list.response"),
  payload: z.object({
    runtimes: z.array(BrainRuntimeSchema).default([]),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Download a catalog model - starts a `pull` job.
export const BrainModelsPullRequestSchema = z.object({
  type: z.literal("brain.models.pull.request"),
  // Catalog id or name fragment.
  model: z.string(),
  quant: z.string().optional(),
  // COMPAT(brainModelBundles): added in v0.8.7, drop the gate when floor >= v0.8.7.
  components: z.array(z.string()).optional(),
  // COMPAT(brainBundleDownloadQueue): added in v0.8.8, drop the gate when floor >= v0.8.8.
  // Advisory aggregate byte budget for one selected quant plus its components.
  expectedBytes: z.number().nonnegative().optional(),
  requestId: z.string(),
});

export const BrainModelsPullResponseSchema = z.object({
  type: z.literal("brain.models.pull.response"),
  payload: BrainJobResultSchema,
});

// Install a llama.cpp runtime - starts a `runtime-install` job.
export const BrainRuntimeInstallRequestSchema = z.object({
  type: z.literal("brain.runtime.install.request"),
  // Optional llama.cpp release build tag; null = the brain's default.
  build: z.string().nullable().default(null),
  requestId: z.string(),
});

export const BrainRuntimeInstallResponseSchema = z.object({
  type: z.literal("brain.runtime.install.response"),
  payload: BrainJobResultSchema,
});

export const BrainRuntimeRemoveRequestSchema = z.object({
  type: z.literal("brain.runtime.remove.request"),
  name: z.string(),
  requestId: z.string(),
});

export const BrainRuntimeRemoveResponseSchema = z.object({
  type: z.literal("brain.runtime.remove.response"),
  payload: BrainJobResultSchema,
});

// Measure real KV bytes/token for a model - starts a `calibrate` job. Needs a
// runtime + GPU; refused with a helpful error otherwise.
export const BrainCalibrateRequestSchema = z.object({
  type: z.literal("brain.calibrate.request"),
  model: z.string(),
  requestId: z.string(),
});

export const BrainCalibrateResponseSchema = z.object({
  type: z.literal("brain.calibrate.response"),
  payload: BrainJobResultSchema,
});

// Find the best reasoning budget for a model - starts a `sweep` job.
export const BrainSweepRequestSchema = z.object({
  type: z.literal("brain.sweep.request"),
  model: z.string(),
  requestId: z.string(),
});

export const BrainSweepResponseSchema = z.object({
  type: z.literal("brain.sweep.response"),
  payload: BrainJobResultSchema,
});

// Run the agentic-coding benchmark - starts a `bench` job. `model` is an
// optional comma list of name fragments; null lets the brain pick.
export const BrainBenchRequestSchema = z.object({
  type: z.literal("brain.bench.request"),
  model: z.string().nullable().default(null),
  requestId: z.string(),
});

export const BrainBenchResponseSchema = z.object({
  type: z.literal("brain.bench.response"),
  payload: BrainJobResultSchema,
});

// Poll the active + recently-finished jobs.
export const BrainJobsListRequestSchema = z.object({
  type: z.literal("brain.jobs.list.request"),
  requestId: z.string(),
});

export const BrainJobsListResponseSchema = z.object({
  type: z.literal("brain.jobs.list.response"),
  payload: BrainJobsResultSchema,
});

// Cancel a running job; returns the refreshed job list.
export const BrainJobsCancelRequestSchema = z.object({
  type: z.literal("brain.jobs.cancel.request"),
  jobId: z.string(),
  requestId: z.string(),
});

export const BrainJobsCancelResponseSchema = z.object({
  type: z.literal("brain.jobs.cancel.response"),
  payload: BrainJobsResultSchema,
});

// One GGUF repo from a Hugging Face search. Passthrough so the brain's search
// row can grow fields without a protocol bump.
export const BrainHfSearchResultSchema = z
  .object({
    repo: z.string().default(""),
    downloads: z.number().default(0),
    likes: z.number().default(0),
    gated: z.boolean().default(false),
    // A short, source-authored excerpt extracted from the repository's model card.
    summary: z.string().nullable().optional(),
    // True when any quant of this repo is already on disk.
    installed: z.boolean().default(false),
  })
  .passthrough();
export type BrainHfSearchResult = z.infer<typeof BrainHfSearchResultSchema>;

// One downloadable quantization of a repo - `otto-brain add <repo> --list-quants`.
export const BrainRepoQuantSchema = z
  .object({
    quant: z.string().default(""),
    size: z.string().default(""),
    sizeBytes: z.number().default(0),
    files: z.number().default(0),
    fileNames: z.array(z.string()).optional(),
    // True when this specific quant is already on disk.
    installed: z.boolean().default(false),
    // The installed model's stable id, when this quant is already on disk.
    // Optional so daemons predating quant deletion remain compatible.
    modelId: z.string().nullable().optional(),
    // The shared projector detected in this repository. It is repeated on
    // each quant row because the quant picker is the unit that discovers and
    // presents a downloadable Hugging Face bundle.
    projector: z
      .object({
        file: z.string(),
        sizeBytes: z.number(),
        // COMPAT(brainDiscoveredProjectorState): added in v0.8.7, remove after 2027-02-11.
        installed: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();
export type BrainRepoQuant = z.infer<typeof BrainRepoQuantSchema>;

// Search Hugging Face for GGUF models - `otto-brain search <query>`.
export const BrainHfSearchRequestSchema = z.object({
  type: z.literal("brain.hf.search.request"),
  query: z.string(),
  limit: z.number().nullable().default(null),
  requestId: z.string(),
});

export const BrainHfSearchResponseSchema = z.object({
  type: z.literal("brain.hf.search.response"),
  payload: z.object({
    results: z.array(BrainHfSearchResultSchema).default([]),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// List the quantizations a repo offers - `otto-brain add <repo> --list-quants`.
export const BrainHfQuantsRequestSchema = z.object({
  type: z.literal("brain.hf.quants.request"),
  repo: z.string(),
  requestId: z.string(),
});

export const BrainHfQuantsResponseSchema = z.object({
  type: z.literal("brain.hf.quants.response"),
  payload: z.object({
    quants: z.array(BrainRepoQuantSchema).default([]),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Download a chosen quant of an arbitrary HF repo - starts a `pull` job.
export const BrainModelsAddRequestSchema = z.object({
  type: z.literal("brain.models.add.request"),
  repo: z.string(),
  quant: z.string(),
  // COMPAT(brainDiscoveredBundleComponents): added in v0.8.7, remove after 2027-02-11.
  components: z.array(z.string()).optional(),
  // COMPAT(brainBundleDownloadQueue): added in v0.8.8, drop the gate when floor >= v0.8.8.
  expectedBytes: z.number().nonnegative().optional(),
  requestId: z.string(),
});

export const BrainModelsAddResponseSchema = z.object({
  type: z.literal("brain.models.add.response"),
  payload: BrainJobResultSchema,
});

// --- Brain Console: the management API, proxied ---------------------------
// Unlike the job RPCs above (which shell out to `otto-brain <verb> --json` and
// are therefore local-only), these proxy the brain's own `/__host/*` HTTP API.
// The daemon already resolves that endpoint by mode, so a local child and a
// remote brain are reached by the same code with no branch on either side.
// All gated by server_info.features.brainConsole.
//
// Two versions matter and they move independently: the daemon (does it know how
// to proxy?) and the brain (does it serve it?). features.brainConsole answers
// the first; `capabilities` on brain.host.status answers the second. A brain too
// old for a capability is reported honestly rather than reimplemented.

/**
 * A model's hosting profile. Passthrough because the brain persists more than it
 * exposes for editing (batchSize, extraArgs, the reasoning-budget message) and
 * those must survive a round trip untouched rather than being dropped here.
 */

export type BrainProfile = z.infer<typeof BrainProfileSchema>;

/** A Brain-owned, named llama-server template composition. */
export const BrainHostingProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    family: z.string(),
    description: z.string().default(""),
    template: z.string().nullable().default(null),
    systemPromptAddendum: z.string().nullable().default(null),
    templateKwargs: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();
export type BrainHostingProfile = z.infer<typeof BrainHostingProfileSchema>;

/** One editable field, as the brain describes it, so the editor cannot drift. */

export type BrainProfileField = z.infer<typeof BrainProfileFieldSchema>;

/** A note on a field. `blocksStart` means this combination cannot load at all. */
export const BrainProfileWarningSchema = z
  .object({
    field: z.string().nullable().default(null),
    severity: z.string().default("info"),
    message: z.string().default(""),
    blocksStart: z.boolean().default(false),
  })
  .passthrough();
export type BrainProfileWarning = z.infer<typeof BrainProfileWarningSchema>;

/**
 * Where the KV bytes/token figure came from. `inherited` means it was measured
 * on a relative with the same attention geometry and rescaled, which the UI must
 * never present as measured on this file.
 */

export type BrainCalibrationInfo = z.infer<typeof BrainCalibrationInfoSchema>;

/** The VRAM breakdown for a profile. Raw bytes; the client formats at the edge. */
export const BrainBudgetSchema = z
  .object({
    weightsBytes: z.number().default(0),
    mmprojBytes: z.number().default(0),
    componentBytes: z.number().optional(),
    drafterKvBytes: z.number().optional(),
    imageProcessingBytes: z.number().optional(),
    kvBytes: z.number().default(0),
    overheadBytes: z.number().default(0),
    totalBytes: z.number().default(0),
    usableBytes: z.number().default(0),
    totalVramBytes: z.number().default(0),
    reserveBytes: z.number().default(0),
    kvBytesPerToken: z.number().default(0),
    source: z.string().default("unknown"),
    theoreticalKvBytesPerToken: z.number().nullable().default(null),
    fits: z.boolean().default(false),
    headroomBytes: z.number().default(0),
    utilization: z.number().default(0),
  })
  .passthrough();
export type BrainBudget = z.infer<typeof BrainBudgetSchema>;

/** A model's benchmark standing, joined onto its inventory row. */

export type BrainModelScore = z.infer<typeof BrainModelScoreSchema>;

/**
 * One installed model with everything the Models tab shows, joined by the brain.
 * The client must not have to correlate the scan, the metadata and the rankings
 * itself: they key on different things and only the brain knows the file layout.
 */
export const BrainInventoryModelSchema = z
  .object({
    id: z.string(),
    displayName: z.string().default(""),
    family: z.string().nullable().optional(),
    publisher: z.string().nullable().default(null),
    quant: z.string().nullable().default(null),
    sizeBytes: z.number().default(0),
    mmprojBytes: z.number().default(0),
    origin: z.string().nullable().default(null),
    arch: z.string().nullable().default(null),
    contextLength: z.number().nullable().default(null),
    blockCount: z.number().nullable().default(null),
    headCountKv: z.number().nullable().default(null),
    hasProjector: z.boolean().default(false),
    components: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().default(""),
          description: z.string().default(""),
          role: z.string().default(""),
          bytes: z.number().default(0),
          available: z.boolean().default(false),
          unavailableReason: z.string().optional(),
          required: z.boolean().default(false),
          defaultDownload: z.boolean().default(false),
          defaultLoad: z.boolean().default(false),
          minRuntimeBuild: z.number().optional(),
        }),
      )
      .nullable()
      .optional(),
    reasoning: z.boolean().default(false),
    mtp: z.boolean().default(false),
    distilled: z.boolean().default(false),
    useCases: z.array(z.string()).default([]),
    tier: z.string().nullable().default(null),
    profile: BrainProfileSchema.nullable().default(null),
    calibration: BrainCalibrationInfoSchema.nullable().default(null),
    budget: BrainBudgetSchema.nullable().default(null),
    maxContextThatFits: z.number().nullable().default(null),
    score: BrainModelScoreSchema.nullable().default(null),
    state: z.string().default("not-loaded"),
    warnings: z.array(BrainProfileWarningSchema).default([]),
  })
  .passthrough();
export type BrainInventoryModel = z.infer<typeof BrainInventoryModelSchema>;

export const BrainDiskUsageSchema = z
  .object({
    freeBytes: z.number().default(0),
    totalBytes: z.number().default(0),
    modelBytes: z.number().default(0),
  })
  .passthrough();
export type BrainDiskUsage = z.infer<typeof BrainDiskUsageSchema>;

// The joined inventory - GET /__host/models.
export const BrainModelsInventoryRequestSchema = z.object({
  type: z.literal("brain.models.inventory.request"),
  requestId: z.string(),
});

export const BrainModelsInventoryResponseSchema = z.object({
  type: z.literal("brain.models.inventory.response"),
  payload: z.object({
    models: z.array(BrainInventoryModelSchema).default([]),
    disk: BrainDiskUsageSchema.nullable().default(null),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Read a model's profile plus the descriptors an editor renders from.
export const BrainModelProfileGetRequestSchema = z.object({
  type: z.literal("brain.model.profile.get.request"),
  modelId: z.string(),
  requestId: z.string(),
});

export const BrainModelProfileGetResponseSchema = z.object({
  type: z.literal("brain.model.profile.get.response"),
  payload: z.object({
    profile: BrainProfileSchema.nullable().default(null),
    fields: z.array(BrainProfileFieldSchema).default([]),
    warnings: z.array(BrainProfileWarningSchema).default([]),
    calibration: BrainCalibrationInfoSchema.nullable().default(null),
    /** True when a previous resident-model edit still awaits a reload. */
    requiresRestart: z.boolean().default(false),
    hostingProfiles: z.array(BrainHostingProfileSchema).default([]),
    familyHostingProfileId: z.string().nullable().default(null),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Write the editable fields. `patch` carries only the eight the brain accepts;
// anything else is ignored there rather than rejected, so an older client that
// sends a field a newer brain dropped still succeeds.
export const BrainModelProfileSetRequestSchema = z.object({
  type: z.literal("brain.model.profile.set.request"),
  modelId: z.string(),
  patch: z.record(z.string(), z.unknown()),
  requestId: z.string(),
});

export const BrainModelProfileSetResponseSchema = z.object({
  type: z.literal("brain.model.profile.set.response"),
  payload: z.object({
    profile: BrainProfileSchema.nullable().default(null),
    fields: z.array(BrainProfileFieldSchema).default([]),
    /** Human-readable notes about anything clamped or ignored. */
    adjustments: z.array(z.string()).default([]),
    warnings: z.array(BrainProfileWarningSchema).default([]),
    calibration: BrainCalibrationInfoSchema.nullable().default(null),
    budget: BrainBudgetSchema.nullable().default(null),
    maxContextThatFits: z.number().nullable().default(null),
    /** True when the edited model is the resident one, so a restart applies it. */
    requiresRestart: z.boolean().default(false),
    hostingProfiles: z.array(BrainHostingProfileSchema).default([]),
    familyHostingProfileId: z.string().nullable().default(null),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// The budget for a hypothetical profile - GET /__host/model/budget. `overrides`
// are string-encoded field values so the UI can preview a budget while a control
// is mid-drag, without persisting a value the user is scrubbing past.
export const BrainModelBudgetGetRequestSchema = z.object({
  type: z.literal("brain.model.budget.get.request"),
  modelId: z.string(),
  overrides: z.record(z.string(), z.string()).default({}),
  requestId: z.string(),
});

export const BrainModelBudgetGetResponseSchema = z.object({
  type: z.literal("brain.model.budget.get.response"),
  payload: z.object({
    profile: BrainProfileSchema.nullable().default(null),
    budget: BrainBudgetSchema.nullable().default(null),
    maxContextThatFits: z.number().nullable().default(null),
    gpu: z.record(z.string(), z.unknown()).nullable().default(null),
    warnings: z.array(BrainProfileWarningSchema).default([]),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Load a model into the running brain. Distinct from brain.host.start, which
// restarts the daemon's child and has no remote equivalent.
export const BrainModelLoadRequestSchema = z.object({
  type: z.literal("brain.model.load.request"),
  modelId: z.string(),
  requestId: z.string(),
});

export const BrainModelLoadResponseSchema = z.object({
  type: z.literal("brain.model.load.response"),
  payload: z.object({
    status: BrainHostStatusSchema.nullable().default(null),
    /** The profile actually used: the brain clamps context to fit VRAM. */
    profile: BrainProfileSchema.nullable().default(null),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const BrainModelUnloadRequestSchema = z.object({
  type: z.literal("brain.model.unload.request"),
  requestId: z.string(),
});

export const BrainModelUnloadResponseSchema = z.object({
  type: z.literal("brain.model.unload.response"),
  payload: z.object({
    status: BrainHostStatusSchema.nullable().default(null),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Delete a model's files. The brain refuses while that model is loaded.
export const BrainModelDeleteRequestSchema = z.object({
  type: z.literal("brain.model.delete.request"),
  modelId: z.string(),
  requestId: z.string(),
});

export const BrainModelDeleteResponseSchema = z.object({
  type: z.literal("brain.model.delete.response"),
  payload: z.object({
    deleted: z.array(z.string()).default([]),
    freedBytes: z.number().default(0),
    includesProjector: z.boolean().default(false),
    /** How many models remain after the re-scan. */
    remaining: z.number().default(0),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const BrainModelComponentDeleteRequestSchema = z.object({
  type: z.literal("brain.model.component.delete.request"),
  modelId: z.string(),
  componentId: z.string(),
  requestId: z.string(),
});

export const BrainModelComponentDeleteResponseSchema = z.object({
  type: z.literal("brain.model.component.delete.response"),
  payload: z.object({
    deleted: z.array(z.string()).default([]),
    freedBytes: z.number().default(0),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Rename a model's display name. The brain rejects a collision with another
// model's current id/displayName: /v1/models keys its id on displayName, and
// both the completion path and defaultModel/switchTo resolve a model by
// displayName === name || id === name - a duplicate would strand one model
// unreachable by name with no error anywhere else in the chain.
export const BrainModelRenameRequestSchema = z.object({
  type: z.literal("brain.model.rename.request"),
  modelId: z.string(),
  displayName: z.string(),
  requestId: z.string(),
});

export const BrainModelRenameResponseSchema = z.object({
  type: z.literal("brain.model.rename.response"),
  payload: z.object({
    displayName: z.string().nullable().default(null),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Reset a model's display name back to its scan-derived default.
export const BrainModelRenameResetRequestSchema = z.object({
  type: z.literal("brain.model.rename.reset.request"),
  modelId: z.string(),
  requestId: z.string(),
});

export const BrainModelRenameResetResponseSchema = z.object({
  type: z.literal("brain.model.rename.reset.response"),
  payload: z.object({
    displayName: z.string().nullable().default(null),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Tail the current Brain service log, including managed child processes and host operations.
export const BrainLogsTailRequestSchema = z.object({
  type: z.literal("brain.logs.tail.request"),
  limit: z.number().nullable().default(null),
  requestId: z.string(),
});

export const BrainLogsTailResponseSchema = z.object({
  type: z.literal("brain.logs.tail.response"),
  payload: z.object({
    lines: z.array(z.string()).default([]),
    total: z.number().default(0),
    state: z.string().nullable().default(null),
    command: z.string().nullable().default(null),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

/**
 * Declare whether this client wants live Brain log lines pushed to it.
 *
 * Log lines are the one Brain push with no coalescing - the Logs tab exists to
 * show the exact ordered stream, so the daemon cannot merge them the way it
 * merges status snapshots. That makes them the heaviest Brain feed on the wire,
 * and until this request existed every connected client paid for them whether or
 * not the Logs tab was open. A phone on the relay paid the worst of it: decrypt,
 * parse and validate every llama-server line only for the client to drop it,
 * because `applyBrainLogLineAdded` no-ops when the Logs query holds no data.
 *
 * Watching is per socket, not per session, so a desktop with the Logs tab open
 * does not turn the feed on for the same account's phone. Nothing is lost by not
 * watching: the brain owns the durable ring buffer, so opening the tab tails it
 * (`brain.logs.tail.request`) and the push only appends from there.
 */

export const BrainLogsWatchResponseSchema = z.object({
  type: z.literal("brain.logs.watch.response"),
  payload: z.object({
    watching: z.boolean(),
    requestId: z.string(),
  }),
});

/**
 * The brain's own state, pushed the moment it changes.
 *
 * A complete cheap `BrainHostStatus` snapshot, never a delta - which is what
 * makes a missed message and a reconnect the same, idempotent, recovery. It
 * excludes `resources`, whose collection spawns `nvidia-smi` on the brain host
 * and stays an opt-in pull for the Overview tab.
 *
 * Scoped by the daemon connection that delivers it: the client writes it under
 * that runtime's `serverId`, so two connected hosts cannot overwrite each
 * other's brain state. Gated by `server_info.features.brainStatusPush`, which
 * is true only when both the daemon and the brain it reaches support the stream.
 */
export const BrainStatusChangedStatusPayloadSchema = z
  .object({
    status: z.literal("brain_status_changed"),
    brain: BrainHostStatusSchema,
  })
  .passthrough();

/** One durable log line, pushed immediately after the Brain service writes it. */

export type BrainHostStatusRequest = z.infer<typeof BrainHostStatusRequestSchema>;

export type BrainHostStatusResponse = z.infer<typeof BrainHostStatusResponseSchema>;

export type BrainHostStartRequest = z.infer<typeof BrainHostStartRequestSchema>;

export type BrainHostStartResponse = z.infer<typeof BrainHostStartResponseSchema>;

export type BrainHostStopRequest = z.infer<typeof BrainHostStopRequestSchema>;

export type BrainHostStopResponse = z.infer<typeof BrainHostStopResponseSchema>;

export type BrainHostRestartRequest = z.infer<typeof BrainHostRestartRequestSchema>;

export type BrainHostRestartResponse = z.infer<typeof BrainHostRestartResponseSchema>;

export type BrainEvalsGetRequest = z.infer<typeof BrainEvalsGetRequestSchema>;

export type BrainEvalsGetResponse = z.infer<typeof BrainEvalsGetResponseSchema>;

export type BrainNetworkDiscoverRequest = z.infer<typeof BrainNetworkDiscoverRequestSchema>;

export type BrainNetworkDiscoverResponse = z.infer<typeof BrainNetworkDiscoverResponseSchema>;

export type BrainModelsListRequest = z.infer<typeof BrainModelsListRequestSchema>;

export type BrainModelsListResponse = z.infer<typeof BrainModelsListResponseSchema>;

export type BrainRemoteConfigGetRequest = z.infer<typeof BrainRemoteConfigGetRequestSchema>;

export type BrainRemoteConfigGetResponse = z.infer<typeof BrainRemoteConfigGetResponseSchema>;

export type BrainRemoteConfigPatchRequest = z.infer<typeof BrainRemoteConfigPatchRequestSchema>;

export type BrainRemoteConfigPatchResponse = z.infer<typeof BrainRemoteConfigPatchResponseSchema>;

export type BrainModelsScanRequest = z.infer<typeof BrainModelsScanRequestSchema>;

export type BrainModelsScanResponse = z.infer<typeof BrainModelsScanResponseSchema>;

export type BrainCatalogListRequest = z.infer<typeof BrainCatalogListRequestSchema>;

export type BrainCatalogListResponse = z.infer<typeof BrainCatalogListResponseSchema>;

export type BrainRuntimeListRequest = z.infer<typeof BrainRuntimeListRequestSchema>;

export type BrainRuntimeListResponse = z.infer<typeof BrainRuntimeListResponseSchema>;

export type BrainModelsPullRequest = z.infer<typeof BrainModelsPullRequestSchema>;

export type BrainModelsPullResponse = z.infer<typeof BrainModelsPullResponseSchema>;

export type BrainRuntimeInstallRequest = z.infer<typeof BrainRuntimeInstallRequestSchema>;

export type BrainRuntimeInstallResponse = z.infer<typeof BrainRuntimeInstallResponseSchema>;

export type BrainRuntimeRemoveRequest = z.infer<typeof BrainRuntimeRemoveRequestSchema>;

export type BrainRuntimeRemoveResponse = z.infer<typeof BrainRuntimeRemoveResponseSchema>;

export type BrainCalibrateRequest = z.infer<typeof BrainCalibrateRequestSchema>;

export type BrainCalibrateResponse = z.infer<typeof BrainCalibrateResponseSchema>;

export type BrainSweepRequest = z.infer<typeof BrainSweepRequestSchema>;

export type BrainSweepResponse = z.infer<typeof BrainSweepResponseSchema>;

export type BrainBenchRequest = z.infer<typeof BrainBenchRequestSchema>;

export type BrainBenchResponse = z.infer<typeof BrainBenchResponseSchema>;

export type BrainJobsListRequest = z.infer<typeof BrainJobsListRequestSchema>;

export type BrainJobsListResponse = z.infer<typeof BrainJobsListResponseSchema>;

export type BrainJobsCancelRequest = z.infer<typeof BrainJobsCancelRequestSchema>;

export type BrainJobsCancelResponse = z.infer<typeof BrainJobsCancelResponseSchema>;

export type BrainHfSearchRequest = z.infer<typeof BrainHfSearchRequestSchema>;

export type BrainHfSearchResponse = z.infer<typeof BrainHfSearchResponseSchema>;

export type BrainHfQuantsRequest = z.infer<typeof BrainHfQuantsRequestSchema>;

export type BrainHfQuantsResponse = z.infer<typeof BrainHfQuantsResponseSchema>;

export type BrainModelsAddRequest = z.infer<typeof BrainModelsAddRequestSchema>;

export type BrainModelsAddResponse = z.infer<typeof BrainModelsAddResponseSchema>;

export type BrainModelsInventoryRequest = z.infer<typeof BrainModelsInventoryRequestSchema>;

export type BrainModelsInventoryResponse = z.infer<typeof BrainModelsInventoryResponseSchema>;

export type BrainModelProfileGetRequest = z.infer<typeof BrainModelProfileGetRequestSchema>;

export type BrainModelProfileGetResponse = z.infer<typeof BrainModelProfileGetResponseSchema>;

export type BrainModelProfileSetRequest = z.infer<typeof BrainModelProfileSetRequestSchema>;

export type BrainModelProfileSetResponse = z.infer<typeof BrainModelProfileSetResponseSchema>;

export type BrainModelBudgetGetRequest = z.infer<typeof BrainModelBudgetGetRequestSchema>;

export type BrainModelBudgetGetResponse = z.infer<typeof BrainModelBudgetGetResponseSchema>;

export type BrainModelLoadRequest = z.infer<typeof BrainModelLoadRequestSchema>;

export type BrainModelLoadResponse = z.infer<typeof BrainModelLoadResponseSchema>;

export type BrainModelUnloadRequest = z.infer<typeof BrainModelUnloadRequestSchema>;

export type BrainModelUnloadResponse = z.infer<typeof BrainModelUnloadResponseSchema>;

export type BrainModelDeleteRequest = z.infer<typeof BrainModelDeleteRequestSchema>;

export type BrainModelDeleteResponse = z.infer<typeof BrainModelDeleteResponseSchema>;

export type BrainModelComponentDeleteRequest = z.infer<
  typeof BrainModelComponentDeleteRequestSchema
>;

export type BrainModelComponentDeleteResponse = z.infer<
  typeof BrainModelComponentDeleteResponseSchema
>;

export type BrainModelRenameRequest = z.infer<typeof BrainModelRenameRequestSchema>;

export type BrainModelRenameResponse = z.infer<typeof BrainModelRenameResponseSchema>;

export type BrainModelRenameResetRequest = z.infer<typeof BrainModelRenameResetRequestSchema>;

export type BrainModelRenameResetResponse = z.infer<typeof BrainModelRenameResetResponseSchema>;

export type BrainLogsTailRequest = z.infer<typeof BrainLogsTailRequestSchema>;

export type BrainLogsTailResponse = z.infer<typeof BrainLogsTailResponseSchema>;

export type BrainLogsWatchRequest = z.infer<typeof BrainLogsWatchRequestSchema>;

export type BrainLogsWatchResponse = z.infer<typeof BrainLogsWatchResponseSchema>;

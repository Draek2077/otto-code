/** Otto Brain application contracts carried inside Paseo's plugin RPC envelope. */
import { z } from "zod";
import { BrainJobSummarySchema, BrainTelemetrySchema } from "./brain-library.js";

const Id = z.string().min(1).max(1024);
const NumberOrNull = z.number().finite().nullable();
const State = z.enum(["stopped", "starting", "ready", "failed", "stopping"]);
const Stage = z.enum(["processing", "thinking", "generating"]);
const Thread = z.object({
  slot: z.number().int().nonnegative(),
  phase: z.enum(["prefill", "decode"]),
  promptTokens: NumberOrNull,
  generatedTokens: z.number(),
  promptTokensPerSecond: NumberOrNull,
  tokensPerSecond: NumberOrNull,
});
const Slots = z.object({
  total: z.number().int().nonnegative(),
  busy: z.number().int().nonnegative(),
  idle: z.number().int().nonnegative(),
  prefill: z.number().int().nonnegative(),
  decode: z.number().int().nonnegative(),
  threads: z.array(Thread).max(256).optional(),
});
const Inference = z.object({
  activeRequests: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  thinking: z.number().int().nonnegative(),
  generating: z.number().int().nonnegative(),
  slotStages: z.record(z.string(), Stage).optional(),
});
export const BrainStatusSchema = z.object({
  instanceId: Id,
  running: z.boolean(),
  reachable: z.boolean(),
  state: State,
  version: z.string(),
  model: z.string().nullable(),
  modelId: z.string().nullable(),
  queued: z.number().int().nonnegative(),
  jobRevision: z.number().int().nonnegative(),
  libraryRevision: z.number().int().nonnegative(),
  ownerSettingsRevision: z.string().nullable(),
  telemetry: BrainTelemetrySchema,
  jobs: z.array(BrainJobSummarySchema).max(100),
  capabilities: z.object({
    apiVersion: z.number().int(),
    writable: z.boolean(),
    profiles: z.boolean(),
    profileRevisions: z.boolean(),
    budget: z.boolean(),
    inventory: z.boolean(),
    events: z.boolean(),
    logCursors: z.boolean(),
    resources: z.boolean(),
    jobs: z.boolean(),
    load: z.boolean(),
    delete: z.boolean(),
    rename: z.boolean(),
    reset: z.boolean(),
    runtimes: z.boolean(),
    catalog: z.boolean(),
    hfSearch: z.boolean(),
    modelAcquisition: z.boolean(),
    ownerSettings: z.boolean(),
    restart: z.boolean().optional(),
  }),
  residents: z
    .array(
      z.object({
        residentId: Id,
        modelId: Id,
        model: z.string().nullable(),
        state: State,
        loadSeconds: NumberOrNull,
        vramBytes: NumberOrNull,
        startedAt: z.string().nullable(),
        slots: Slots.nullable(),
        inference: Inference,
        reasoning: z.boolean(),
      }),
    )
    .max(16),
  scheduler: z.object({ waitingModelIds: z.record(z.string(), z.number().int().nonnegative()) }),
});
export type BrainStatus = z.infer<typeof BrainStatusSchema>;

export const BrainCredentialIntentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
  z.object({ action: z.literal("replace"), value: z.string().min(1).max(16384) }).strict(),
]);
export const BrainConnectionSaveSchema = z
  .object({
    expectedRevision: z.string().min(1).max(256),
    patch: z
      .object({
        enabled: z.boolean().optional(),
        autoStart: z.boolean().optional(),
        mode: z.enum(["local", "remote"]).optional(),
        remote: z
          .object({
            host: z.string().max(1024).optional(),
            port: z.number().int().min(1).max(65535).optional(),
            secure: z.boolean().optional(),
            certFingerprint: z.string().max(256).nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    credential: BrainCredentialIntentSchema,
  })
  .strict();
export const BrainStatusWaitSchema = z
  .object({
    leaseId: z.string().uuid(),
    cursor: z.string().max(512).nullable(),
    includeLogs: z.boolean(),
    afterLogIndex: z.number().int().nonnegative().nullable(),
    instanceId: Id.nullable(),
  })
  .strict();
export const BrainStatusReleaseSchema = z.object({ leaseId: z.string().uuid() }).strict();
export const BrainLifecycleSchema = z
  .object({ action: z.enum(["start", "stop", "restart"]), modelId: Id.nullable() })
  .strict();

export const BrainQuerySchema = z.discriminatedUnion("resource", [
  z
    .object({
      resource: z.enum(["status", "inventory", "catalog", "runtimes", "jobs", "evals"]),
    })
    .strict(),
  z.object({ resource: z.literal("resources"), requestId: z.string().uuid() }).strict(),
  z.object({ resource: z.enum(["profile", "delete-plan"]), modelId: Id }).strict(),
  z
    .object({
      resource: z.literal("search"),
      query: z.string().min(1).max(1024),
      limit: z.number().int().min(1).max(100),
    })
    .strict(),
  z.object({ resource: z.literal("quants"), repo: Id }).strict(),
]);
export const BrainActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["load", "unload", "delete", "reset-name"]), modelId: Id }).strict(),
  z
    .object({ action: z.literal("rename"), modelId: Id, displayName: z.string().min(1).max(256) })
    .strict(),
  z.object({ action: z.literal("delete-component"), modelId: Id, componentId: Id }).strict(),
  z
    .object({
      action: z.literal("save-profile"),
      modelId: Id,
      expectedRevision: Id,
      patch: z.record(z.string(), z.json()),
    })
    .strict(),
  z
    .object({ action: z.literal("budget"), modelId: Id, patch: z.record(z.string(), z.json()) })
    .strict(),
  z.object({ action: z.literal("scan") }).strict(),
  z
    .object({
      action: z.literal("job"),
      modelId: Id,
      operation: z.enum(["calibrate", "sweep", "benchmark"]),
    })
    .strict(),
  z.object({ action: z.literal("cancel-job"), jobId: Id }).strict(),
  z.object({ action: z.literal("runtime-candidate"), build: Id }).strict(),
  z
    .object({
      action: z.enum(["install-runtime", "remove-runtime", "select-runtime"]),
      runtimeId: Id.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("pull"),
      modelId: Id,
      quant: z.string().max(256).optional(),
      components: z.array(Id).max(100).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("add"),
      repo: Id,
      quant: Id,
      components: z.array(Id).max(100).optional(),
    })
    .strict(),
]);
export type BrainQuery = z.infer<typeof BrainQuerySchema>;
export type BrainAction = z.infer<typeof BrainActionSchema>;

const CredentialStatus = z.object({
  stored: z.boolean(),
  effectiveSource: z.enum(["none", "stored", "environment"]),
});
const Choice = z.object({ id: z.string(), label: z.string() });
export const BrainConnectionReadSchema = z.object({
  version: z.literal(1),
  revision: Id,
  config: z.object({
    enabled: z.boolean(),
    autoStart: z.boolean(),
    mode: z.enum(["local", "remote"]),
    remote: z.object({
      host: z.string(),
      port: z.number().int(),
      secure: z.boolean(),
      certFingerprint: z.string().nullable(),
    }),
  }),
  credential: CredentialStatus,
});
/** An allowlist projection: even an unexpected remote response cannot return stored keys. */
export const BrainOwnerReadSchema = z.object({
  version: z.literal(1),
  ownerId: Id,
  ownerLabel: z.string(),
  revision: Id,
  config: z.object({
    runtime: z.object({
      source: z.enum(["auto", "managed", "lmstudio"]),
      path: z.string().nullable(),
      selectionId: z.string().nullable(),
      logVerbosity: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
      ]),
    }),
    modelsDir: z.string().nullable(),
    defaults: z.object({
      cacheTypeK: z.string(),
      cacheTypeV: z.string(),
      flashAttention: z.boolean(),
      reasoningBudget: z.number(),
      parallelSlots: z.number(),
      contextCap: z.number(),
    }),
    defaultModel: z.string().nullable(),
    maxLoadedModels: z.number().int(),
    lockModel: z.boolean(),
    lockedModels: z.array(z.string()),
    listen: z.object({ host: z.string(), port: z.number().int() }),
    auth: z.object({ mode: z.enum(["none", "token"]) }),
    allowRemoteConfig: z.boolean(),
    allowInsecureBind: z.boolean(),
    tls: z.object({
      mode: z.enum(["off", "files", "self-signed", "tailscale"]),
      certFile: z.string().nullable(),
      keyFile: z.string().nullable(),
      hostname: z.string().nullable(),
      certDir: z.string().nullable(),
      renewBeforeDays: z.number(),
      checkIntervalMs: z.number(),
      tailscaleExe: z.string().nullable(),
    }),
  }),
  credentials: z.object({ access: CredentialStatus, huggingFace: CredentialStatus }),
  resolved: z.object({
    runtimeLabel: z.string().nullable(),
    executablePath: z.string().nullable(),
    modelsDirectory: z.string(),
    certificateDirectory: z.string().nullable(),
  }),
  choices: z.object({
    models: z.array(Choice).max(10000),
    runtimes: z.array(Choice).max(1000),
    cacheTypes: z.array(Choice).max(100),
  }),
  requiresRestart: z.boolean(),
  capabilities: z.object({
    networkDiscovery: z.boolean(),
    runtimeSelection: z.boolean(),
    storage: z.boolean(),
    accessCredential: z.boolean(),
    huggingFaceCredential: z.boolean(),
  }),
});
export type BrainOwnerRead = z.infer<typeof BrainOwnerReadSchema>;
export type BrainConnectionRead = z.infer<typeof BrainConnectionReadSchema>;
export const BrainBootstrapSchema = z.object({
  connection: BrainConnectionReadSchema,
  owner: BrainOwnerReadSchema.nullable(),
  ownerError: z.string().nullable(),
  localRunning: z.boolean(),
  endpoint: z.string().nullable(),
});
export const BrainNetworkDiscoverySchema = z.object({
  ownerId: Id,
  addresses: z.array(Choice).max(1000),
  tailscale: z.object({
    available: z.boolean(),
    hostname: z.string().nullable(),
    certificateDirectory: z.string().nullable(),
  }),
});
export const BrainStatusReadSchema = z.object({
  controlRevision: z.string(),
  cursor: z.string(),
  connection: z.enum(["connecting", "connected", "disconnected"]),
  status: BrainStatusSchema.nullable(),
  logs: z
    .array(z.object({ index: z.number().int().nonnegative(), line: z.string().max(8192) }))
    .max(2000),
  firstLogIndex: z.number().int().nonnegative(),
  nextLogIndex: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export const BrainOperationResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      kind: z.enum(["validation", "conflict", "unavailable", "unknown"]),
      message: z.string().max(1024),
    }),
  }),
]);

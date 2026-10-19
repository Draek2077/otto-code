import { z } from "zod";
import { AgentProviderSchema } from "./provider-manifest.js";

export const ProviderDiscoveryOptionsSchema = z.object({
  threadId: z.uuid(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4096).optional(),
  cwd: z.string().min(1).max(4096).optional(),
  compareSource: z.enum(["appServer", "exec"]).optional(),
});
export type ProviderDiscoveryOptions = z.infer<typeof ProviderDiscoveryOptionsSchema>;

const DiagnosticErrorSchema = z.enum([
  "startup_failed",
  "permission_denied",
  "timeout",
  "provider_error",
  "invalid_response",
]);
const PageSchema = z.object({
  status: z.enum(["ok", "error"]),
  error: DiagnosticErrorSchema.optional(),
  rawCount: z.number().int().nonnegative().optional(),
  cursorPresent: z.boolean().optional(),
  nextCursor: z.string().nullable().optional(),
  targetPresent: z.boolean().optional(),
  excluded: z
    .object({
      invalidMetadata: z.number().int().nonnegative(),
      cwd: z.number().int().nonnegative(),
      metadataGeneration: z.number().int().nonnegative(),
      alreadyImported: z.number().int().nonnegative(),
    })
    .optional(),
  eligibleCount: z.number().int().nonnegative().optional(),
});

export const ProviderDiscoveryDiagnosticSchema = z.object({
  runtime: z.object({
    resolvedExecutable: z.string().nullable(),
    version: z.string().nullable(),
    reportedHome: z.string().nullable(),
    launchHome: z.string().nullable(),
    homeVerification: z.enum(["runtime", "launch_environment_only", "unverified"]),
    configuredModelProvider: z.string().nullable(),
    storageBackend: z.null(),
  }),
  target: z.object({
    requestedId: z.string(),
    readAttempted: z.boolean(),
    status: z.enum(["found", "not_found", "error"]),
    error: DiagnosticErrorSchema.optional(),
    errorStage: z.enum(["startup", "thread_read"]).optional(),
    nativeId: z.string().optional(),
    title: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    modelProvider: z.string().nullable().optional(),
    project: z.string().nullable().optional(),
    section: z.string().nullable().optional(),
  }),
  listing: PageSchema,
  sourceComparison: PageSchema.optional(),
  knownImportedSessionCount: z.number().int().nonnegative(),
  request: ProviderDiscoveryOptionsSchema,
});
export type ProviderDiscoveryDiagnostic = z.infer<typeof ProviderDiscoveryDiagnosticSchema>;

// Existing RPC spelling and required fields stay unchanged for old clients.
export const ProviderDiagnosticRequestMessageSchema = z.object({
  type: z.literal("provider_diagnostic_request"),
  provider: AgentProviderSchema,
  requestId: z.string(),
  discovery: ProviderDiscoveryOptionsSchema.optional(),
});
export const ProviderDiagnosticResponseMessageSchema = z.object({
  type: z.literal("provider_diagnostic_response"),
  payload: z.object({
    provider: AgentProviderSchema,
    diagnostic: z.string(),
    requestId: z.string(),
    discovery: ProviderDiscoveryDiagnosticSchema.optional(),
  }),
});

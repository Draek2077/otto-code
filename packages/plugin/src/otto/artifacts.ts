import { z } from "zod";
import { defineRpc } from "../rpc.js";

export const ArtifactId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const ArtifactLocation = z.enum(["repository", "host", "legacy"]);
export const ArtifactScope = z.object({
  hostId: z.string().min(1).max(512),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("project"), id: z.string().min(1).max(512) }),
    z.object({ kind: z.literal("workspace"), id: z.string().min(1).max(512) }),
  ]),
});
export type ArtifactScope = z.infer<typeof ArtifactScope>;
export const ArtifactSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), agentId: z.string().min(1).max(512) }),
  z.object({
    kind: z.literal("workflow"),
    workflowId: z.string().max(512),
    runId: z.string().max(512),
  }),
  z.object({
    kind: z.literal("schedule"),
    scheduleId: z.string().max(512),
    runId: z.string().max(512),
  }),
]);
export const ArtifactRun = z.object({
  id: z.string(),
  trigger: z.enum(["create", "regenerate", "data", "repair", "move"]),
  status: z.enum(["running", "succeeded", "failed"]),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  error: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
});
export const ArtifactSummary = z.object({
  id: ArtifactId,
  name: z.string().min(1).max(200),
  description: z.string().max(12000),
  projectId: z.string(),
  location: ArtifactLocation,
  revision: z.string(),
  status: z.enum(["generating", "ready", "error"]),
  starred: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().nullable(),
  repairAvailable: z.boolean(),
  previewAvailable: z.boolean(),
  hasData: z.boolean(),
  source: ArtifactSource.nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummary>;
export const ArtifactDocument = z.object({
  lock: z.object({ revision: z.string(), canRecover: z.boolean() }).nullable(),
  artifact: ArtifactSummary,
  html: z.string().max(340000).nullable(),
  data: z.string().max(100000).nullable(),
  runs: z.array(ArtifactRun).max(20),
  path: z.string(),
  transcript: z.string().max(16000),
});
export type ArtifactDocument = z.infer<typeof ArtifactDocument>;
export const ArtifactRef = z.object({
  scope: ArtifactScope,
  id: ArtifactId,
  location: ArtifactLocation,
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;
export const ArtifactSelection = z.object({
  provider: z.string().min(1).max(512),
  model: z.string().min(1).max(512),
});
const version = z.string().regex(/^[a-f0-9]{64}$/);
const approved = z.literal(true);
export const ArtifactCommand = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("recover_lock"),
    expectedLockRevision: z.string(),
    userVerifiedNoActiveWriter: z.literal(true),
  }),
  z.object({
    type: z.literal("metadata"),
    name: z.string().min(1).max(200),
    description: z.string().max(12000),
    starred: z.boolean(),
  }),
  z.object({ type: z.literal("data"), json: z.string().min(1).max(100000) }),
  z.object({
    type: z.literal("regenerate"),
    instruction: z.string().min(1).max(12000),
    selection: ArtifactSelection.optional(),
    userApprovedDesignChange: approved,
  }),
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("repair"), userApprovedRepair: approved }),
  z.object({ type: z.literal("delete"), userApprovedDelete: approved }),
  z.object({
    type: z.literal("move"),
    destination: z.enum(["repository", "host"]),
    userApprovedMove: approved,
  }),
]);
export type ArtifactCommand = z.infer<typeof ArtifactCommand>;
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.enum(["invalid", "conflict", "busy", "unavailable"]),
        message: z.string().max(2000),
      }),
    }),
  ]);
}
const library = result(
  z.object({
    items: z.array(ArtifactSummary).max(100),
    total: z.number(),
    diagnostics: z.array(z.string()).max(50),
    projectId: z.string(),
    selectedLocation: z.enum(["repository", "host"]),
    settingsRevision: version,
  }),
);
export const listArtifacts = defineRpc({
  name: "artifacts.library.list.request",
  input: z.object({
    scope: ArtifactScope,
    query: z.string().max(200).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  output: library,
});
export const aggregateArtifacts = defineRpc({
  name: "artifacts.library.aggregate.request",
  input: z.object({
    hostId: z.string(),
    query: z.string().max(200).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  output: library,
});
export const readArtifact = defineRpc({
  name: "artifacts.document.read.request",
  input: ArtifactRef,
  output: result(ArtifactDocument),
});
export const createArtifact = defineRpc({
  name: "artifacts.document.create.request",
  input: z.object({
    scope: ArtifactScope,
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(12000),
    selection: ArtifactSelection.optional(),
  }),
  output: result(ArtifactSummary),
});
export const changeArtifact = defineRpc({
  name: "artifacts.document.change.request",
  input: ArtifactRef.extend({ expectedRevision: version, command: ArtifactCommand }),
  output: result(z.object({ artifact: ArtifactSummary.nullable() })),
});
export const setArtifactStorage = defineRpc({
  name: "artifacts.storage.set.request",
  input: z.object({
    scope: ArtifactScope,
    expectedRevision: version,
    location: z.enum(["repository", "host"]).nullable(),
  }),
  output: result(z.object({ revision: version })),
});
export const readArtifactStorage = defineRpc({
  name: "artifacts.storage.read.request",
  input: z.object({ scope: ArtifactScope }),
  output: result(
    z.object({
      location: z.enum(["repository", "host"]).nullable(),
      effectiveLocation: z.enum(["repository", "host"]),
      revision: version,
    }),
  ),
});
export const artifactHostDefaults = defineRpc({
  name: "artifacts.defaults.read.request",
  input: z.object({ hostId: z.string() }),
  output: result(z.object({ location: z.enum(["repository", "host"]), revision: version })),
});
export const setArtifactHostDefaults = defineRpc({
  name: "artifacts.defaults.set.request",
  input: z.object({
    hostId: z.string(),
    expectedRevision: version,
    location: z.enum(["repository", "host"]),
  }),
  output: result(z.object({ revision: version })),
});

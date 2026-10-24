/** Typed terminal operations reuse the owner's existing management routes and CAS writer. */
import { z } from "zod/v3";
import {
  TuiActionError,
  type BrainTuiAction,
  type BrainTuiActions,
  type BrainTuiActionType,
} from "./host.js";
import {
  TuiProfileSchema,
  TuiFieldSchema,
  TuiWarningSchema,
  TuiBudgetSchema,
  BrainTuiJobsSchema,
} from "./contracts.js";
import { TuiJobInputSchema, tuiJob } from "./jobs.js";

const Id = z.string().min(1).max(1024);
const Patch = z.record(z.unknown());
export const BrainTuiActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("refresh") }).strict(),
  z
    .object({ type: z.literal("profile.save"), modelId: Id, patch: Patch, expectedRevision: Id })
    .strict(),
  z
    .object({ type: z.literal("profile.fit"), modelId: Id, patch: Patch, expectedRevision: Id })
    .strict(),
  z.object({ type: z.literal("model.load"), modelId: Id }).strict(),
  z.object({ type: z.literal("model.unload"), modelId: Id }).strict(),
  z
    .object({
      type: z.literal("model.rename"),
      modelId: Id,
      displayName: z.string().min(1).max(128),
    })
    .strict(),
  z.object({ type: z.literal("model.resetName"), modelId: Id }).strict(),
  z.object({ type: z.literal("model.delete"), modelId: Id }).strict(),
  z.object({ type: z.literal("hf.search"), query: z.string().min(1).max(1024) }).strict(),
  z.object({ type: z.literal("hf.quants"), repo: Id }).strict(),
  z.object({ type: z.literal("hf.add"), repo: Id, quant: Id }).strict(),
  z.object({ type: z.literal("catalog.pull"), catalogId: Id }).strict(),
  z.object({ type: z.literal("runtime.install"), runtimeId: Id }).strict(),
  z.object({ type: z.literal("runtime.select"), runtimeId: Id }).strict(),
  z.object({ type: z.literal("runtime.remove"), runtimeId: Id }).strict(),
  z
    .object({
      type: z.literal("job.start"),
      operation: z.enum(["calibrate", "sweep", "bench"]),
      modelId: Id,
    })
    .strict(),
  z.object({ type: z.literal("job.cancel"), jobId: Id }).strict(),
]);
const SearchResult = z
  .array(
    z.object({
      repo: z.string(),
      author: z.string(),
      downloads: z.number(),
      likes: z.number(),
      updatedAt: z.string().nullable(),
      gated: z.boolean(),
      summary: z.string().nullable(),
    }),
  )
  .max(100);
const Quants = z.object({
  repo: z.string(),
  quants: z
    .array(z.object({ quant: z.string(), files: z.array(z.string()), sizeBytes: z.number() }))
    .max(10000),
  mmproj: z.object({ files: z.array(z.string()), sizeBytes: z.number() }).nullable(),
});
const JobResult = z.object({ jobId: Id });
const Void = z.void();
const Results: { [K in BrainTuiActionType]: z.ZodType<BrainTuiActions[K]["result"]> } = {
  refresh: Void,
  "profile.save": Void,
  "profile.fit": z.object({ contextSize: z.number().nullable() }),
  "model.load": Void,
  "model.unload": Void,
  "model.rename": Void,
  "model.resetName": Void,
  "model.delete": Void,
  "hf.search": SearchResult,
  "hf.quants": Quants,
  "hf.add": JobResult,
  "catalog.pull": JobResult,
  "runtime.install": JobResult,
  "runtime.select": Void,
  "runtime.remove": Void,
  "job.start": JobResult,
  "job.cancel": Void,
};
export function decodeTuiResult<K extends BrainTuiActionType>(
  type: K,
  value: unknown,
): BrainTuiActions[K]["result"] {
  return Results[type].parse(value);
}
const Saved = z.object({
  revision: Id,
  profile: TuiProfileSchema,
  fields: z.array(TuiFieldSchema).max(100),
  warnings: z.array(TuiWarningSchema).max(100),
  calibration: z.object({ state: z.string(), kvBytesPerToken: z.number().nullable() }),
  budget: TuiBudgetSchema.nullable(),
  maxContextThatFits: z.number().nullable(),
});
export const BrainTuiExecutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile"), modelId: Id, saved: Saved }),
  z.object({ kind: z.literal("job"), job: BrainTuiJobsSchema.element }),
  z.object({ kind: z.literal("value"), value: z.unknown() }),
  z.object({ kind: z.literal("accepted") }),
]);
export type BrainTuiExecution = z.infer<typeof BrainTuiExecutionSchema>;
export type TuiOwnerRequest = (route: string, body?: unknown) => Promise<unknown>;
const suffix = (id: string) => `?id=${encodeURIComponent(id)}`;

async function modelAction(
  action: Extract<BrainTuiAction, { modelId: string }>,
  request: TuiOwnerRequest,
): Promise<BrainTuiExecution> {
  const query = suffix(action.modelId);
  switch (action.type) {
    case "profile.save":
      return {
        kind: "profile",
        modelId: action.modelId,
        saved: Saved.parse(
          await request(`/__host/model/profile${query}`, {
            patch: action.patch,
            expectedRevision: action.expectedRevision,
          }),
        ),
      };
    case "profile.fit": {
      const preview = z
        .object({ revision: Id, maxContextThatFits: z.number().nullable() })
        .parse(await request(`/__host/model/budget${query}`, { patch: action.patch }));
      if (preview.revision !== action.expectedRevision)
        throw new TuiActionError("conflict", "The profile changed. Reload before fitting it.");
      return { kind: "value", value: { contextSize: preview.maxContextThatFits } };
    }
    case "job.start":
      return admit(
        await request("/__host/jobs", {
          operation: action.operation === "bench" ? "benchmark" : action.operation,
          modelId: action.modelId,
        }),
      );
    case "model.rename":
      await request(`/__host/model/rename${query}`, { displayName: action.displayName });
      break;
    case "model.resetName":
      await request(`/__host/model/rename/reset${query}`, {});
      break;
    case "model.delete":
      await request(`/__host/model/delete${query}`, {});
      break;
    case "model.load":
      await request(`/__host/model/load${query}`, {});
      break;
    case "model.unload":
      await request(`/__host/model/unload${query}`, {});
      break;
  }
  return { kind: "accepted" };
}
function admit(value: unknown): BrainTuiExecution {
  const admission = z.object({ job: TuiJobInputSchema }).parse(value);
  return { kind: "job", job: tuiJob(admission.job) };
}
export async function performTuiAction(
  input: unknown,
  request: TuiOwnerRequest,
): Promise<BrainTuiExecution> {
  const action = BrainTuiActionSchema.parse(input);
  if ("modelId" in action) return modelAction(action, request);
  switch (action.type) {
    case "refresh":
      await request("/__host/models/scan", {});
      break;
    case "hf.search":
      return {
        kind: "value",
        value: SearchResult.parse(
          z
            .object({ models: SearchResult })
            .parse(
              await request(`/__host/hf/search?query=${encodeURIComponent(action.query)}&limit=20`),
            ).models,
        ),
      };
    case "hf.quants":
      return {
        kind: "value",
        value: Quants.parse(
          await request(`/__host/hf/quants?repo=${encodeURIComponent(action.repo)}`),
        ),
      };
    case "hf.add":
      return admit(await request("/__host/jobs/add", { repo: action.repo, quant: action.quant }));
    case "catalog.pull":
      return admit(await request("/__host/jobs/pull", { modelId: action.catalogId }));
    case "runtime.install":
      return admit(await request("/__host/jobs/runtime-install", { runtimeId: action.runtimeId }));
    case "runtime.remove":
      return admit(await request("/__host/runtime/remove", { runtimeId: action.runtimeId }));
    case "runtime.select":
      await request("/__host/runtime/select", { runtimeId: action.runtimeId });
      break;
    case "job.cancel":
      await request("/__host/jobs/cancel", { id: action.jobId });
      break;
  }
  return { kind: "accepted" };
}

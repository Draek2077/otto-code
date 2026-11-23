/** Validate owning-host responses before exposing known library data to a client. */
import { z } from "zod";
import { BrainConnectionError } from "@getpaseo/brain/host";
import {
  BrainInventorySchema,
  BrainCatalogSchema,
  BrainSearchSchema,
  BrainQuantsSchema,
  BrainRuntimeListSchema,
  BrainJobListSchema,
  BrainAdmittedJobSchema,
  BrainProfileReadSchema,
  BrainProfileSavedSchema,
  BrainBudgetPreviewSchema,
  BrainResourcesSchema,
  BrainEvalsSchema,
} from "@getpaseo/protocol/otto/brain-library";
import {
  BrainStatusSchema,
  type BrainAction,
  type BrainQuery,
} from "@getpaseo/protocol/otto/brain";

export function decodeBrainOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BrainConnectionError(
      "unknown",
      "The Brain host returned unsupported data. Update the host and refresh before continuing.",
    );
  return parsed.data;
}
const QUERIES = {
  status: BrainStatusSchema,
  inventory: BrainInventorySchema,
  catalog: BrainCatalogSchema,
  runtimes: BrainRuntimeListSchema,
  jobs: BrainJobListSchema,
  resources: BrainResourcesSchema,
  profile: BrainProfileReadSchema,
  search: BrainSearchSchema,
  quants: BrainQuantsSchema,
  evals: BrainEvalsSchema,
  "delete-plan": z.object({
    bytes: z.number(),
    includesProjector: z.boolean(),
    componentIds: z.array(z.string()),
  }),
};
export function decodeBrainQuery(query: BrainQuery, value: unknown) {
  return decodeBrainOutput<unknown>(QUERIES[query.resource], value);
}
const JOB_ACTIONS = new Set(["job", "pull", "add", "install-runtime", "remove-runtime"]);
export function decodeBrainAction(action: BrainAction, value: unknown) {
  if (JOB_ACTIONS.has(action.action)) return decodeBrainOutput(BrainAdmittedJobSchema, value);
  if (action.action === "save-profile") return decodeBrainOutput(BrainProfileSavedSchema, value);
  if (action.action === "budget") return decodeBrainOutput(BrainBudgetPreviewSchema, value);
  if (action.action === "runtime-candidate")
    return decodeBrainOutput(
      z.object({ id: z.string(), build: z.string(), variant: z.string() }),
      value,
    );
  // These actions carry no client-readable native result. Success means the host acknowledged it.
  return { accepted: true };
}

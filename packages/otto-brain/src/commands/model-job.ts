/** CLI jobs use the host's scheduler and event feed, never a sidecar runtime. */
import { z } from "zod/v3";
import { pickModel } from "../models/pick.js";
import { CommandError } from "../output/types.js";
import type { ModelOperation } from "../service/model-operations.js";
import { ModelJobRequestSchema } from "../service/model-job-options.js";
import {
  followBrainJob,
  localJobTransport,
  type BrainJobStatus,
  type BrainJobTransport,
} from "../service/job-client.js";
import { localBrainRequest } from "../service/local-client.js";
import { withOperationHost } from "./operation-host.js";

const capabilitiesSchema = z.object({
  jobs: z.boolean(),
  events: z.boolean(),
  inventory: z.boolean(),
});
const inventorySchema = z.object({
  models: z.array(z.object({ id: z.string(), displayName: z.string() })),
  lastModelId: z.string().nullable(),
});
const admittedSchema = z.object({ job: z.object({ id: z.string().min(1) }) });
export interface ModelJobPort extends BrainJobTransport {
  request(route: string, signal: AbortSignal, body?: unknown): Promise<unknown>;
}
export interface ModelJobOptions {
  operation: ModelOperation;
  model?: string;
  budgets?: number[];
}

export async function runHostedModelJob(
  port: ModelJobPort,
  options: ModelJobOptions,
  signal: AbortSignal,
): Promise<{ model: { id: string; displayName: string }; job: BrainJobStatus }> {
  signal.throwIfAborted();
  const capabilities = capabilitiesSchema.safeParse(
    await port.request("/__host/capabilities", signal),
  );
  if (
    !capabilities.success ||
    !capabilities.data.jobs ||
    !capabilities.data.events ||
    !capabilities.data.inventory
  )
    throw new CommandError({
      code: "UPDATE_HOST",
      message: "Update the Brain host to run model operations.",
    });
  const inventory = inventorySchema.parse(await port.request("/__host/models", signal));
  const model = pickModel(inventory.models, options.model ?? inventory.lastModelId ?? undefined);
  const request = ModelJobRequestSchema.parse({
    operation: options.operation,
    modelId: model.id,
    ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
  });
  signal.throwIfAborted();
  const admitted = admittedSchema.parse(await port.request("/__host/jobs", signal, request));
  let job: BrainJobStatus;
  try {
    job = await followBrainJob(port, admitted.job.id, signal);
  } catch (error) {
    // Only an explicit command interruption cancels this command's admitted job.
    // A dropped feed must not cancel durable host work or another client's job.
    if (!signal.aborted) throw error;
    await port.request("/__host/jobs/cancel", AbortSignal.timeout(5000), { id: admitted.job.id });
    throw new CommandError({
      code: "CANCELED",
      message: "Brain operation cancellation requested.",
    });
  }
  if (job.state !== "completed")
    throw new CommandError({
      code: job.state === "canceled" ? "CANCELED" : "OPERATION_FAILED",
      message:
        job.state === "canceled"
          ? "Brain operation was canceled."
          : "Brain operation failed. Check the host logs.",
    });
  return { model, job };
}

export async function runModelJob(options: ModelJobOptions) {
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Brain command interrupted"));
  process.once("SIGINT", interrupt);
  try {
    return await withOperationHost((client) =>
      runHostedModelJob(
        {
          ...localJobTransport(client),
          request: (route, signal, body) => localBrainRequest(client, route, body, signal),
        },
        options,
        controller.signal,
      ),
    );
  } finally {
    process.off("SIGINT", interrupt);
  }
}

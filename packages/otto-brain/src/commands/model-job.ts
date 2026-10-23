/** CLI jobs use the host's scheduler and event feed, never a sidecar runtime. */
import { z } from "zod/v3";
import { pickModel } from "../models/pick.js";
import { CommandError } from "../output/types.js";
import type { ModelOperation } from "../service/model-operations.js";
import { ModelJobRequestSchema } from "../service/model-job-options.js";
import type { BrainJobStatus } from "../service/job-client.js";
import { withCommandHost, waitForCommandJob, type HostCommandPort } from "./host-command.js";

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
export type ModelJobPort = HostCommandPort;
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
  const job = await waitForCommandJob(port, admitted.job.id, signal);
  return { model, job };
}

export async function runModelJob(options: ModelJobOptions) {
  return withCommandHost((port, signal) => runHostedModelJob(port, options, signal));
}

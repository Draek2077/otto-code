/** Runtime commands use host-issued identities and the host's ownership guards. */
import { z } from "zod/v3";
import { DEFAULT_LLAMA_BUILD } from "../runtime/managed.js";
import { pickModel } from "../models/pick.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import { withCommandHost, waitForCommandJob, type HostCommandPort } from "./host-command.js";

const RuntimeRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  displayName: z.string(),
  version: z.string(),
  source: z.string(),
  dir: z.string(),
});
export type RuntimeRow = z.infer<typeof RuntimeRowSchema>;
const InventorySchema = z.object({ runtimes: z.array(RuntimeRowSchema) });
const CapabilitiesSchema = z.object({
  runtimes: z.literal(true),
  jobs: z.literal(true),
  events: z.literal(true),
});
const VariantSchema = z.enum(["auto", "cuda", "metal", "vulkan", "cpu"]);
const runtimeSchema: OutputSchema<RuntimeRow> = {
  idField: "dir",
  columns: [
    { header: "LABEL", field: "label", width: 20 },
    { header: "VERSION", field: "version", width: 10 },
    {
      header: "SOURCE",
      field: "source",
      width: 10,
      color: (value) => (value === "managed" ? "green" : undefined),
    },
    { header: "DIR", field: "dir", width: 50 },
  ],
};
async function inventory(port: HostCommandPort, signal: AbortSignal): Promise<RuntimeRow[]> {
  const capabilities = CapabilitiesSchema.safeParse(
    await port.request("/__host/capabilities", signal),
  );
  if (!capabilities.success)
    throw new CommandError({
      code: "UPDATE_HOST",
      message: "Update the Brain host to manage runtimes.",
    });
  return InventorySchema.parse(await port.request("/__host/runtimes", signal)).runtimes;
}
function selectedRuntime(rows: RuntimeRow[], name: string): RuntimeRow {
  return rows.find((row) => row.id === name || row.label === name) ?? pickModel(rows, name);
}

export async function runRuntimeListCommand(): Promise<AnyCommandResult<RuntimeRow>> {
  return withCommandHost(async (port, signal) => ({
    type: "list",
    data: await inventory(port, signal),
    schema: runtimeSchema,
  }));
}
export async function runHostedRuntimeInstall(
  port: HostCommandPort,
  options: { build?: string; variant?: string },
  signal: AbortSignal,
): Promise<RuntimeRow> {
  const build = options.build ?? DEFAULT_LLAMA_BUILD;
  const variant = VariantSchema.safeParse(options.variant ?? "auto");
  if (!variant.success || (build !== "latest" && !/^b[1-9]\d{0,8}$/.test(build)))
    throw new CommandError({
      code: "INVALID_RUNTIME",
      message: "Choose an official build tag or latest and a supported runtime variant.",
    });
  await inventory(port, signal);
  const choice = z
    .object({ id: z.string() })
    .parse(
      await port.request("/__host/runtime/candidate", signal, { build, variant: variant.data }),
    );
  const admitted = z
    .object({ job: z.object({ id: z.string() }) })
    .parse(await port.request("/__host/jobs/runtime-install", signal, { runtimeId: choice.id }));
  const job = await waitForCommandJob(port, admitted.job.id, signal);
  const result = z
    .object({ runtimeId: z.string(), warning: z.string().nullable().optional() })
    .parse(job.result);
  const installed = (await inventory(port, signal)).find(
    (runtime) => runtime.id === result.runtimeId,
  );
  if (!installed)
    throw new CommandError({
      code: "RUNTIME_CHANGED",
      message: "Runtime inventory changed after installation. Refresh the host runtime list.",
    });
  if (result.warning) process.stderr.write(`  warning: ${result.warning}\n`);
  return installed;
}
export async function runRuntimeInstallCommand(options: {
  build?: string;
  variant?: string;
}): Promise<AnyCommandResult<RuntimeRow>> {
  return withCommandHost(async (port, signal) => ({
    type: "single",
    data: await runHostedRuntimeInstall(port, options, signal),
    schema: runtimeSchema,
  }));
}
export async function runHostedRuntimeRemove(
  port: HostCommandPort,
  name: string,
  signal: AbortSignal,
): Promise<RuntimeRow[]> {
  const runtime = selectedRuntime(await inventory(port, signal), name);
  await port.request("/__host/runtime/remove", signal, { runtimeId: runtime.id });
  return inventory(port, signal);
}
export async function runRuntimeRemoveCommand(name: string): Promise<AnyCommandResult<RuntimeRow>> {
  return withCommandHost(async (port, signal) => ({
    type: "list",
    data: await runHostedRuntimeRemove(port, name, signal),
    schema: runtimeSchema,
  }));
}
export async function runRuntimeSelectCommand(name: string): Promise<AnyCommandResult<RuntimeRow>> {
  return withCommandHost(async (port, signal) => {
    const rows = await inventory(port, signal);
    const runtimeId = name === "auto" ? null : selectedRuntime(rows, name).id;
    await port.request("/__host/runtime/select", signal, { runtimeId });
    return { type: "list", data: await inventory(port, signal), schema: runtimeSchema };
  });
}

export {
  addRuntimeListOptions,
  addRuntimeInstallOptions,
  addRuntimeRemoveOptions,
  addRuntimeSelectOptions,
} from "./options.js";

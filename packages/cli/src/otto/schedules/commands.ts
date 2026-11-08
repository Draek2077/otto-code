import { Command } from "commander";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import * as rpc from "@getpaseo/plugin/otto/schedules";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { withOutput, type CommandOptions, type SingleResult } from "../../output/index.js";

export interface ScheduleCliClient {
  getLastServerInfoMessage(): { serverId: string; features?: { scheduleTargets?: boolean } } | null;
  invokePluginRpc(plugin: string, method: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}
type Connect = (target: DaemonTarget) => Promise<ScheduleCliClient>;
const envelope = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: rpc.ScheduleFailure }),
]);
/** One connected request, always closed, never replayed after loss of acknowledgement. */
export async function runOwnedScheduleRequest(
  target: DaemonTarget,
  method: string,
  input: unknown,
  approved: boolean,
  connect: Connect = (selected) => connectToDaemon({ target: selected }),
) {
  const operation = rpc.scheduleOperations.find((candidate) => candidate.name === method);
  if (!operation) throw new Error("Discover an available Schedule operation first.");
  const parsed = operation.input.parse(input);
  if (rpc.scheduleOperationWrites(method) && !approved)
    throw new Error(
      "Review the exact target, origin and revisions, then supply --approved for this write.",
    );
  const client = await connect(target);
  try {
    const info = client.getLastServerInfoMessage();
    // COMPAT(scheduleTargetsCli): added v0.10.0; remove after 2027-05-08 when floor >= v0.10.0.
    if (!info?.features?.scheduleTargets)
      throw new Error(
        "Update the selected host to use Schedule targets. Original agent commands remain available.",
      );
    if (rpc.scheduleOperationScope(method, parsed).hostId !== info.serverId)
      throw new Error("This Schedule request belongs to another owning host. No request was sent.");
    let response: unknown;
    try {
      response = await client.invokePluginRpc("otto-schedules", method, parsed);
    } catch {
      throw new Error(
        "The Schedule operation was not acknowledged. Inspect its saved origin or operation receipt before another write.",
      );
    }
    const result = envelope.parse(operation.output.parse(response));
    if (!result.ok) throw new Error(result.error.message);
    try {
      rpc.assertScheduleAcknowledgement(method, parsed, result.value);
    } catch {
      throw new Error(
        "The host response did not confirm this exact Schedule operation. Inspect its saved origin or creation intent before another write.",
      );
    }
    return result.value;
  } finally {
    await client.close();
  }
}
async function inputFile(file: string) {
  if ((await stat(file)).size > 768000)
    throw new Error("Schedule request JSON exceeds the transport budget.");
  return JSON.parse(await readFile(file, "utf8"));
}
function output(data: unknown): SingleResult<unknown> {
  return {
    type: "single",
    data,
    schema: {
      idField: () => "schedules",
      columns: [],
      renderHuman: (item) => JSON.stringify(item.data, null, 2),
    },
  };
}
const commands = [
  ["list", rpc.listSchedules],
  ["watch", rpc.watchSchedules],
  ["read", rpc.readSchedule],
  ["inspect-create", rpc.readCreatedSchedule],
  ["preview", rpc.previewScheduleCadence],
  ["history", rpc.readScheduleHistory],
  ["run", rpc.readScheduleRun],
  ["run-part", rpc.readScheduleRunPart],
  ["review", rpc.reviewScheduleTarget],
  ["create", rpc.createSchedule],
  ["update", rpc.updateSchedule],
  ["control", rpc.controlSchedule],
  ["storage", rpc.readScheduleStorage],
  ["storage-save", rpc.saveScheduleStorage],
  ["defaults", rpc.readScheduleDefaults],
  ["defaults-save", rpc.saveScheduleDefaults],
  ["transfer", rpc.transferSchedule],
  ["transfer-inspect", rpc.readScheduleTransfer],
  ["transfer-reconcile", rpc.reconcileScheduleTransfer],
  ["transfer-lock-recover", rpc.recoverScheduleTransferLock],
] as const;
export function createOwnedScheduleCommand(
  run: typeof runOwnedScheduleRequest = runOwnedScheduleRequest,
) {
  const root = new Command("targets").description(
    "Project-owned agent, saved Workflow and Artifact schedules; exact scoped JSON requests",
  );
  root
    .command("operations [name]")
    .description("Discover operation names, or the exact request schema for one operation")
    .action((name?: string) => {
      const operations = rpc.scheduleOperations.filter(
        (candidate) => !name || candidate.name === name,
      );
      if (!operations.length) throw new Error("Unknown Schedule operation.");
      process.stdout.write(
        JSON.stringify(
          operations.map((candidate) => rpc.describeScheduleOperation(candidate, !!name)),
          null,
          2,
        ) + "\n",
      );
    });
  for (const [name, contract] of commands) {
    const command = addJsonAndDaemonHostOptions(
      root
        .command(name)
        .description(contract.name)
        .requiredOption(
          "--input <file>",
          "Exact JSON request; discover its schema with operations <name>",
        )
        .option(
          "--approved",
          "Explicitly approve this exact mutation and its originating revisions",
        )
        .allowExcessArguments(false),
    );
    command.action(function (this: Command) {
      return withOutput(async (options: CommandOptions, _command: Command) => {
        const fields = z
          .object({ input: z.string(), approved: z.boolean().optional() })
          .parse(this.opts());
        const result = await run(
          options.daemonTarget,
          contract.name,
          await inputFile(fields.input),
          fields.approved === true,
        );
        return output(result);
      })(this.opts(), this);
    });
  }
  return root;
}

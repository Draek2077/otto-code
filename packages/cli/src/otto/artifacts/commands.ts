import { Command } from "commander";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import {
  listArtifacts,
  readArtifact,
  createArtifact,
  changeArtifact,
  setArtifactStorage,
  ArtifactCommand,
} from "@getpaseo/plugin/otto/artifacts";
import type { PluginRpcContract } from "@getpaseo/plugin";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { withOutput, type SingleResult, type CommandOptions } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";

interface ArtifactCliClient {
  getLastServerInfoMessage(): { serverId: string; features?: { ottoArtifacts?: boolean } } | null;
  invokePluginRpc(pluginId: string, method: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}
interface ArtifactRequest {
  method: string;
  input: unknown;
  output: z.ZodType;
}
export async function runArtifactRequest(
  target: DaemonTarget,
  build: (hostId: string) => Promise<ArtifactRequest>,
  connect: (target: DaemonTarget) => Promise<ArtifactCliClient> = (selected) =>
    connectToDaemon({ target: selected }),
): Promise<unknown> {
  const client = await connect(target);
  try {
    const info = client.getLastServerInfoMessage();
    // COMPAT(ottoArtifactsCli): added v0.10.0; remove after 2027-04-29 when host floor >= v0.10.0.
    if (!info?.features?.ottoArtifacts)
      throw new Error("Update the selected host to use Artifacts.");
    const operation = await build(info.serverId),
      result = operation.output.parse(
        await client.invokePluginRpc("otto-artifacts", operation.method, operation.input),
      );
    const envelope = z
      .discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), value: z.unknown() }),
        z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
      ])
      .parse(result);
    if (!envelope.ok) throw new Error(envelope.error.message);
    return envelope.value;
  } finally {
    await client.close().catch(() => undefined);
  }
}
function output(data: unknown): SingleResult<unknown> {
  return {
    type: "single",
    data,
    schema: {
      idField: () => "artifacts",
      columns: [],
      renderHuman: (result) => JSON.stringify(result.data, null, 2),
    },
  };
}
function text(command: Command, key: string) {
  const value: unknown = command.opts()[key];
  return typeof value === "string" ? value : "";
}
function reference(command: Command, hostId: string) {
  return {
    scope: { hostId, target: { kind: "workspace" as const, id: text(command, "workspace") } },
    id: String(command.processedArgs[0] ?? ""),
    location: text(command, "location"),
  };
}
function request(contract: PluginRpcContract, input: unknown): ArtifactRequest {
  return { method: contract.name, input: contract.input.parse(input), output: contract.output };
}
async function jsonInput(file: string) {
  if ((await stat(file)).size > 100000) throw new Error("Artifact input exceeds 100 KB.");
  return JSON.parse(await readFile(file, "utf8"));
}
function register(
  command: Command,
  build: (command: Command, hostId: string) => Promise<ArtifactRequest> | ArtifactRequest,
) {
  addJsonAndDaemonHostOptions(command)
    .requiredOption("--workspace <id>", "Owning workspace on the selected daemon")
    .allowExcessArguments(false)
    .action(function (this: Command) {
      return withOutput(async (options: CommandOptions, _command: Command) =>
        output(
          await runArtifactRequest(options.daemonTarget, async (hostId) => build(this, hostId)),
        ),
      )(this.opts(), this);
    });
}
function approve(command: Command) {
  if (command.opts().yes !== true)
    throw new Error("Review this destructive action and pass --yes to confirm.");
}
export function createArtifactsCommand(): Command {
  const root = new Command("artifact").description(
    "Create and manage durable project Artifacts through their owning Otto daemon",
  );
  register(
    root.command("ls").option("--search <text>", "Filter names and descriptions"),
    (command, hostId) =>
      request(listArtifacts, {
        scope: reference(command, hostId).scope,
        query: text(command, "search"),
      }),
  );
  register(
    root
      .command("inspect <id>")
      .option("--location <location>", "repository, host or legacy", "repository"),
    (command, hostId) => request(readArtifact, reference(command, hostId)),
  );
  register(
    root
      .command("create")
      .requiredOption("--name <name>")
      .requiredOption("--description <text>")
      .option("--provider <id>")
      .option("--model <id>"),
    (command, hostId) =>
      request(createArtifact, {
        scope: reference(command, hostId).scope,
        name: text(command, "name"),
        description: text(command, "description"),
        ...(text(command, "provider") || text(command, "model")
          ? { selection: { provider: text(command, "provider"), model: text(command, "model") } }
          : {}),
      }),
  );
  for (const operation of [
    "data",
    "metadata",
    "cancel",
    "regenerate",
    "repair",
    "delete",
    "move",
  ] as const) {
    const command = root
      .command(`${operation} <id>`)
      .option("--location <location>", "repository, host or legacy", "repository")
      .requiredOption("--revision <revision>", "Revision returned by inspect");
    if (operation === "data" || operation === "metadata")
      command.requiredOption("--input <file>", "Local JSON input file");
    if (operation === "regenerate")
      command.requiredOption("--instruction <text>", "Design-changing generation instructions");
    if (operation === "move")
      command.requiredOption("--destination <location>", "repository or host");
    if (["regenerate", "repair", "delete", "move"].includes(operation))
      command.option("--yes", "Confirm this reviewed destructive action");
    register(command, async (selected, hostId) => {
      let action: unknown = { type: operation };
      if (operation === "data")
        action = { type: "data", json: JSON.stringify(await jsonInput(text(selected, "input"))) };
      if (operation === "metadata")
        action = {
          ...z
            .object({ name: z.string(), description: z.string(), starred: z.boolean() })
            .parse(await jsonInput(text(selected, "input"))),
          type: "metadata",
        };
      if (operation === "regenerate") {
        approve(selected);
        action = {
          type: operation,
          instruction: text(selected, "instruction"),
          userApprovedDesignChange: true,
        };
      }
      if (operation === "repair") {
        approve(selected);
        action = { type: operation, userApprovedRepair: true };
      }
      if (operation === "delete") {
        approve(selected);
        action = { type: operation, userApprovedDelete: true };
      }
      if (operation === "move") {
        approve(selected);
        action = {
          type: operation,
          destination: text(selected, "destination"),
          userApprovedMove: true,
        };
      }
      return request(changeArtifact, {
        ...reference(selected, hostId),
        expectedRevision: text(selected, "revision"),
        command: ArtifactCommand.parse(action),
      });
    });
  }
  register(
    root
      .command("storage")
      .requiredOption("--revision <revision>", "Project settings revision returned by ls")
      .requiredOption("--location <location>", "repository, host or inherit"),
    (command, hostId) =>
      request(setArtifactStorage, {
        scope: reference(command, hostId).scope,
        expectedRevision: text(command, "revision"),
        location: text(command, "location") === "inherit" ? null : text(command, "location"),
      }),
  );
  return root;
}

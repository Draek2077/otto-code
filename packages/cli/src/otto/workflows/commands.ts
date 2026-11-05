import { Command } from "commander";
import { readFile, stat, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  workflowOperations,
  workflowList,
  workflowRead,
  workflowValidate,
  workflowReviewStart,
  workflowStart,
  workflowControl,
  workflowSave,
  workflowDelete,
  workflowExport,
  workflowReadStorage,
  type WorkflowScope,
} from "@getpaseo/plugin/otto/workflows";
import type { PluginRpcContract } from "@getpaseo/plugin";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { withOutput, type SingleResult, type CommandOptions } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
interface Client {
  getLastServerInfoMessage(): { serverId: string; features?: { ottoWorkflows?: boolean } } | null;
  invokePluginRpc(id: string, method: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}
interface Request {
  contract: PluginRpcContract;
  input: unknown;
  outputFile?: string;
}
const result = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
export async function runWorkflowRequest(
  target: DaemonTarget,
  build: (hostId: string) => Promise<Request>,
  connect: (target: DaemonTarget) => Promise<Client> = (selected) =>
    connectToDaemon({ target: selected }),
) {
  const client = await connect(target);
  try {
    const info = client.getLastServerInfoMessage();
    // COMPAT(ottoWorkflowsCli): added v0.10.0; remove after 2027-05-05 when host floor >= v0.10.0.
    if (!info?.features?.ottoWorkflows)
      throw new Error("Update the selected host to use Workflows.");
    const request = await build(info.serverId),
      input = request.contract.input.parse(request.input);
    const value = result.parse(
      request.contract.output.parse(
        await client.invokePluginRpc("otto-workflows", request.contract.name, input),
      ),
    );
    if (!value.ok) throw new Error(value.error.message);
    if (request.outputFile)
      await writeFile(request.outputFile, JSON.stringify(value.value, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
    return value.value;
  } finally {
    await client.close();
  }
}
function output(data: unknown): SingleResult<unknown> {
  return {
    type: "single",
    data,
    schema: {
      idField: () => "workflows",
      columns: [],
      renderHuman: (item) => JSON.stringify(item.data, null, 2),
    },
  };
}
function text(command: Command, key: string) {
  const value: unknown = command.opts()[key];
  return typeof value === "string" ? value : "";
}
async function json(file: string) {
  if ((await stat(file)).size > 2000000) throw new Error("Workflow input exceeds 2 MB.");
  return JSON.parse(await readFile(file, "utf8"));
}
function scope(command: Command, hostId: string): WorkflowScope {
  return { hostId, projectId: text(command, "project") };
}
function ref(command: Command, hostId: string) {
  return {
    scope: scope(command, hostId),
    id: String(command.processedArgs[0] ?? ""),
    kind: text(command, "kind"),
    location: text(command, "location"),
    ...(text(command, "storeKey") ? { storeKey: text(command, "storeKey") } : {}),
  };
}
function referenceOptions(command: Command) {
  return command
    .option("--kind <kind>", "ai, graph, template or run", "graph")
    .option("--location <location>", "repository, host or legacy", "repository")
    .option("--store-key <key>", "Exact retained origin key from ls");
}
function register(
  command: Command,
  build: (command: Command, hostId: string) => Promise<Request> | Request,
) {
  addJsonAndDaemonHostOptions(command)
    .requiredOption("--project <id>", "Owning canonical project on the selected daemon")
    .allowExcessArguments(false)
    .action(function (this: Command) {
      return withOutput(async (options: CommandOptions, _command: Command) =>
        output(
          await runWorkflowRequest(options.daemonTarget, async (hostId) => build(this, hostId)),
        ),
      )(this.opts(), this);
    });
}
export function createWorkflowCommand() {
  const root = new Command("workflow").description(
    "Durable AI/Graph Workflows over the selected Otto daemon",
  );
  root
    .command("operations [name]")
    .description("List operation names, or print the exact schema for one operation")
    .action((name?: string) => {
      const selected = workflowOperations.filter((op) => !name || op.name === name);
      if (name && !selected.length) throw new Error("Unknown Workflow operation.");
      process.stdout.write(
        JSON.stringify(
          selected.map((op) =>
            name ? { name: op.name, input: z.toJSONSchema(op.input) } : { name: op.name },
          ),
          null,
          2,
        ) + "\n",
      );
    });
  register(
    root
      .command("ls")
      .option("--kind <kind>", "definition, graph, ai, template or run", "definition")
      .option("--offset <number>", "Page offset", "0"),
    (command, hostId) => ({
      contract: workflowList,
      input: {
        scope: scope(command, hostId),
        kind: text(command, "kind"),
        offset: Number(text(command, "offset")),
        includeLegacy: true,
      },
    }),
  );
  register(referenceOptions(root.command("inspect <id>")), (command, hostId) => ({
    contract: workflowRead,
    input: ref(command, hostId),
  }));
  register(
    root
      .command("save")
      .requiredOption("--input <file>", "Authored {kind,value} JSON")
      .option("--revision <sha>", "Expected current revision, omit only for create")
      .option("--location <location>", "repository or host"),
    async (command, hostId) => ({
      contract: workflowSave,
      input: {
        scope: scope(command, hostId),
        document: await json(text(command, "input")),
        expectedRevision: text(command, "revision") || null,
        ...(text(command, "location") ? { location: text(command, "location") } : {}),
      },
    }),
  );
  register(
    root.command("validate").requiredOption("--input <file>", "Graph JSON"),
    async (command, hostId) => ({
      contract: workflowValidate,
      input: { scope: scope(command, hostId), graph: await json(text(command, "input")) },
    }),
  );
  register(
    root
      .command("review")
      .requiredOption("--workspace <id>")
      .requiredOption(
        "--input <file>",
        "Complete {kind,definition} or {kind,graph,inputs,seats,limits} launch",
      )
      .requiredOption("--operation <id>"),
    async (command, hostId) => ({
      contract: workflowReviewStart,
      input: {
        scope: scope(command, hostId),
        workspaceId: text(command, "workspace"),
        launch: await json(text(command, "input")),
        operationId: text(command, "operation"),
      },
    }),
  );
  register(
    root
      .command("start")
      .requiredOption("--token <token>", "Exact reviewed launch token")
      .requiredOption("--operation <id>"),
    (command, hostId) => ({
      contract: workflowStart,
      input: {
        scope: scope(command, hostId),
        token: text(command, "token"),
        operationId: text(command, "operation"),
      },
    }),
  );
  register(
    referenceOptions(root.command("control <id>"))
      .requiredOption("--revision <sha>")
      .requiredOption("--action <action>", "approve, reject or cancel")
      .option("--phase <id>")
      .option("--note <text>"),
    (command, hostId) => ({
      contract: workflowControl,
      input: {
        ref: ref(command, hostId),
        expectedRevision: text(command, "revision"),
        action: text(command, "action"),
        phaseId: text(command, "phase") || undefined,
        note: text(command, "note") || undefined,
      },
    }),
  );
  register(
    referenceOptions(root.command("delete <id>"))
      .requiredOption("--revision <sha>")
      .option("--yes", "Confirm retirement"),
    (command, hostId) => {
      if (command.opts().yes !== true) throw new Error("Review the exact document and pass --yes.");
      return {
        contract: workflowDelete,
        input: {
          ref: ref(command, hostId),
          expectedRevision: text(command, "revision"),
          confirmed: true,
        },
      };
    },
  );
  register(
    referenceOptions(root.command("export <id>")).requiredOption(
      "--output <file>",
      "New local JSON file; never overwrites",
    ),
    (command, hostId) => ({
      contract: workflowExport,
      input: ref(command, hostId),
      outputFile: text(command, "output"),
    }),
  );
  register(root.command("storage"), (command, hostId) => ({
    contract: workflowReadStorage,
    input: scope(command, hostId),
  }));
  register(
    root
      .command("call <operation>")
      .requiredOption("--input <file>", "Exact operation JSON; host/project scope is checked"),
    async (command, hostId) => {
      const contract = workflowOperations.find((op) => op.name === command.processedArgs[0]);
      if (!contract)
        throw new Error("Discover the exact operation with workflow operations first.");
      const input = await json(text(command, "input"));
      assertScope(input, scope(command, hostId));
      return { contract, input };
    },
  );
  return root;
}
export function assertScope(input: unknown, expected: WorkflowScope) {
  const value = z
    .object({
      scope: z.unknown().optional(),
      ref: z.object({ scope: z.unknown() }).optional(),
      source: z.object({ scope: z.unknown() }).optional(),
      hostId: z.string().optional(),
    })
    .passthrough()
    .parse(input);
  const selected = value.scope ?? value.ref?.scope ?? value.source?.scope;
  if (selected) {
    const actual = z.object({ hostId: z.string(), projectId: z.string() }).parse(selected);
    if (actual.hostId === expected.hostId && actual.projectId === expected.projectId) return;
  } else if (value.hostId === expected.hostId) return;
  throw new Error("Operation input must belong to the selected daemon and project.");
}

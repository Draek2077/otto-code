/** Otto-owned command composition. Help is inert; all effects belong to the selected daemon. */
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { z } from "zod";
import {
  BrainActionSchema,
  BrainBootstrapSchema,
  BrainConnectionReadSchema,
  BrainConnectionSaveSchema,
  BrainOwnerReadSchema,
  BrainQuerySchema,
  BrainCredentialIntentSchema,
  type BrainQuery,
  type BrainAction,
} from "@getpaseo/protocol/otto/brain";
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
import { BrainStatusSchema } from "@getpaseo/protocol/otto/brain";
import { withOutput, type CommandOptions, type SingleResult } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, withGlobalOptions } from "../../utils/command-options.js";
import { BrainCliError, runBrainRequest, type BrainCliRequest } from "./rpc.js";
import { readBrainInput } from "./input.js";
import { adoptSharedBrainCommands } from "./shared.js";

type RequestBuilder = (command: Command) => BrainCliRequest | Promise<BrainCliRequest>;
const Accepted = z.object({ accepted: z.literal(true) });
const JsonPatch = z.record(z.string(), z.json());
const Queries = {
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
const Jobs = new Set(["job", "pull", "add", "install-runtime", "remove-runtime"]);

function argument(command: Command, index = 0): string {
  const value: unknown = command.processedArgs[index];
  if (typeof value !== "string" || !value.length)
    throw new BrainCliError("BRAIN_INPUT_INVALID", "Supply the required host-issued identity.");
  return value;
}
function option(command: Command, key: string): string | undefined {
  const value: unknown = command.opts()[key];
  return typeof value === "string" ? value : undefined;
}
function query(input: BrainQuery): BrainCliRequest {
  return {
    method: "brain.query",
    input: BrainQuerySchema.parse(input),
    output: Queries[input.resource],
  };
}
function action(input: BrainAction): BrainCliRequest {
  let output: z.ZodType = Accepted;
  if (Jobs.has(input.action)) output = BrainAdmittedJobSchema;
  else if (input.action === "save-profile") output = BrainProfileSavedSchema;
  else if (input.action === "budget") output = BrainBudgetPreviewSchema;
  else if (input.action === "runtime-candidate")
    output = z.object({ id: z.string(), build: z.string(), variant: z.string() });
  return { method: "brain.action", input: BrainActionSchema.parse(input), output };
}
function outputResult(data: unknown): SingleResult<unknown> {
  return {
    type: "single",
    data,
    schema: {
      idField: () => "brain",
      columns: [],
      renderHuman: (result) => JSON.stringify(result.data, null, 2),
    },
  };
}

function register(command: Command, build: RequestBuilder): Command {
  addJsonAndDaemonHostOptions(command)
    .allowExcessArguments(false)
    .action(function (this: Command) {
      return withOutput(async (options: CommandOptions, _command: Command) => {
        let request: BrainCliRequest;
        try {
          request = await build(this);
        } catch (cause) {
          if (cause instanceof BrainCliError) throw cause;
          throw new BrainCliError(
            "BRAIN_INPUT_INVALID",
            "Check the Brain command fields. No request was sent.",
            { cause },
          );
        }
        return outputResult(await runBrainRequest(options.daemonTarget, request));
      })(this.opts(), this);
    });
  return command;
}

function registerModels(brain: Command): void {
  const models = brain.command("model").description("Manage the selected Brain owner's models");
  register(models.command("ls"), () => query({ resource: "inventory" }));
  register(models.command("scan"), () => action({ action: "scan" }));
  for (const operation of ["load", "unload", "delete", "reset-name"] as const)
    register(models.command(`${operation} <model-id>`), (command) =>
      action({ action: operation, modelId: argument(command) }),
    );
  register(models.command("rename <model-id> <name>"), (command) =>
    action({ action: "rename", modelId: argument(command), displayName: argument(command, 1) }),
  );
  register(models.command("delete-component <model-id> <component-id>"), (command) =>
    action({
      action: "delete-component",
      modelId: argument(command),
      componentId: argument(command, 1),
    }),
  );
  register(models.command("delete-plan <model-id>"), (command) =>
    query({ resource: "delete-plan", modelId: argument(command) }),
  );
  const profile = models
    .command("profile")
    .description("Read and explicitly save revisioned profiles");
  register(profile.command("show <model-id>"), (command) =>
    query({ resource: "profile", modelId: argument(command) }),
  );
  register(
    profile
      .command("save <model-id>")
      .requiredOption("--revision <revision>", "Originating profile revision")
      .requiredOption("--input <file|->", "JSON profile patch"),
    async (command) =>
      action(
        BrainActionSchema.parse({
          action: "save-profile",
          modelId: argument(command),
          expectedRevision: option(command, "revision"),
          patch: await readBrainInput(option(command, "input")!, JsonPatch),
        }),
      ),
  );
  register(
    profile
      .command("budget <model-id>")
      .requiredOption("--input <file|->", "JSON profile patch to preview"),
    async (command) =>
      action(
        BrainActionSchema.parse({
          action: "budget",
          modelId: argument(command),
          patch: await readBrainInput(option(command, "input")!, JsonPatch),
        }),
      ),
  );
}

function registerRuntimeExtensions(runtime: Command): void {
  register(
    runtime
      .command("candidate <build>")
      .description("Offer an official build tag or latest without installing"),
    (command) => action({ action: "runtime-candidate", build: argument(command) }),
  );
  register(runtime.command("auto").description("Restore automatic runtime selection"), () =>
    action({ action: "select-runtime", runtimeId: null }),
  );
}

function registerSettings(brain: Command): void {
  const connection = brain
    .command("connection")
    .description("Selected daemon's local/Remote Brain connection");
  register(connection.command("show"), () => ({
    method: "brain.connection.read",
    input: {},
    output: BrainConnectionReadSchema,
  }));
  register(
    connection
      .command("save")
      .requiredOption("--input <file|->", "Revisioned connection patch and credential intent"),
    async (command) => ({
      method: "brain.connection.save",
      input: await readBrainInput(option(command, "input")!, BrainConnectionSaveSchema),
      output: BrainConnectionReadSchema,
    }),
  );
  const owner = brain
    .command("owner")
    .description("Revisioned settings of the actual local or Remote Brain owner");
  register(owner.command("show <owner-id>"), (command) => ({
    method: "brain.owner.read",
    input: { ownerId: argument(command) },
    output: BrainOwnerReadSchema,
  }));
  // The owner validates its complete patch and write-only credential contract.
  // Reject unbounded or non-JSON input locally without copying that private schema.
  register(
    owner
      .command("save")
      .requiredOption(
        "--input <file|->",
        "Owner ID, expectedRevision, partial patch and credential intents",
      ),
    async (command) => ({
      method: "brain.owner.save",
      input: await readBrainInput(
        option(command, "input")!,
        z
          .object({
            ownerId: z.string().min(1),
            expectedRevision: z.string().min(1),
            patch: JsonPatch,
            credentials: z
              .object({
                access: BrainCredentialIntentSchema.optional(),
                huggingFace: BrainCredentialIntentSchema.optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      ),
      output: BrainOwnerReadSchema,
    }),
  );
}

export function createOttoBrainCommand(): Command {
  const brain = new Command("brain").description(
    "Manage Brain through the selected Otto daemon (including its Remote Brain)",
  );
  const openTerminal = withGlobalOptions(async (options: CommandOptions, _command: Command) => {
    const { runDaemonBrainTui } = await import("./tui.js");
    await runDaemonBrainTui(options.daemonTarget);
  });
  addJsonAndDaemonHostOptions(brain).action(openTerminal);
  addJsonAndDaemonHostOptions(
    brain.command("ui").description("Open the interactive terminal on the selected Brain owner"),
  ).action(openTerminal);
  register(brain.command("status"), () => ({
    method: "brain.bootstrap",
    input: {},
    output: BrainBootstrapSchema,
  }));
  register(brain.command("live-status"), () => query({ resource: "status" }));
  register(brain.command("resources"), () =>
    query({ resource: "resources", requestId: randomUUID() }),
  );
  for (const operation of ["start", "stop", "restart"] as const)
    register(
      brain
        .command(operation)
        .option("--model <model-id>", "Explicit model; omission uses the owner's saved default"),
      (command) => ({
        method: "brain.lifecycle",
        input: { action: operation, modelId: option(command, "model") ?? null },
        output: Accepted,
      }),
    );
  registerModels(brain);
  registerSettings(brain);
  register(brain.command("quants <repo>"), (command) =>
    query({ resource: "quants", repo: argument(command) }),
  );
  register(
    brain.command("benchmark <model-id>").description("Admit a durable host benchmark job"),
    (command) => action({ action: "job", operation: "benchmark", modelId: argument(command) }),
  );
  const jobs = brain.command("job").description("Inspect and explicitly cancel durable Brain jobs");
  register(jobs.command("ls"), () => query({ resource: "jobs" }));
  register(jobs.command("cancel <job-id>"), (command) =>
    action({ action: "cancel-job", jobId: argument(command) }),
  );
  register(brain.command("evals"), () => query({ resource: "evals" }));
  adoptSharedBrainCommands(brain);
  const runtime = brain.commands.find((command) => command.name() === "runtime");
  if (!runtime) throw new Error("Shared Brain runtime commands were not registered");
  registerRuntimeExtensions(runtime);
  return brain;
}

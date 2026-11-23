import { Command } from "commander";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { PluginRpcContract } from "@getpaseo/plugin";
import * as rpc from "@getpaseo/plugin/otto/architectural-views";
import { withOutput, type SingleResult, type CommandOptions } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runViewRequest, type ViewCliRequest } from "./connection.js";
function text(command: Command, key: string): string {
  const value: unknown = command.opts()[key];
  return typeof value === "string" ? value : "";
}
function scope(command: Command, hostId: string): rpc.ViewScope {
  const workspace = text(command, "workspace"),
    project = text(command, "project");
  if (!!workspace === !!project)
    throw new Error("Select exactly one --workspace or --project on the selected daemon.");
  return {
    hostId,
    target: workspace ? { kind: "workspace", id: workspace } : { kind: "project", id: project },
  };
}
function identity(command: Command): rpc.ViewIdentity {
  return rpc.ViewIdentity.parse({
    viewId: String(command.processedArgs[0] ?? ""),
    origin: { location: text(command, "location"), storeKey: text(command, "storeKey") },
  });
}
function selected(command: Command): rpc.ViewSelection {
  const draftId = text(command, "draftId"),
    revisionId = text(command, "historyRevision");
  if (draftId && revisionId) throw new Error("Choose one draft or history revision.");
  if (draftId) return { kind: "draft", draftId };
  return revisionId ? { kind: "revision", revisionId } : { kind: "published" };
}
function request(contract: PluginRpcContract, input: unknown, outputFile?: string): ViewCliRequest {
  return { contract, input: contract.input.parse(input), outputFile };
}
function output(data: unknown): SingleResult<unknown> {
  return {
    type: "single",
    data,
    schema: {
      idField: () => "architectural-views",
      columns: [],
      renderHuman: (value) => JSON.stringify(value.data, null, 2),
    },
  };
}
function register(
  command: Command,
  build: (command: Command, hostId: string) => Promise<ViewCliRequest> | ViewCliRequest,
) {
  addJsonAndDaemonHostOptions(command)
    .option("--workspace <id>", "Owning workspace")
    .option("--project <id>", "Owning project")
    .allowExcessArguments(false)
    .action(function (this: Command) {
      return withOutput(async (options: CommandOptions, _command: Command) =>
        output(await runViewRequest(options.daemonTarget, async (hostId) => build(this, hostId))),
      )(this.opts(), this);
    });
}
function located(command: Command) {
  return command
    .requiredOption("--location <repository|host>")
    .requiredOption("--store-key <sha>", "Exact origin returned by ls");
}
function edited(command: Command) {
  return located(command)
    .requiredOption("--draft-id <id>")
    .requiredOption("--revision <sha>", "Exact current draft revision");
}
function approved(command: Command) {
  if (command.opts().yes !== true) throw new Error("Review the action and pass --yes to confirm.");
  return true as const;
}
async function specification(file: string) {
  if ((await stat(file)).size > 524288) throw new Error("View source exceeds 512 KiB");
  return rpc.parseViewSpecification(JSON.parse(await readFile(file, "utf8")));
}
function sources(value: unknown): rpc.ViewReference[] {
  if (!Array.isArray(value)) throw new Error("Choose at least one --source root:id or record:id");
  return value.map((entry) => {
    if (typeof entry !== "string") throw new Error("Invalid source");
    const separator = entry.indexOf(":");
    return rpc.ViewReference.parse({
      kind: entry.slice(0, separator),
      id: entry.slice(separator + 1),
    });
  });
}
const accumulate = (value: string, previous: string[]) => [...previous, value];
export function createArchitecturalViewsCommand(): Command {
  const root = new Command("architectural-view")
    .alias("view")
    .description(
      "Author, review and publish project Architectural Views through their owning Otto daemon",
    );
  register(
    root.command("ls").option("--search <text>").option("--offset <number>", "Page offset", "0"),
    (command, hostId) =>
      request(rpc.readViews, {
        scope: scope(command, hostId),
        query: text(command, "search"),
        offset: Number(text(command, "offset")),
      }),
  );
  register(
    located(root.command("inspect <id>"))
      .option("--draft-id <id>")
      .option("--history-revision <sha>"),
    (command, hostId) =>
      request(rpc.readView, {
        scope: scope(command, hostId),
        identity: identity(command),
        selection: selected(command),
      }),
  );
  register(root.command("contract <kind>"), (command, hostId) =>
    request(rpc.readViewContract, {
      scope: scope(command, hostId),
      diagramType: command.processedArgs[0],
    }),
  );
  register(root.command("sources").option("--search <text>"), (command, hostId) =>
    request(rpc.readViewSources, { scope: scope(command, hostId), query: text(command, "search") }),
  );
  const draft = root
    .command("draft <id>")
    .requiredOption("--title <text>")
    .requiredOption("--kind <kind>")
    .option(
      "--source <root:id|record:id>",
      "Linked Knowledge source; repeat to add",
      accumulate,
      [],
    )
    .option("--draft-id <id>")
    .option("--operation <id>")
    .option("--input <file>", "Optional local specification JSON; otherwise stage a starter")
    .option("--published-revision <sha>")
    .option("--location <repository|host>")
    .option("--store-key <sha>");
  register(draft, async (command, hostId) =>
    request(rpc.createViewDraft, {
      scope: scope(command, hostId),
      viewId: String(command.processedArgs[0]),
      draftId: text(command, "draftId") || `draft-${randomUUID()}`,
      operationId: text(command, "operation") || randomUUID(),
      title: text(command, "title"),
      diagramType: text(command, "kind"),
      knowledgeReferences: sources(command.opts().source),
      published: text(command, "publishedRevision")
        ? { ...identity(command), revision: text(command, "publishedRevision") }
        : null,
      ...(text(command, "input")
        ? { specification: await specification(text(command, "input")) }
        : {}),
    }),
  );
  register(
    edited(root.command("update <id>")).requiredOption("--input <file>").option("--title <text>"),
    async (command, hostId) =>
      request(rpc.updateViewDraft, {
        scope: scope(command, hostId),
        identity: identity(command),
        draftId: text(command, "draftId"),
        expectedRevision: text(command, "revision"),
        specification: await specification(text(command, "input")),
        ...(text(command, "title") ? { title: text(command, "title") } : {}),
      }),
  );
  for (const [name, contract] of [
    ["publish", rpc.publishViewDraft],
    ["discard", rpc.discardViewDraft],
  ] as const)
    register(
      edited(root.command(`${name} <id>`))
        .option("--operation <id>")
        .option("--yes"),
      (command, hostId) =>
        request(contract, {
          scope: scope(command, hostId),
          identity: identity(command),
          draftId: text(command, "draftId"),
          expectedRevision: text(command, "revision"),
          operationId: text(command, "operation") || randomUUID(),
          userApproved: approved(command),
        }),
    );
  register(
    edited(root.command("review-base <id>"))
      .option("--published-revision <sha>")
      .option("--empty-base")
      .option("--yes"),
    (command, hostId) => {
      const revision = text(command, "publishedRevision"),
        empty = command.opts().emptyBase === true;
      if (!!revision === empty)
        throw new Error(
          "Supply the inspected --published-revision or explicitly choose --empty-base.",
        );
      return request(rpc.rebaseViewDraft, {
        scope: scope(command, hostId),
        identity: identity(command),
        draftId: text(command, "draftId"),
        expectedRevision: text(command, "revision"),
        expectedPublishedRevision: empty ? null : revision,
        userApproved: approved(command),
      });
    },
  );
  register(
    located(root.command("remove <id>"))
      .requiredOption("--revision <sha>")
      .option("--operation <id>")
      .option("--yes"),
    (command, hostId) =>
      request(rpc.removeView, {
        scope: scope(command, hostId),
        identity: identity(command),
        expectedRevision: text(command, "revision"),
        operationId: text(command, "operation") || randomUUID(),
        userApproved: approved(command),
      }),
  );
  register(
    located(root.command("revisions <id>")).option("--offset <number>", "Page offset", "0"),
    (command, hostId) =>
      request(rpc.listViewRevisions, {
        scope: scope(command, hostId),
        identity: identity(command),
        offset: Number(text(command, "offset")),
      }),
  );
  register(
    edited(root.command("author <id>"))
      .requiredOption("--provider <id>")
      .requiredOption("--model <id>")
      .option("--mode <id>")
      .option("--thinking <id>")
      .option("--yes"),
    (command, hostId) =>
      request(rpc.startViewAuthoring, {
        scope: scope(command, hostId),
        identity: identity(command),
        draftId: text(command, "draftId"),
        expectedRevision: text(command, "revision"),
        workspaceId: text(command, "workspace"),
        selection: {
          provider: text(command, "provider"),
          model: text(command, "model"),
          ...(text(command, "mode") ? { modeId: text(command, "mode") } : {}),
          ...(text(command, "thinking") ? { thinkingOptionId: text(command, "thinking") } : {}),
        },
        userApproved: approved(command),
      }),
  );
  register(edited(root.command("detach <id>")).option("--yes"), (command, hostId) =>
    request(rpc.detachViewAuthoring, {
      scope: scope(command, hostId),
      identity: identity(command),
      draftId: text(command, "draftId"),
      expectedRevision: text(command, "revision"),
      userApproved: approved(command),
    }),
  );
  register(located(root.command("show <id>")), (command, hostId) =>
    request(rpc.showView, {
      scope: scope(command, hostId),
      identity: identity(command),
      workspaceId: text(command, "workspace"),
    }),
  );
  register(
    located(root.command("operation <id>"))
      .requiredOption("--operation <id>")
      .option("--draft-id <id>"),
    (command, hostId) =>
      request(rpc.inspectViewOperation, {
        scope: scope(command, hostId),
        identity: identity(command),
        operationId: text(command, "operation"),
        ...(text(command, "draftId") ? { draftId: text(command, "draftId") } : {}),
      }),
  );
  register(
    located(root.command("export <id>"))
      .requiredOption("--revision <sha>")
      .requiredOption("--output <file>", "New local HTML file; never overwrite")
      .option("--draft-id <id>")
      .option("--history-revision <sha>"),
    (command, hostId) =>
      request(
        rpc.renderView,
        {
          scope: scope(command, hostId),
          identity: identity(command),
          selection: selected(command),
          expectedRevision: text(command, "revision"),
        },
        text(command, "output"),
      ),
  );
  return root;
}

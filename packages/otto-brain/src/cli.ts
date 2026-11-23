import { Command } from "commander";
import { resolveVersion } from "./version.js";
import { withOutput as renderCommand, type CommandExecution } from "./output/with-output.js";
export { withBrainCommandHost } from "./commands/target.js";
export type { HostCommandPort } from "./commands/host-command.js";
export { CommandError } from "./output/types.js";

export interface BrainCliRegistration {
  execute?: CommandExecution["run"];
  openUi?(command: Command): Promise<void>;
}

import {
  addServeOptions,
  addStartOptions,
  addStopOptions,
  addRestartOptions,
  addStatusOptions,
  addCalibrateOptions,
  addSweepOptions,
  addScanOptions,
  addCatalogOptions,
  addSearchOptions,
  addAddOptions,
  addPullOptions,
  addBenchOptions,
  addShareOptions,
  addReportOptions,
  addRescoreOptions,
  addRuntimeListOptions,
  addRuntimeInstallOptions,
  addRuntimeRemoveOptions,
  addRuntimeSelectOptions,
  addConfigShowOptions,
  addConfigSetOptions,
} from "./commands/options.js";
const runServeCommand = (
  ...args: Parameters<typeof import("./commands/lifecycle.js").runServeCommand>
) =>
  import("./commands/lifecycle.js").then((commandModule) => commandModule.runServeCommand(...args));
const runStartCommand = (
  ...args: Parameters<typeof import("./commands/lifecycle.js").runStartCommand>
) =>
  import("./commands/lifecycle.js").then((commandModule) => commandModule.runStartCommand(...args));
const runStopCommand = (
  ...args: Parameters<typeof import("./commands/lifecycle.js").runStopCommand>
) =>
  import("./commands/lifecycle.js").then((commandModule) => commandModule.runStopCommand(...args));
const runRestartCommand = (
  ...args: Parameters<typeof import("./commands/lifecycle.js").runRestartCommand>
) =>
  import("./commands/lifecycle.js").then((commandModule) =>
    commandModule.runRestartCommand(...args),
  );
const runStatusCommand = (
  ...args: Parameters<typeof import("./commands/lifecycle.js").runStatusCommand>
) =>
  import("./commands/lifecycle.js").then((commandModule) =>
    commandModule.runStatusCommand(...args),
  );
const runCalibrateCommand = (
  ...args: Parameters<typeof import("./commands/calibrate.js").runCalibrateCommand>
) =>
  import("./commands/calibrate.js").then((commandModule) =>
    commandModule.runCalibrateCommand(...args),
  );
const runSweepCommand = (
  ...args: Parameters<typeof import("./commands/sweep.js").runSweepCommand>
) => import("./commands/sweep.js").then((commandModule) => commandModule.runSweepCommand(...args));
const runScanCommand = (...args: Parameters<typeof import("./commands/scan.js").runScanCommand>) =>
  import("./commands/scan.js").then((commandModule) => commandModule.runScanCommand(...args));
const runCatalogCommand = (
  ...args: Parameters<typeof import("./commands/catalog.js").runCatalogCommand>
) =>
  import("./commands/catalog.js").then((commandModule) => commandModule.runCatalogCommand(...args));
const runSearchCommand = (
  ...args: Parameters<typeof import("./commands/search.js").runSearchCommand>
) =>
  import("./commands/search.js").then((commandModule) => commandModule.runSearchCommand(...args));
const runAddCommand = (...args: Parameters<typeof import("./commands/search.js").runAddCommand>) =>
  import("./commands/search.js").then((commandModule) => commandModule.runAddCommand(...args));
const runPullCommand = (...args: Parameters<typeof import("./commands/pull.js").runPullCommand>) =>
  import("./commands/pull.js").then((commandModule) => commandModule.runPullCommand(...args));
const runBenchCommand = (
  ...args: Parameters<typeof import("./commands/bench.js").runBenchCommand>
) => import("./commands/bench.js").then((commandModule) => commandModule.runBenchCommand(...args));
const runShareCommand = (
  ...args: Parameters<typeof import("./commands/share.js").runShareCommand>
) => import("./commands/share.js").then((commandModule) => commandModule.runShareCommand(...args));
const runReportCommand = (
  ...args: Parameters<typeof import("./commands/report.js").runReportCommand>
) =>
  import("./commands/report.js").then((commandModule) => commandModule.runReportCommand(...args));
const runRescoreCommand = (
  ...args: Parameters<typeof import("./commands/rescore.js").runRescoreCommand>
) =>
  import("./commands/rescore.js").then((commandModule) => commandModule.runRescoreCommand(...args));
const runRuntimeListCommand = (
  ...args: Parameters<typeof import("./commands/runtime.js").runRuntimeListCommand>
) =>
  import("./commands/runtime.js").then((commandModule) =>
    commandModule.runRuntimeListCommand(...args),
  );
const runRuntimeInstallCommand = (
  ...args: Parameters<typeof import("./commands/runtime.js").runRuntimeInstallCommand>
) =>
  import("./commands/runtime.js").then((commandModule) =>
    commandModule.runRuntimeInstallCommand(...args),
  );
const runRuntimeRemoveCommand = (
  ...args: Parameters<typeof import("./commands/runtime.js").runRuntimeRemoveCommand>
) =>
  import("./commands/runtime.js").then((commandModule) =>
    commandModule.runRuntimeRemoveCommand(...args),
  );
const runRuntimeSelectCommand = (
  ...args: Parameters<typeof import("./commands/runtime.js").runRuntimeSelectCommand>
) =>
  import("./commands/runtime.js").then((commandModule) =>
    commandModule.runRuntimeSelectCommand(...args),
  );
const runConfigShowCommand = (
  ...args: Parameters<typeof import("./commands/config.js").runConfigShowCommand>
) =>
  import("./commands/config.js").then((commandModule) =>
    commandModule.runConfigShowCommand(...args),
  );
const runConfigSetCommand = (
  ...args: Parameters<typeof import("./commands/config.js").runConfigSetCommand>
) =>
  import("./commands/config.js").then((commandModule) =>
    commandModule.runConfigSetCommand(...args),
  );

/** Shared registration; constructing help never resolves a home or starts a host. */
export function registerBrainCommands(
  program: Command,
  registration: BrainCliRegistration = {},
): void {
  const withOutput: typeof renderCommand = (handler) =>
    renderCommand(handler, registration.execute);
  program
    .option("-o, --format <format>", "output format: table, json, yaml", "table")
    .option("--json", "output in JSON format")
    .option("-q, --quiet", "minimal output (ids only)")
    .option("--no-headers", "omit table headers")
    .option("--no-color", "disable colored output");
  const openUi = async function (this: Command) {
    if (registration.openUi) return registration.openUi(this);
    const { runUiCommand } = await import("./commands/ui.js");
    let owner: { close(): Promise<void> } | undefined;
    try {
      await runUiCommand(async () => {
        const { openLocalBrainTui } = await import("./client/tui-http.js");
        const client = await openLocalBrainTui();
        owner = client;
        return client;
      });
    } finally {
      await owner?.close();
    }
  };
  program.action(openUi);
  program
    .command("ui")
    .description("Open the interactive Brain terminal without loading a model")
    .action(openUi);
  const serve = addServeOptions(program.command("serve"));
  serve.action(function (this: Command) {
    const execute = () => runServeCommand(this.opts<{ model?: string }>());
    return registration.execute ? registration.execute(this, execute) : execute();
  });
  addStartOptions(program.command("start")).action(withOutput(runStartCommand));
  addStopOptions(program.command("stop")).action(withOutput(runStopCommand));
  addRestartOptions(program.command("restart")).action(withOutput(runRestartCommand));
  addStatusOptions(program.command("status")).action(withOutput(runStatusCommand));
  addCalibrateOptions(program.command("calibrate")).action(withOutput(runCalibrateCommand));
  addSweepOptions(program.command("sweep")).action(withOutput(runSweepCommand));
  addScanOptions(program.command("scan")).action(withOutput(runScanCommand));
  addCatalogOptions(program.command("catalog")).action(withOutput(runCatalogCommand));
  addSearchOptions(program.command("search")).action(withOutput(runSearchCommand));
  addPullOptions(program.command("pull")).action(withOutput(runPullCommand));
  addAddOptions(program.command("add")).action(withOutput(runAddCommand));
  addBenchOptions(program.command("bench")).action(withOutput(runBenchCommand));
  addShareOptions(program.command("share")).action(withOutput(runShareCommand));
  addReportOptions(program.command("report")).action(withOutput(runReportCommand));
  addRescoreOptions(program.command("rescore")).action(withOutput(runRescoreCommand));
  const config = program.command("config").description("Inspect and edit Brain configuration");
  addConfigShowOptions(config.command("show")).action(withOutput(runConfigShowCommand));
  addConfigSetOptions(config.command("set")).action(withOutput(runConfigSetCommand));
  const runtime = program
    .command("runtime")
    .description("Manage the Brain host's llama.cpp runtimes");
  addRuntimeListOptions(runtime.command("list")).action(withOutput(runRuntimeListCommand));
  addRuntimeInstallOptions(runtime.command("install")).action(withOutput(runRuntimeInstallCommand));
  addRuntimeRemoveOptions(runtime.command("remove")).action(withOutput(runRuntimeRemoveCommand));
  addRuntimeSelectOptions(runtime.command("select")).action(withOutput(runRuntimeSelectCommand));
}
export function createBrainCommand(registration: BrainCliRegistration = {}): Command {
  const program = new Command("brain").description("Manage Otto Brain");
  registerBrainCommands(program, registration);
  return program;
}
export async function runBrainCli(argv: string[]): Promise<void> {
  const program = new Command("otto-brain")
    .version(resolveVersion())
    .description("Otto Brain standalone host");
  registerBrainCommands(program);
  await program.parseAsync(argv, { from: "user" });
}

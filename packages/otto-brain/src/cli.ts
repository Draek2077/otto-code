import { Command } from "commander";
import { resolveVersion } from "./version.js";
import { withOutput } from "./output/with-output.js";
import {
  addServeOptions,
  addStartOptions,
  addStopOptions,
  addRestartOptions,
  addStatusOptions,
  runServeCommand,
  runStartCommand,
  runStopCommand,
  runRestartCommand,
  runStatusCommand,
} from "./commands/lifecycle.js";
import { addCalibrateOptions, runCalibrateCommand } from "./commands/calibrate.js";
import { addSweepOptions, runSweepCommand } from "./commands/sweep.js";
import { addScanOptions, runScanCommand } from "./commands/scan.js";
import { addCatalogOptions, runCatalogCommand } from "./commands/catalog.js";
import {
  addSearchOptions,
  runSearchCommand,
  addAddOptions,
  runAddCommand,
} from "./commands/search.js";
import { addPullOptions, runPullCommand } from "./commands/pull.js";
import { addBenchOptions, runBenchCommand } from "./commands/bench.js";
import { addShareOptions, runShareCommand } from "./commands/share.js";
import {
  addRuntimeListOptions,
  addRuntimeInstallOptions,
  addRuntimeRemoveOptions,
  addRuntimeSelectOptions,
  runRuntimeListCommand,
  runRuntimeInstallCommand,
  runRuntimeRemoveCommand,
  runRuntimeSelectCommand,
} from "./commands/runtime.js";
import {
  addConfigShowOptions,
  addConfigSetOptions,
  runConfigShowCommand,
  runConfigSetCommand,
} from "./commands/config.js";

/** Shared registration; constructing help never resolves a home or starts a host. */
export function registerBrainCommands(program: Command): void {
  program
    .option("-o, --format <format>", "output format: table, json, yaml", "table")
    .option("--json", "output in JSON format")
    .option("-q, --quiet", "minimal output (ids only)")
    .option("--no-headers", "omit table headers")
    .option("--no-color", "disable colored output");
  addServeOptions(program.command("serve")).action(runServeCommand);
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
export function createBrainCommand(): Command {
  const program = new Command("brain").description("Manage Otto Brain");
  registerBrainCommands(program);
  return program;
}
export async function runBrainCli(argv: string[]): Promise<void> {
  const program = new Command("otto-brain")
    .version(resolveVersion())
    .description("Otto Brain standalone host");
  registerBrainCommands(program);
  await program.parseAsync(argv, { from: "user" });
}

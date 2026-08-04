/**
 * The `otto brain` command group. Built with commander to mirror @otto-code/cli:
 * a group factory (`createBrainCommand`) that adds straight into the main `otto`
 * program, and a `registerBrainCommands` that mounts the same verbs on a
 * standalone root program (for `bin/otto-brain` on a server without the full CLI).
 * Handlers stay pure - they return typed results wrapped by withOutput.
 */
import { Command } from "commander";

import { addBenchOptions, runBenchCommand } from "./commands/bench.js";
import { addCalibrateOptions, runCalibrateCommand } from "./commands/calibrate.js";
import { addCatalogOptions, runCatalogCommand } from "./commands/catalog.js";
import {
  addConfigSetOptions,
  addConfigShowOptions,
  runConfigSetCommand,
  runConfigShowCommand,
} from "./commands/config.js";
import { addShareOptions, runShareCommand } from "./commands/share.js";
import {
  addRestartOptions,
  addServeOptions,
  addStartOptions,
  addStatusOptions,
  addStopOptions,
  runRestartCommand,
  runServeCommand,
  runStartCommand,
  runStatusCommand,
  runStopCommand,
} from "./commands/lifecycle.js";
import { addPullOptions, runPullCommand } from "./commands/pull.js";
import { addReportOptions, runReportCommand } from "./commands/report.js";
import { addRescoreOptions, runRescoreCommand } from "./commands/rescore.js";
import {
  addRuntimeInstallOptions,
  addRuntimeListOptions,
  runRuntimeInstallCommand,
  runRuntimeListCommand,
} from "./commands/runtime.js";
import { addScanOptions, runScanCommand } from "./commands/scan.js";
import {
  addAddOptions,
  addSearchOptions,
  runAddCommand,
  runSearchCommand,
} from "./commands/search.js";
import { addSweepOptions, runSweepCommand } from "./commands/sweep.js";
import { addUiOptions, runUiCommand } from "./commands/ui.js";
import { withOutput } from "./output/with-output.js";

function addGlobalOptions(cmd: Command): Command {
  return cmd
    .option("-o, --format <format>", "output format: table, json, yaml", "table")
    .option("--json", "output in JSON format (alias for --format json)")
    .option("-q, --quiet", "minimal output (ids only)")
    .option("--no-headers", "omit table headers")
    .option("--no-color", "disable colored output");
}

/** Mount every brain verb on the given command (a root program or the group). */
export function registerBrainCommands(program: Command): Command {
  addGlobalOptions(program);

  // Interactive: bare invocation and `ui` launch the TUI (no output wrapper).
  program.action(runUiCommand);
  addUiOptions(program.command("ui")).action(runUiCommand);

  // Service lifecycle.
  addServeOptions(program.command("serve")).action(runServeCommand);
  addStartOptions(program.command("start")).action(withOutput(runStartCommand));
  addStopOptions(program.command("stop")).action(withOutput(runStopCommand));
  addRestartOptions(program.command("restart")).action(withOutput(runRestartCommand));
  addStatusOptions(program.command("status")).action(withOutput(runStatusCommand));

  // Discovery + ops.
  addScanOptions(program.command("scan")).action(withOutput(runScanCommand));
  addCalibrateOptions(program.command("calibrate")).action(withOutput(runCalibrateCommand));
  addSweepOptions(program.command("sweep")).action(withOutput(runSweepCommand));
  addCatalogOptions(program.command("catalog")).action(withOutput(runCatalogCommand));
  addPullOptions(program.command("pull")).action(withOutput(runPullCommand));
  addSearchOptions(program.command("search")).action(withOutput(runSearchCommand));
  addAddOptions(program.command("add")).action(withOutput(runAddCommand));

  // Benchmark suite (plain actions: long streaming runs with formatted reports).
  addBenchOptions(program.command("bench")).action(runBenchCommand);
  addRescoreOptions(program.command("rescore")).action(runRescoreCommand);
  addReportOptions(program.command("report")).action(runReportCommand);

  // runtime subgroup.
  const runtime = program.command("runtime").description("Manage the llama.cpp runtime");
  addRuntimeListOptions(runtime.command("list")).action(withOutput(runRuntimeListCommand));
  addRuntimeInstallOptions(runtime.command("install")).action(withOutput(runRuntimeInstallCommand));

  // config subgroup.
  const config = program.command("config").description("Inspect and edit brain config");
  addConfigShowOptions(config.command("show")).action(withOutput(runConfigShowCommand));
  addConfigSetOptions(config.command("set")).action(withOutput(runConfigSetCommand));

  addShareOptions(program.command("share")).action(withOutput(runShareCommand));

  return program;
}

/** The `brain` command group, for adding into the main `otto` CLI. */
export function createBrainCommand(): Command {
  const brain = new Command("brain").description("Host local AI models (otto-brain)");
  return registerBrainCommands(brain);
}

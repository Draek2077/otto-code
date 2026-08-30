import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, addJsonOption } from "../../utils/command-options.js";
import {
  runWorkflowGraphInspectCommand,
  runWorkflowGraphExportCommand,
  runWorkflowGraphImportCommand,
  runWorkflowGraphListCommand,
  runWorkflowGraphRunCommand,
  runWorkflowGraphValidateCommand,
} from "./graph.js";

export function createWorkflowCommand(): Command {
  const workflow = new Command("workflow").description("Manage Workflow definitions and runs");
  const graph = workflow.command("graph").description("Inspect, validate, and run Graph Workflows");

  addJsonAndDaemonHostOptions(graph.command("ls").description("List saved Graphs")).action(
    withOutput(runWorkflowGraphListCommand),
  );

  addJsonAndDaemonHostOptions(
    graph.command("inspect").description("Inspect a saved Graph").argument("<id>", "Graph ID"),
  ).action(withOutput(runWorkflowGraphInspectCommand));

  addJsonAndDaemonHostOptions(
    graph
      .command("export")
      .description("Export a saved Graph for explicit sharing")
      .argument("<id>", "Graph ID")
      .requiredOption("--output <file>", "Portable Graph export path"),
  ).action(withOutput(runWorkflowGraphExportCommand));

  addJsonAndDaemonHostOptions(
    graph
      .command("import")
      .description("Review or confirm a Graph copy into a project Workflow store")
      .argument("<file>", "Portable Graph export path")
      .requiredOption("--cwd <path>", "Destination project or workspace path")
      .option("--confirm", "Confirm review and write the Graph copy"),
  ).action(withOutput(runWorkflowGraphImportCommand));

  addJsonOption(
    graph
      .command("validate")
      .description("Validate a local Graph JSON document without importing or running it")
      .argument("<file>", "Path to a Graph JSON document"),
  ).action(withOutput(runWorkflowGraphValidateCommand));

  addJsonAndDaemonHostOptions(
    graph
      .command("run")
      .description("Run a saved Graph Workflow")
      .argument("<id>", "Saved Graph ID")
      .option("--cwd <path>", "Workspace directory (default: current; required with --host)")
      .option("--workspace <id>", "Existing workspace ID")
      .option("--title <title>", "Workflow title (default: Graph name)")
      .option("--description <text>", "Workflow description")
      .option("--input <key=value>", "Graph input; repeat for each value", collectGraphInput, [])
      .option("--orchestrator-profile <id>", "Agent profile for the orchestrator")
      .option("--orchestrator-provider <provider>", "Provider for the orchestrator")
      .option("--orchestrator-model <model>", "Model for --orchestrator-provider")
      .option("--orchestrator-thinking <id>", "Thinking option for the orchestrator"),
  ).action(withOutput(runWorkflowGraphRunCommand));

  return workflow;
}

function collectGraphInput(value: string, previous: string[]): string[] {
  return [...previous, value];
}

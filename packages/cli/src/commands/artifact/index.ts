import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runCancelCommand } from "./cancel.js";
import { runCreateCommand } from "./create.js";
import { runGetDataCommand } from "./get-data.js";
import { runArtifactListCommand } from "./ls.js";
import { runMoveCommand } from "./move.js";
import { runRepairCommand } from "./repair.js";
import { runRegenerateCommand } from "./regenerate.js";
import { runUpdateDataCommand } from "./update-data.js";

export function createArtifactCommand(): Command {
  const artifact = new Command("artifact").description("Inspect and update durable artifacts");

  addJsonAndDaemonHostOptions(
    artifact
      .command("create")
      .description("Create a durable artifact through the selected daemon host")
      .argument("<name>")
      .requiredOption("--project <root>", "Project root that owns the artifact")
      .requiredOption("--provider <provider>", "Provider used for generation")
      .requiredOption("--description <text>", "Self-contained deliverable description")
      .option("--model <model>", "Optional provider model")
      .option("--thinking <id>", "Optional provider thinking option"),
  ).action(withOutput(runCreateCommand));

  addJsonAndDaemonHostOptions(
    artifact
      .command("ls")
      .description("List durable artifacts on the selected daemon host")
      .option("--project <root>", "Limit to one project root (absolute path)"),
  ).action(withOutput(runArtifactListCommand));

  addJsonAndDaemonHostOptions(
    artifact
      .command("data")
      .description("Read an artifact's explicit JSON data contract")
      .argument("<id>"),
  ).action(withOutput(runGetDataCommand));

  addJsonAndDaemonHostOptions(
    artifact
      .command("update-data")
      .description("Replace only an artifact's explicit JSON data contract without regenerating")
      .argument("<id>")
      .requiredOption("--data <json>", "Complete JSON replacement data"),
  ).action(withOutput(runUpdateDataCommand));

  addJsonAndDaemonHostOptions(
    artifact
      .command("cancel")
      .description("Cancel a generating artifact and preserve any last known good output")
      .argument("<id>"),
  ).action(withOutput(runCancelCommand));

  addJsonAndDaemonHostOptions(
    artifact
      .command("regenerate")
      .description("Explicitly regenerate an artifact's visual output from its stored definition")
      .argument("<id>"),
  ).action(withOutput(runRegenerateCommand));

  addJsonAndDaemonHostOptions(
    artifact
      .command("move")
      .description("Move a settled artifact between repository and host storage")
      .argument("<id>")
      .requiredOption("--to <location>", "Destination: repository or host"),
  ).action(withOutput(runMoveCommand));

  addJsonAndDaemonHostOptions(
    artifact
      .command("repair")
      .description("Restore an artifact's last known good output")
      .argument("<id>"),
  ).action(withOutput(runRepairCommand));

  return artifact;
}

import { Command, Option } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runDeliverArchitecturalViewCommand } from "./deliver.js";
import { runDraftCreate, runDraftDiscard, runDraftPublish, runDraftUpdate } from "./draft.js";

export function createArchitecturalViewCommand(): Command {
  const architecturalView = new Command("architectural-view").description(
    "Create and inspect Knowledge-packaged Architectural Views",
  );

  addJsonAndDaemonHostOptions(
    architecturalView
      .command("deliver")
      .description(
        "Validate and deliver a Knowledge-packaged Architectural View through the daemon",
      )
      .argument("<id>", "Stable Architectural View ID")
      .requiredOption("--workspace <id>", "Workspace that owns the project Knowledge")
      .requiredOption("--source <path>", "Workspace-relative Architecture JSON source")
      .requiredOption("--title <text>", "Architectural View title")
      .option(
        "--link <kind:id>",
        "Knowledge link: root:<id> or record:<id>",
        (value, values: string[]) => values.concat(value),
        [],
      )
      .addOption(new Option("--quality <profile>").choices(["standard", "showcase"])),
  ).action(withOutput(runDeliverArchitecturalViewCommand));

  const draft = architecturalView
    .command("draft")
    .description("Manage staged Architectural View drafts");
  addJsonAndDaemonHostOptions(
    draft
      .command("create")
      .argument("<view-id>")
      .argument("<draft-id>")
      .requiredOption("--workspace <id>")
      .requiredOption("--title <text>")
      .option("--source <path>")
      .option(
        "--link <kind:id>",
        "Knowledge link",
        (value, values: string[]) => values.concat(value),
        [],
      )
      .addOption(new Option("--quality <profile>").choices(["standard", "showcase"])),
  ).action(withOutput(runDraftCreate));
  addJsonAndDaemonHostOptions(
    draft
      .command("update")
      .argument("<view-id>")
      .argument("<draft-id>")
      .requiredOption("--workspace <id>")
      .requiredOption("--source <path>")
      .addOption(new Option("--quality <profile>").choices(["standard", "showcase"])),
  ).action(withOutput(runDraftUpdate));
  addJsonAndDaemonHostOptions(
    draft
      .command("publish")
      .argument("<view-id>")
      .argument("<draft-id>")
      .requiredOption("--workspace <id>"),
  ).action(withOutput(runDraftPublish));
  addJsonAndDaemonHostOptions(
    draft
      .command("discard")
      .argument("<view-id>")
      .argument("<draft-id>")
      .requiredOption("--workspace <id>"),
  ).action(withOutput(runDraftDiscard));

  return architecturalView;
}

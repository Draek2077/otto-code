import { Command } from "commander";
import { runLsCommand } from "./ls.js";
import { runModelsCommand } from "./models.js";
import { runDiagnosticCommand } from "./diagnostic.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";

export function createProviderCommand(): Command {
  const provider = new Command("provider").description("Manage agent providers");

  addJsonAndDaemonHostOptions(
    provider.command("ls").description("List available providers and status"),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("models")
      .description("List models for a provider")
      .argument("<provider>", "Provider name (claude, codex, opencode)")
      .option("--thinking", "Include thinking option IDs for each model"),
  ).action(withOutput(runModelsCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("diagnostic")
      .description("Show provider installation, environment, and availability diagnostics")
      .argument("<provider>", "Provider name")
      .option(
        "--thread <native-id>",
        "Read-only Codex discovery diagnostic for an exact native thread UUID",
      )
      .option("--limit <count>", "Diagnostic native page size (1-100, default 20)")
      .option("--cursor <cursor>", "Read one diagnostic page using this native cursor")
      .option("--cwd <path>", "Filter the diagnostic native listing by cwd")
      .option(
        "--compare-source <source>",
        "Explicitly compare a first page from appServer or exec sources",
      ),
  ).action(withOutput(runDiagnosticCommand));

  return provider;
}

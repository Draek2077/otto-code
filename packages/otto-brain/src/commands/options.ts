/** Shared inert CLI contract. Registering help imports no host, scanner or operation runtime. */
import type { Command } from "commander";
import { DEFAULT_LLAMA_BUILD } from "../runtime/default-build.js";

export function addServeOptions(command: Command): Command {
  return command
    .description("Run the Brain host in the foreground")
    .option("--model <fragment>", "explicit model to load after the host is ready");
}

export function addStartOptions(command: Command): Command {
  return command
    .description("Start Brain detached")
    .option("--model <fragment>", "explicit model to load");
}

export function addStopOptions(command: Command): Command {
  return command.description("Stop the exact locally owned Brain host");
}

export function addRestartOptions(command: Command): Command {
  return command
    .description("Restart the locally owned Brain host")
    .option("--model <fragment>", "explicit model to load");
}

export function addStatusOptions(command: Command): Command {
  return command.description("Show local Brain host health");
}

export function addCalibrateOptions(command: Command): Command {
  return command
    .description("Measure real KV bytes/token and save it")
    .option("--model <fragment>", "model name fragment or catalog id");
}

export function addSweepOptions(command: Command): Command {
  return command
    .description("Find and save the best reasoning budget")
    .option("--model <fragment>", "model name fragment or catalog id")
    .option("--budgets <a,b,c>", "reasoning budgets to sweep");
}

export function addScanOptions(cmd: Command): Command {
  return cmd
    .description("List detected models on the Brain owner")
    .option("--no-metadata", "skip reading GGUF headers (faster)");
}

export function addCatalogOptions(cmd: Command): Command {
  return cmd.description("List downloadable models from the catalog");
}

export function addSearchOptions(cmd: Command): Command {
  return cmd
    .description("Search Hugging Face for GGUF models")
    .argument("<query>", "search text")
    .option("--limit <n>", "maximum results", "25");
}

export function addAddOptions(cmd: Command): Command {
  return cmd
    .description("Download a model from an arbitrary Hugging Face repo")
    .argument("<repo>", "owner/repo on Hugging Face")
    .option("--quant <label>", "quantization to download (e.g. Q5_K_M)")
    .option("--component <id...>", "download optional discovered component ids")
    .option("--primary-only", "download only the selected primary quant")
    .option("--components-only", "download selected bundle components without the primary quant")
    .option("--list-quants", "list the quantizations the repo offers and exit");
}

export function addPullOptions(cmd: Command): Command {
  return (
    cmd
      .description("Download a model from the catalog")
      .argument("<model>", "catalog id or name fragment")
      .option("--file <name.gguf>", "explicit GGUF file name in the repo")
      .option("--quant <label>", "download a specific quantization (e.g. Q5_K_M)")
      .option("--component <id...>", "download optional bundle component ids")
      // The daemon uses this for a bundle job that gained companions after its
      // primary transfer began. It is deliberately not a normal user action.
      .option("--components-only", "download selected bundle components without the primary quant")
      .option("--list-quants", "list the quantizations the repo offers and exit")
  );
}

export function addBenchOptions(command: Command): Command {
  return command
    .description("Score agentic coding ability on the Brain owner")
    .option("--model <fragments>", "model name fragment(s), comma-separated")
    .option("--endpoint <host:port>", "benchmark an endpoint already serving")
    .option("--only <a,b>", "run only these tasks")
    .option("--depths <a,b,c>", "prompt depths for the depth-scaling task")
    .option("--concurrency <n>", "requests in flight for the concurrency task", "3")
    .option("--no-execute", "syntax-check generated Python without executing it")
    .option("--port <n>", "legacy internal-port option; managed Brain chooses its resident ports")
    .option("--repo-workspace-dir <dir>", "workspace path to mine SWE-bench tasks from")
    .option("--repo-workspace <name>", "npm workspace name for mined tasks")
    .option("--repo-dir <dir>", "source repository for a Brain-owned disposable checkout")
    .option("--repo-ref <ref>", "git ref to mine", "origin/main")
    .option("--repo-max <n>", "maximum mined tasks", "5")
    .option("--curated <name>", "curated mined-repository preset (requires --repo-dir)");
}

export function addShareOptions(cmd: Command): Command {
  return cmd
    .description("Share this brain with other Otto hosts (off by default)")
    .option("--on", "turn sharing on")
    .option("--off", "turn sharing off (bind loopback only)")
    .option("--bind <where>", "network to bind: tailscale, all, or an explicit IP/host")
    .option("--access <mode>", "open (trusted network) or key (bearer token)")
    .option("--key <token>", "use this access key")
    .option("--generate", "generate a fresh access key")
    .option("--allow-config", "let key holders change model/lock over the network")
    .option("--no-allow-config", "forbid remote configuration")
    .option("--https <mode>", "off, self-signed, or tailscale");
}

export function addReportOptions(command: Command): Command {
  return command
    .description("Write the HTML comparison report")
    .option("--out <path>", "output HTML path");
}

export function addRescoreOptions(command: Command): Command {
  return command
    .description("Re-grade archived runs with the current scorer (no GPU)")
    .option("--run <id>", "rescore a single archived run")
    .option("--no-execute", "syntax-check generated code but do not run it");
}

export function addRuntimeListOptions(command: Command): Command {
  return command.description("List runtimes on the Brain host");
}

export function addRuntimeInstallOptions(command: Command): Command {
  return command
    .description("Download a self-contained llama.cpp runtime on the Brain host")
    .option("--build <tag>", "official build tag, or latest", DEFAULT_LLAMA_BUILD)
    .option("--variant <name>", "auto, cuda, metal, vulkan or cpu", "auto");
}

export function addRuntimeRemoveOptions(command: Command): Command {
  return command
    .description("Remove an unused Otto-managed runtime")
    .argument("<name>", "host runtime id or runtime name");
}

export function addRuntimeSelectOptions(command: Command): Command {
  return command
    .description("Select an installed runtime without restarting a resident model")
    .argument("<name>", "host runtime id, name or auto");
}

export function addConfigShowOptions(cmd: Command): Command {
  return cmd.description("Show the effective brain config");
}

export function addConfigSetOptions(cmd: Command): Command {
  return cmd
    .description("Set a config value")
    .argument("<key>", "config key (e.g. enabled, listen.port, runtime.source)")
    .argument("<value>", "new value");
}

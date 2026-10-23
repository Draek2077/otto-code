import { Command } from "commander";
import { loadBrainConfig } from "./config/store.js";
import { readRunningService } from "./service/pid-lock.js";
import { resolveVersion } from "./version.js";

/** Shared registration for the standalone command and the future Otto adapter. */
export function registerBrainCommands(program: Command): void {
  program
    .command("serve")
    .description("Run the Brain host in the foreground")
    .action(async () => {
      const { startService } = await import("./service/serve.js");
      const host = await startService({ config: loadBrainConfig() });
      process.stdout.write(
        `Otto Brain listening on ${host.secure ? "https" : "http"}://${host.displayHost}:${host.port}\n`,
      );
      const shutdown = (): void => {
        process.off("SIGTERM", shutdown);
        process.off("SIGINT", shutdown);
        void host.stop().catch(() => {
          process.stderr.write("Otto Brain could not shut down cleanly.\n");
          process.exitCode = 1;
        });
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    });
  program
    .command("status")
    .description("Show the local Brain host record")
    .action(() => {
      process.stdout.write(`${JSON.stringify(readRunningService() ?? { status: "stopped" })}\n`);
    });
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

import { runBrainCli } from "./cli.js";
try {
  await runBrainCli(process.argv.slice(2));
} catch {
  // Configuration and transport exceptions may contain credentials. The CLI
  // does not print raw third-party errors or private configuration.
  process.stderr.write("Otto Brain could not start. Check its configuration and host ownership.\n");
  process.exitCode = 1;
}

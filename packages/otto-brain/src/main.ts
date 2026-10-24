import { runBrainCli } from "./cli.js";
import { CommandError } from "./output/types.js";
try {
  await runBrainCli(process.argv.slice(2));
} catch (error) {
  // Configuration and transport exceptions may contain credentials. The CLI
  // does not print raw third-party errors or private configuration.
  if (error instanceof CommandError && error.code === "NO_TTY") {
    process.stderr.write(`${error.message}\n${error.details ?? ""}\n`);
  } else
    process.stderr.write(
      "Otto Brain could not start. Check its configuration and host ownership.\n",
    );
  process.exitCode = 1;
}

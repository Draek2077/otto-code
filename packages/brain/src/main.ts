/** Executable entry for bin/otto-brain. Runs the standalone CLI. */
import { runBrainCli } from "./run.js";

const code = await runBrainCli(process.argv.slice(2));
process.exitCode = code;

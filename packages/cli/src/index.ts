// oxlint-disable-next-line import/no-unassigned-import -- OTTO(environment): map OTTO_* onto PASEO_* first.
import "@getpaseo/protocol/otto/apply-environment";
import { runCli } from "./run.js";

const exitCode = await runCli(process.argv.slice(2), {
  nodeArgv: [process.argv[0] ?? "node", process.argv[1] ?? "otto"] /* OTTO(identity) */,
});
process.exitCode = exitCode;

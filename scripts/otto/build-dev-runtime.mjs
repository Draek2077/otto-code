import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run through npm run build:dev-runtime.");
// Build the daemon's real declarations/bundles before Electron can reuse an older binary.
// Serial builds and a bounded Go compiler budget keep this foreground startup step modest.
for (const name of [
  "highlight",
  "brain",
  "plugin",
  "relay",
  "protocol",
  "client",
  "server",
  "cli",
]) {
  const result = spawnSync(
    process.execPath,
    [npm, "run", "build", `--workspace=@getpaseo/${name}`],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, GOMAXPROCS: process.env.GOMAXPROCS || "2" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

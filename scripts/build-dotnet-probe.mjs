#!/usr/bin/env node
/**
 * Builds the .NET solution sidecar into a portable, framework-dependent payload.
 *
 * There is deliberately no per-RID matrix here and no NuGet restore at run time: the output is
 * IL, so the same handful of files runs on Windows, macOS and Linux, and a machine that is
 * offline or locked down never has to fetch anything to use the feature. That is the whole
 * shipping decision — build once, ship everywhere.
 *
 * `dotnet` is required to *build* the payload, not to consume it, so this script is not part of
 * `npm run build`. A contributor without the .NET SDK gets the rest of the repo working normally
 * and simply has no Solution view; the daemon reports the payload as absent and the switcher
 * never appears. Pass `--required` (CI does) to turn a missing SDK into a failure.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = join(repoRoot, "packages", "dotnet-probe", "OttoDotnetProbe.csproj");
const outputDir = join(repoRoot, "packages", "dotnet-probe", "dist");
/**
 * The published-package location. `bootstrap.ts` looks here first when the daemon runs from an
 * installed tarball rather than from the repo, so a release only works if this build runs after
 * `build:server` — a clean server build wipes `dist`.
 */
const serverCopyDir = join(repoRoot, "packages", "server", "dist", "dotnet-probe");

const required = process.argv.includes("--required");

function fail(message) {
  console.error(`build:dotnet-probe: ${message}`);
  process.exit(required ? 1 : 0);
}

const probe = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
if (probe.status !== 0) {
  fail(
    "no .NET SDK on PATH — skipping the solution sidecar (the Solution view will be unavailable)",
  );
}

console.log(`build:dotnet-probe: using .NET SDK ${probe.stdout.trim()}`);

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const publish = spawnSync(
  "dotnet",
  ["publish", projectPath, "-c", "Release", "-o", outputDir, "--nologo"],
  { stdio: "inherit" },
);
if (publish.status !== 0) {
  console.error("build:dotnet-probe: dotnet publish failed");
  process.exit(1);
}

const entry = join(outputDir, "OttoDotnetProbe.dll");
if (!existsSync(entry)) {
  console.error(`build:dotnet-probe: publish produced no ${entry}`);
  process.exit(1);
}

const files = readdirSync(outputDir);
const bytes = files.reduce((total, name) => total + statSync(join(outputDir, name)).size, 0);
console.log(
  `build:dotnet-probe: ${files.length} files, ${Math.round(bytes / 1024)} KB -> ${outputDir}`,
);

if (existsSync(join(repoRoot, "packages", "server", "dist"))) {
  rmSync(serverCopyDir, { recursive: true, force: true });
  cpSync(outputDir, serverCopyDir, { recursive: true });
  console.log(`build:dotnet-probe: copied into ${serverCopyDir}`);
}

#!/usr/bin/env node
/**
 * Builds the .NET solution sidecar into a portable, framework-dependent payload.
 *
 * There is deliberately no per-RID matrix here and no NuGet restore at run time: the output is
 * IL, so the same handful of files runs on Windows, macOS and Linux, and a machine that is
 * offline or locked down never has to fetch anything to use the feature. That is the whole
 * shipping decision - build once, ship everywhere.
 *
 * `dotnet` is required to *build* the payload, not to consume it. `build:server` and
 * `build:server:clean` both end by running this script, because they wipe the directory the
 * payload is copied into and nothing else puts it back. A contributor without the .NET SDK still
 * gets a working repo: the SDK probe below exits 0, they simply have no Solution view, and the
 * daemon reports the payload as absent so the switcher never appears. Pass `--required` to turn a
 * missing SDK into a failure instead - for a release runner that must not ship without the
 * sidecar. Nothing passes it today.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  PROBE_BUILD_DIR,
  PROBE_ENTRY_FILE,
  PROBE_PROJECT_PATH,
  SERVER_DIST_DIR,
  SERVER_PAYLOAD_DIR,
} from "./dotnet-probe-paths.mjs";

const projectPath = PROBE_PROJECT_PATH;
const outputDir = PROBE_BUILD_DIR;
/**
 * The published-package location. `bootstrap.ts` looks here first when the daemon runs from an
 * installed tarball rather than from the repo.
 *
 * Both this and the daemon's side of it come from `dotnet-probe-paths.mjs` rather than being
 * written out here. They were two hand-written literals once and they drifted, so the daemon
 * spent its life probing a directory nothing had ever written. `bootstrap.test.ts` imports the
 * same constants and pins the two together.
 */
const serverCopyDir = SERVER_PAYLOAD_DIR;

const required = process.argv.includes("--required");

function fail(message) {
  console.error(`build:dotnet-probe: ${message}`);
  process.exit(required ? 1 : 0);
}

const probe = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
if (probe.status !== 0) {
  fail(
    "no .NET SDK on PATH - skipping the solution sidecar (the Solution view will be unavailable)",
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

const entry = join(outputDir, PROBE_ENTRY_FILE);
if (!existsSync(entry)) {
  console.error(`build:dotnet-probe: publish produced no ${entry}`);
  process.exit(1);
}

const files = readdirSync(outputDir);
const bytes = files.reduce((total, name) => total + statSync(join(outputDir, name)).size, 0);
console.log(
  `build:dotnet-probe: ${files.length} files, ${Math.round(bytes / 1024)} KB -> ${outputDir}`,
);

if (existsSync(SERVER_DIST_DIR)) {
  rmSync(serverCopyDir, { recursive: true, force: true });
  cpSync(outputDir, serverCopyDir, { recursive: true });
  console.log(`build:dotnet-probe: copied into ${serverCopyDir}`);
}

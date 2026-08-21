// Metro resolves `@otto-code/protocol/*`, `@otto-code/client`, and
// `@otto-code/highlight` through each package's compiled `dist`. Metro snapshots
// its file map at startup, so a dev session that boots while a `dist` is missing
// or stale fails with "Unable to resolve @otto-code/protocol/<module>" and keeps
// failing even after the watcher rebuilds it. Build the app's workspace
// dependencies before Metro starts; skip the build when every dist is newer than
// its sources so warm starts stay instant.
import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["protocol", "client", "highlight"];

function newestModifiedTime(directory, matches) {
  let newest = -Infinity;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestModifiedTime(entryPath, matches));
      continue;
    }
    if (!matches(entry.name)) continue;
    newest = Math.max(newest, statSync(entryPath).mtimeMs);
  }
  return newest;
}

const isSource = (name) =>
  (name.endsWith(".ts") || name.endsWith(".tsx")) &&
  !name.endsWith(".d.ts") &&
  !/\.(test|spec)\.tsx?$/.test(name);
const isOutput = (name) => name.endsWith(".js");

const stale = packages.filter((name) => {
  const packageRoot = join(repoRoot, "packages", name);
  const newestSource = newestModifiedTime(join(packageRoot, "src"), isSource);
  const newestOutput = newestModifiedTime(join(packageRoot, "dist"), isOutput);
  return newestOutput === -Infinity || newestSource > newestOutput;
});

if (stale.length === 0) {
  process.exit(0);
}

console.log(`Building app dependencies (stale: ${stale.join(", ")})...`);
const result = spawnSync("npm", ["run", "build:app-deps"], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);

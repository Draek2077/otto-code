// Publishes Otto's npm packages. Run by .github/workflows/npm-publish.yml on a
// release tag, through npm trusted publishing; never a local release step.
//
// Each workspace is packed as Paseo's source names it (`@getpaseo/*`), unpacked,
// renamed to Otto's npm name (`@otto-code/*`) by scripts/otto/npm-rename.mjs,
// repacked, and the renamed tarball is what gets published. See
// docs/otto-release.md.
//
//   node scripts/publish-release-packages.mjs              publish (CI)
//   node scripts/publish-release-packages.mjs --dry-run    pack, rename, npm publish --dry-run
//   node scripts/publish-release-packages.mjs --pack-only [--out <dir>] [--ignore-scripts]
//                                                          pack and rename only (CI check, Docker)

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";
import { rewritePackedTree, toOttoPackageName } from "./otto/npm-rename.mjs";
import { npmCommand } from "./otto/npm-command.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Dependency order: each package publishes after everything it imports.
// expo-two-way-audio is not here: nothing published depends on it, Otto has
// never published it, and npm trusted publishing cannot create a new package.
export const RELEASE_WORKSPACES = [
  { workspace: "@getpaseo/highlight", directory: "packages/highlight" },
  { workspace: "@getpaseo/relay", directory: "packages/relay" },
  { workspace: "@getpaseo/protocol", directory: "packages/protocol" },
  { workspace: "@getpaseo/client", directory: "packages/client" },
  { workspace: "@getpaseo/plugin", directory: "packages/plugin" },
  { workspace: "@getpaseo/server", directory: "packages/server" },
  { workspace: "@getpaseo/cli", directory: "packages/cli" },
];

export const RELEASE_PACKAGES = RELEASE_WORKSPACES.map(({ workspace }) =>
  toOttoPackageName(workspace),
);

export function distTagFor(version) {
  return version.includes("-") ? "beta" : "latest";
}

// npm refuses to republish a version, so a rerun after a partial publish skips what landed.
export function planPublish({ version, isPublished }) {
  const tag = distTagFor(version);
  return RELEASE_WORKSPACES.map(({ workspace, directory }) => {
    const name = toOttoPackageName(workspace);
    return { name, workspace, directory, tag, skip: isPublished(name, version) };
  });
}

function npm(args, options = {}) {
  const invocation = npmCommand(args);
  return spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    cwd: rootDir,
    ...options,
  });
}

function check(result, what) {
  if (result.status !== 0) {
    throw new Error(`${what} failed (exit ${result.status}).\n${result.stderr ?? ""}`);
  }
  return result;
}

function isPublishedOnRegistry(name, version) {
  const result = npm(["view", `${name}@${version}`, "version", "--prefer-online"]);
  if (result.status === 0) return result.stdout.trim() === version;
  // E404 is the only answer that means "not published"; anything else must stop the run.
  if (/E404|404 Not Found/.test(`${result.stdout}${result.stderr}`)) return false;
  throw new Error(`Could not check ${name}@${version} on the registry:\n${result.stderr}`);
}

export function packedFilename(stdout) {
  const parsed = JSON.parse(stdout);
  const entry = Array.isArray(parsed) ? parsed.at(-1) : parsed;
  if (!entry?.filename) throw new Error(`npm pack printed no filename:\n${stdout}`);
  // npm reports scoped names as "getpaseo-cli-1.0.0.tgz"; keep only the basename.
  return path.basename(entry.filename.replace(/^@/, "").replace("/", "-"));
}

/**
 * Packs one workspace and returns the path of its renamed tarball. tar runs
 * with relative paths from its own directory so GNU tar on Windows never reads
 * a drive letter as a remote host.
 */
export function packRenamed({ workspace, directory }, { workDir, outDir, ignoreScripts, license }) {
  const stage = path.join(workDir, workspace.replace("@", "").replace("/", "-"));
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  const packArgs = ["pack", `--workspace=${workspace}`, "--pack-destination", stage, "--json"];
  if (ignoreScripts) packArgs.push("--ignore-scripts");
  const raw = packedFilename(check(npm(packArgs), `npm pack ${workspace}`).stdout);

  check(spawnSync("tar", ["-xzf", raw], { cwd: stage, encoding: "utf8" }), `unpacking ${raw}`);
  rmSync(path.join(stage, raw));
  const packageDir = path.join(stage, "package");
  const result = rewritePackedTree(packageDir, { directory, license });
  console.log(
    `${toOttoPackageName(workspace)}: renamed ${result.renamed} reference(s) in ` +
      `${result.changedFiles.length} file(s), kept ${result.preserved} plugin SDK literal(s)`,
  );

  mkdirSync(outDir, { recursive: true });
  const repacked = packedFilename(
    check(
      npm(["pack", packageDir, "--pack-destination", outDir, "--ignore-scripts", "--json"]),
      `npm pack ${toOttoPackageName(workspace)}`,
    ).stdout,
  );
  return path.join(outDir, repacked);
}

function parseArgs(argv) {
  const args = { dryRun: false, packOnly: false, ignoreScripts: false, out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--pack-only") args.packOnly = true;
    else if (arg === "--ignore-scripts") args.ignoreScripts = true;
    else if (arg === "--out") {
      args.out = argv[index + 1] ?? "";
      index += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootManifest = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const { version, license } = rootManifest;
  const expectedTag = process.env.RELEASE_TAG;
  if (expectedTag && expectedTag !== `v${version}`) {
    throw new Error(`Tag ${expectedTag} does not match package version ${version}.`);
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "otto-npm-publish-"));
  const outDir = args.out ? path.resolve(args.out) : path.join(workDir, "renamed");
  try {
    const isPublished = args.packOnly ? () => false : isPublishedOnRegistry;
    for (const step of planPublish({ version, isPublished })) {
      if (step.skip) {
        console.log(`${step.name}@${version} is already published; skipping.`);
        continue;
      }
      const tarball = packRenamed(step, {
        workDir,
        outDir,
        ignoreScripts: args.ignoreScripts,
        license,
      });
      if (args.packOnly) {
        console.log(`Packed ${path.basename(tarball)}`);
        continue;
      }
      console.log(`Publishing ${step.name}@${version} with dist-tag ${step.tag}`);
      const publishArgs = ["publish", tarball, "--access", "public", "--tag", step.tag];
      if (args.dryRun) publishArgs.push("--dry-run");
      const result = npm(publishArgs, { stdio: "inherit" });
      if (result.status !== 0) {
        throw new Error(`Publishing ${step.name}@${version} failed; rerun to resume from here.`);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (isMainModule(import.meta.url)) {
  main();
}

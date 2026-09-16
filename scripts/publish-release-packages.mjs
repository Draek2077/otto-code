import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isMainModule } from "./is-main-module.mjs";

// Dependency order: each package publishes after everything it imports.
export const RELEASE_PACKAGES = [
  "@otto-code/highlight",
  "@otto-code/relay",
  "@otto-code/protocol",
  "@otto-code/client",
  "@otto-code/plugin",
  "@otto-code/server",
  "@otto-code/brain",
  "@otto-code/cli",
];

export function distTagFor(version) {
  return version.includes("-") ? "beta" : "latest";
}

// npm refuses to republish a version, so a rerun after a partial publish skips what landed.
export function planPublish({ version, isPublished }) {
  const tag = distTagFor(version);
  return RELEASE_PACKAGES.map((name) => ({
    name,
    tag,
    skip: isPublished(name, version),
  }));
}

function npm(args, options = {}) {
  return spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    shell: process.platform === "win32",
    encoding: "utf8",
    ...options,
  });
}

function isPublishedOnRegistry(name, version) {
  const result = npm(["view", `${name}@${version}`, "version", "--prefer-online"]);
  if (result.status === 0) return result.stdout.trim() === version;
  // E404 is the only answer that means "not published"; anything else must stop the run.
  if (/E404|404 Not Found/.test(`${result.stdout}${result.stderr}`)) return false;
  throw new Error(`Could not check ${name}@${version} on the registry:\n${result.stderr}`);
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const expectedTag = process.env.RELEASE_TAG;
  if (expectedTag && expectedTag !== `v${version}`) {
    throw new Error(`Tag ${expectedTag} does not match package version ${version}.`);
  }
  for (const step of planPublish({ version, isPublished: isPublishedOnRegistry })) {
    if (step.skip) {
      console.log(`${step.name}@${version} is already published; skipping.`);
      continue;
    }
    console.log(`Publishing ${step.name}@${version} with dist-tag ${step.tag}`);
    const args = ["publish", `--workspace=${step.name}`, "--access", "public", "--tag", step.tag];
    if (dryRun) args.push("--dry-run");
    const result = npm(args, { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`Publishing ${step.name}@${version} failed; rerun to resume from here.`);
    }
  }
}

if (isMainModule(import.meta.url)) {
  main();
}

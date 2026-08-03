import { execFileSync } from "node:child_process";

/**
 * Makes sure a GitHub Release object exists for a tag, in one of two roles.
 *
 * A `v*` tag starts three workflows at once (Desktop Release, Android APK
 * Release, Release Notes Sync) and all three need the release to exist before
 * they can upload into it. They used to solve that by each running "view, then
 * create if missing" inside one repo-wide concurrency group, so the creates
 * would serialize. That fails in a way nothing reports:
 *
 *   GitHub keeps at most ONE pending job per concurrency group. A third job
 *   joining the group cancels the one already waiting. With three members, one
 *   workflow loses its lock job on every release, and because the downstream
 *   jobs gate on `needs.<lock>.result == 'success' || 'skipped'`, a CANCELLED
 *   lock silently skips the whole build. 0.7.3 lost Android, 0.7.5 lost
 *   Android, 0.7.6 lost every desktop platform. Each looked like "nothing ran".
 *
 * So the group is gone and the roles are explicit instead. Exactly one workflow
 * creates for any given tag shape, and the others wait for it:
 *
 *   --mode create   create the release if it is not there yet, then exit
 *   --mode wait     poll until someone else creates it, then exit
 *
 * `create` stays idempotent (a re-run, or a retry tag pointing at a release
 * that already exists, is a no-op) and `wait` fails loudly on timeout rather
 * than letting a build proceed toward an upload that cannot land.
 */

const POLL_INTERVAL_MS = 5_000;

function usageAndExit(code = 1) {
  process.stderr.write(
    "Usage: node scripts/ensure-github-release.mjs --tag <tag> --repo <owner/name> " +
      "--mode <create|wait> [--prerelease] [--timeout-seconds <n>]\n",
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    tag: "",
    repo: "",
    mode: "",
    prerelease: false,
    timeoutSeconds: 600,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tag") {
      args.tag = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--repo") {
      args.repo = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      args.mode = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--timeout-seconds") {
      args.timeoutSeconds = Number(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--prerelease") {
      args.prerelease = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usageAndExit(0);
    }
    usageAndExit();
  }

  if (!args.tag || !args.repo) {
    usageAndExit();
  }
  if (args.mode !== "create" && args.mode !== "wait") {
    usageAndExit();
  }
  if (!Number.isFinite(args.timeoutSeconds) || args.timeoutSeconds <= 0) {
    usageAndExit();
  }

  return args;
}

function releaseExists(tag, repo) {
  try {
    execFileSync("gh", ["release", "view", tag, "--repo", repo], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function createRelease(tag, repo, prerelease) {
  const createArgs = [
    "release",
    "create",
    tag,
    "--repo",
    repo,
    "--title",
    `Otto ${tag}`,
    "--notes",
    "",
  ];
  if (prerelease) {
    createArgs.push("--prerelease");
  }
  execFileSync("gh", createArgs, { stdio: "inherit" });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const args = parseArgs(process.argv.slice(2));

if (args.mode === "create") {
  if (releaseExists(args.tag, args.repo)) {
    console.log(`Release ${args.tag} already exists, nothing to create`);
    process.exit(0);
  }

  try {
    createRelease(args.tag, args.repo, args.prerelease);
    console.log(`Created release ${args.tag}`);
  } catch (error) {
    // Only one workflow is supposed to create a given tag, so a failure here is
    // real. Re-check anyway: if the release turned up, whatever went wrong did
    // not cost us the release, and failing the job would strand the build.
    if (releaseExists(args.tag, args.repo)) {
      console.log(`Release ${args.tag} exists despite a failed create, continuing`);
      process.exit(0);
    }
    throw error;
  }
  process.exit(0);
}

const deadline = Date.now() + args.timeoutSeconds * 1000;
let attempts = 0;

while (Date.now() < deadline) {
  attempts += 1;
  if (releaseExists(args.tag, args.repo)) {
    console.log(`Release ${args.tag} is present after ${attempts} check(s)`);
    process.exit(0);
  }
  await sleep(POLL_INTERVAL_MS);
}

process.stderr.write(
  `Release ${args.tag} did not appear within ${args.timeoutSeconds}s. ` +
    "The workflow that creates it (Desktop Release for a v* tag) either failed or never ran.\n",
);
process.exit(1);

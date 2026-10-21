import { execFileSync as nodeExecFileSync } from "node:child_process";
import { getGitHubRelease } from "./github-release.mjs";
import { isMainModule } from "./is-main-module.mjs";

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
      "--mode <create|wait> [--draft] [--prerelease] [--timeout-seconds <n>]\n",
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    tag: "",
    repo: "",
    mode: "",
    draft: false,
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
    if (arg === "--draft") {
      args.draft = true;
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

function createRelease(tag, repo, { draft, prerelease }, execFileSync) {
  const args = ["release", "create", tag, "--repo", repo, "--title", `Otto ${tag}`, "--notes", ""];
  if (prerelease) args.push("--prerelease");
  if (draft) args.push("--draft");
  execFileSync("gh", args, { stdio: "inherit" });
}

export async function ensureGitHubRelease(
  args,
  {
    execFileSync = nodeExecFileSync,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.log,
  } = {},
) {
  const exists = () => getGitHubRelease(args.repo, args.tag, execFileSync) !== null;
  if (args.mode === "create") {
    if (exists()) {
      log(`Release ${args.tag} already exists, nothing to create`);
      return;
    }
    try {
      createRelease(args.tag, args.repo, args, execFileSync);
      log(`Created release ${args.tag}`);
    } catch (error) {
      if (exists()) {
        log(`Release ${args.tag} exists despite a failed create, continuing`);
        return;
      }
      throw error;
    }
    return;
  }
  const deadline = now() + args.timeoutSeconds * 1000;
  let attempts = 0;
  while (now() < deadline) {
    attempts += 1;
    if (exists()) {
      log(`Release ${args.tag} is present after ${attempts} check(s)`);
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Release ${args.tag} did not appear within ${args.timeoutSeconds}s. ` +
      "The workflow that creates it (Desktop Release for a v* tag) either failed or never ran.",
  );
}

if (isMainModule(import.meta.url)) {
  await ensureGitHubRelease(parseArgs(process.argv.slice(2)));
}

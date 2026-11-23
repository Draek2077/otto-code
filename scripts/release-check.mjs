#!/usr/bin/env node
// Release gate. CI's typecheck job already does a clean install, builds every
// published package, typechecks all workspaces, and packs and renames the eight
// @otto-code packages; CI's quality job checks formatting, lint, and the
// lockfile; npm Publish then rebuilds from the tag. Rebuilding all of that
// locally before tagging only repeated CI. Instead, confirm CI's gate jobs
// passed on the code being released.
//
// "The code being released" is the newest commit in HEAD that changes anything
// other than documentation. Docs-only commits on top of it (the changelog commit
// in particular) are allowed: they cannot change what gets built. Runs on those
// docs-only descendants count too, since GitHub replaces a queued run when a newer
// push to main arrives, and every one of them builds the same code.
//
// `npm run release:check:local` is the old full local build, for when CI cannot
// vouch for the commit (gh unavailable, or you need to release without waiting).

import { execFileSync } from "node:child_process";

const REPO = "Draek2077/otto-code";
const WORKFLOW = "CI";
// Paseo's CI runs format and lint inside `quality`.
const GATE_JOBS = ["quality", "typecheck"];
const POLL_MS = 20_000;
const WAIT_LIMIT_MS = 25 * 60_000;

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(`\nrelease:check failed: ${message}`);
  console.error("To build and check locally instead: npm run release:check:local");
  process.exit(1);
}

function isDocsOnlyPath(path) {
  return (
    path.endsWith(".md") ||
    path.startsWith("docs/") ||
    path.startsWith("public-docs/") ||
    path.startsWith(".otto/knowledge/")
  );
}

function changedPaths(sha) {
  const parents = run("git", ["rev-list", "--parents", "-n", "1", sha]).split(" ").slice(1);
  // A merge can bring in code from either side; never treat one as docs-only.
  if (parents.length !== 1) return null;
  return run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", sha])
    .split("\n")
    .filter(Boolean);
}

/** The newest code-changing commit, plus the docs-only commits above it. */
function findReleaseCode() {
  const docsOnly = [];
  for (const sha of run("git", ["rev-list", "HEAD"]).split("\n")) {
    const paths = changedPaths(sha);
    if (paths && paths.length > 0 && paths.every(isDocsOnlyPath)) {
      docsOnly.push(sha);
      continue;
    }
    return { codeSha: sha, docsOnly };
  }
  fail("could not find a code-changing commit in HEAD's history.");
}

function isOnOriginMain(sha) {
  try {
    run("git", ["merge-base", "--is-ancestor", sha, "origin/main"]);
    return true;
  } catch {
    return false;
  }
}

function gateStatus(sha) {
  const runs = JSON.parse(
    run("gh", [
      "run",
      "list",
      "--repo",
      REPO,
      "--workflow",
      WORKFLOW,
      "--commit",
      sha,
      "--event",
      "push",
      "--json",
      "databaseId,url",
    ]),
  );
  const statuses = [];
  for (const { databaseId, url } of runs) {
    const { jobs } = JSON.parse(
      run("gh", ["run", "view", String(databaseId), "--repo", REPO, "--json", "jobs"]),
    );
    const gate = GATE_JOBS.map((name) => jobs.find((job) => job.name === name) ?? { name });
    statuses.push({ sha, url, gate });
  }
  return statuses;
}

function summarize({ gate }) {
  if (gate.every((job) => job.conclusion === "success")) return "passed";
  if (gate.some((job) => job.status === "completed" && job.conclusion !== "success")) {
    // A cancelled job means the run was superseded, not that the code failed.
    if (gate.every((job) => job.conclusion === "success" || job.conclusion === "cancelled")) {
      return "cancelled";
    }
    return "failed";
  }
  return "pending";
}

async function main() {
  if (run("git", ["status", "--porcelain"])) {
    fail("the working tree has uncommitted changes. Commit or stash them first.");
  }
  run("git", ["fetch", "origin", "main", "--quiet"]);

  const { codeSha, docsOnly } = findReleaseCode();
  const short = codeSha.slice(0, 9);
  if (!isOnOriginMain(codeSha)) {
    fail(
      `commit ${short} changes code and is not on origin/main, so CI has not checked it. ` +
        "Push it (git push), then rerun; this check waits for CI's gate jobs.",
    );
  }

  const candidates = [codeSha, ...docsOnly.filter(isOnOriginMain)];
  console.log(
    `Release code is ${short}${docsOnly.length ? ` (+${docsOnly.length} docs-only commit(s) above it)` : ""}.`,
  );
  console.log(`Waiting for CI ${GATE_JOBS.join(", ")} to pass on it...`);

  const deadline = Date.now() + WAIT_LIMIT_MS;
  let reported = "";
  for (;;) {
    let statuses;
    try {
      statuses = candidates.flatMap(gateStatus);
    } catch (error) {
      fail(`could not read CI status with gh (${error.message.split("\n")[0]}).`);
    }
    const passed = statuses.find((status) => summarize(status) === "passed");
    if (passed) {
      console.log(`CI ${GATE_JOBS.join(", ")} passed on ${passed.sha.slice(0, 9)}: ${passed.url}`);
      return;
    }
    const failed = statuses.find((status) => summarize(status) === "failed");
    if (failed) {
      const jobs = failed.gate
        .filter((job) => job.conclusion && job.conclusion !== "success")
        .map((job) => `${job.name} (${job.conclusion})`);
      fail(`CI ${jobs.join(", ")} on ${failed.sha.slice(0, 9)}. Fix main first: ${failed.url}`);
    }
    if (statuses.length > 0 && statuses.every((status) => summarize(status) === "cancelled")) {
      fail(
        `every CI run on ${short} and its docs-only descendants was cancelled. ` +
          "Re-run CI for it (gh run rerun) or push again, then rerun this check.",
      );
    }
    if (Date.now() > deadline) {
      fail(`CI gate jobs did not finish within ${WAIT_LIMIT_MS / 60_000} minutes.`);
    }
    const state = statuses.length === 0 ? "no CI run yet" : "gate jobs still running";
    if (state !== reported) {
      console.log(`  ${state}; checking every ${POLL_MS / 1000}s`);
      reported = state;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

await main();

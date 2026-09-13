import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  getCheckoutRefDerivedState,
  getCheckoutShortstat,
  getCheckoutSnapshotFacts,
  getCheckoutStatus,
  type CheckoutSnapshotFacts,
} from "./checkout-git.js";

let cwd: string;
let firstFeatureCommit: string;
function git(...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

beforeEach(() => {
  const scratch = join(
    fileURLToPath(new URL("../../../../.tmp/", import.meta.url)),
    "checkout-ref-policy",
  );
  mkdirSync(scratch, { recursive: true });
  cwd = mkdtempSync(join(scratch, "repo-"));
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "base.txt"), "base\n");
  git("add", ".");
  git("commit", "-m", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("checkout", "-b", "feature");
  writeFileSync(join(cwd, "feature.txt"), "first\n");
  git("add", ".");
  git("commit", "-m", "first feature change");
  firstFeatureCommit = git("rev-parse", "HEAD");
  writeFileSync(join(cwd, "feature.txt"), "first\nsecond\n");
  git("add", ".");
  git("commit", "-m", "second feature change");
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function factsWithBase(
  base: string,
): Promise<Extract<CheckoutSnapshotFacts, { isGit: true }>> {
  const facts = await getCheckoutSnapshotFacts(cwd, { ottoHome: join(cwd, ".otto-home") });
  if (!facts.isGit) throw new Error("Fixture must be a git repository");
  return {
    ...facts,
    storedBaseRef: base,
    resolvedBaseRef: base,
    comparisonBaseRef: base,
    baseSource: "user",
  };
}

test("a moved origin candidate reselects the later fork point from cached local-base facts", async () => {
  const facts = await factsWithBase("main");
  const context = { facts, ottoHome: join(cwd, ".otto-home") };
  const status = await getCheckoutStatus(cwd, context);
  if (!status.isGit) throw new Error("Fixture must be a git repository");
  const current = {
    aheadBehind: status.aheadBehind,
    diffStat: await getCheckoutShortstat(cwd, context, { force: true }),
  };
  expect(current).toEqual({
    aheadBehind: { ahead: 2, behind: 0 },
    diffStat: { additions: 2, deletions: 0 },
  });

  git("update-ref", "refs/remotes/origin/main", firstFeatureCommit);
  const derived = await getCheckoutRefDerivedState(
    cwd,
    facts,
    current,
    new Set(["refs/remotes/origin/main"]),
    context,
  );
  expect(derived).toMatchObject({
    comparisonBaseRef: "origin/main",
    aheadBehind: { ahead: 1, behind: 0 },
    diffStat: { additions: 1, deletions: 0 },
  });
  // The narrow read must not mutate the structural snapshot held by other readers.
  expect(facts.comparisonBaseRef).toBe("main");
});

test("an explicitly pinned local base remains pinned when origin advances", async () => {
  const facts = await factsWithBase("refs/heads/main");
  const current = {
    aheadBehind: { ahead: 2, behind: 0 },
    diffStat: { additions: 2, deletions: 0 },
  };
  git("update-ref", "refs/remotes/origin/main", firstFeatureCommit);
  const derived = await getCheckoutRefDerivedState(cwd, facts, current, new Set(["origin/main"]), {
    facts,
  });
  expect(derived).toEqual({ ...current, upstreamStatus: facts.upstreamStatus });
});

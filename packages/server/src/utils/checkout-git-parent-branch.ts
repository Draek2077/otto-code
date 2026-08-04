import type { Logger } from "pino";
import { runGitCommand } from "./run-git-command.js";

const READ_ONLY_GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
} as const;

/**
 * How many branches are considered as possible parents.
 *
 * Each candidate costs a `git merge-base` subprocess, so this is the one knob that keeps the
 * scan affordable. It is only affordable at all because the result is *sticky*: inference runs
 * once per branch and is then remembered, so a repo with hundreds of branches pays this once
 * rather than on every render of the Changes view.
 */
const MAX_PARENT_CANDIDATES = 50;

/**
 * How many `git merge-base` probes run at once.
 *
 * Kept modest on purpose: this runs on a background snapshot refresh, and the point is to stop the
 * scan taking seconds, not to saturate the machine while the user is working in the same repo.
 */
const MERGE_BASE_CONCURRENCY = 8;

/** Runs `worker` over `items` with at most `limit` in flight, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface InferParentBranchOptions {
  currentBranch: string;
  /** Repository default branch, used only to break ties deterministically. */
  defaultBranch: string | null;
  logger?: Logger;
}

interface ParentCandidate {
  ref: string;
  forkPoint: string;
}

/**
 * Infers which branch the current branch forked from.
 *
 * **Git does not record a branch's parent.** There is no field to read; the answer has to be
 * reconstructed from the commit graph, and it is a heuristic. That is worth stating plainly
 * because it shapes everything around this function: the result is written down once and shown
 * to the user with its provenance, so a wrong guess is visible and correctable rather than a
 * silent, permanently wrong diff.
 *
 * The rule is the one the Changes view already uses for `<name>` vs `origin/<name>`: among the
 * candidates, take the one whose merge-base with HEAD is the **latest** commit. That merge-base
 * is the nearest branch point, so the fewest commits the branch did not author can leak in.
 *
 * Returns `null` when nothing plausibly forks - an orphan branch, a single-branch repo, or the
 * default branch itself - and the caller falls back to the repository default.
 */
export async function inferParentBranchRef(
  cwd: string,
  options: InferParentBranchOptions,
): Promise<string | null> {
  const { currentBranch, defaultBranch, logger } = options;
  if (!currentBranch || currentBranch === "HEAD") {
    return null;
  }

  // The default branch does not fork from anything, and asking anyway produces a confidently
  // wrong answer. Every branch ever merged into it has a tip that is an ancestor of HEAD, which
  // is graph-identical to a stacked parent - and since the default branch is excluded from its
  // own candidate list, one of those merged branches would always win. Observed on this repo:
  // standing on `main` proposed a long-merged feature branch as main's parent.
  if (defaultBranch && isSameBranch(currentBranch, defaultBranch)) {
    return null;
  }

  const candidateRefs = await listCandidateRefs(cwd, currentBranch, logger);
  if (candidateRefs.length === 0) {
    return null;
  }

  const headSha = await revParse(cwd, "HEAD", logger);
  if (!headSha) {
    return null;
  }

  // One `git merge-base` per candidate, and a git subprocess costs ~60ms on Windows, so running
  // these serially is what makes a 50-branch repo take seconds. They are fully independent, so
  // fan them out with a bounded pool instead.
  const forkPoints = await mapWithConcurrency(candidateRefs, MERGE_BASE_CONCURRENCY, (ref) =>
    tryMergeBase(cwd, "HEAD", ref, logger),
  );

  const candidates: ParentCandidate[] = [];
  for (const [index, ref] of candidateRefs.entries()) {
    const forkPoint = forkPoints[index];
    if (!forkPoint) {
      // Unrelated history - no common ancestor at all, so it cannot be a parent.
      continue;
    }
    // A merge-base equal to HEAD means the candidate *contains* HEAD: it is a child branch, or
    // the same work pushed further along. Diffing against it would show the current branch's own
    // commits inverted, which is never what "vs <base>" means.
    if (forkPoint === headSha) {
      continue;
    }
    candidates.push({ ref, forkPoint });
  }

  if (candidates.length === 0) {
    return null;
  }

  const winner = await pickNearestForkPoint(cwd, candidates, defaultBranch, logger);
  return winner ? preferLocalBranchName(cwd, winner, logger) : null;
}

/** Compares branch names ignoring an `origin/` qualifier on either side. */
function isSameBranch(left: string, right: string): boolean {
  const strip = (name: string) =>
    name.startsWith("origin/") ? name.slice("origin/".length) : name;
  return strip(left) === strip(right);
}

/**
 * Reports `origin/X` as plain `X` when a local branch of that name exists.
 *
 * Detection answers "which branch did this fork from?", and the answer is a *branch*, not a ref.
 * Keeping the qualifier here would be actively wrong twice over: the chip would read "vs
 * origin/main" for someone who simply branched off `main`, and the comparison resolver already
 * chooses between `main` and `origin/main` by fork point, so the qualifier buys nothing.
 *
 * The qualifier survives only when there is no local branch - a parent that exists solely as a
 * remote-tracking ref - and when the user pins one explicitly, which is a separate decision the
 * resolver honours verbatim.
 */
async function preferLocalBranchName(cwd: string, ref: string, logger?: Logger): Promise<string> {
  if (!ref.startsWith("origin/")) {
    return ref;
  }
  const localName = ref.slice("origin/".length);
  if (!localName) {
    return ref;
  }
  const result = await runGitCommand(
    ["show-ref", "--verify", "--quiet", `refs/heads/${localName}`],
    { cwd, envOverlay: READ_ONLY_GIT_ENV, acceptExitCodes: [0, 1], logger },
  );
  return result.exitCode === 0 ? localName : ref;
}

/**
 * Local heads plus origin's remote-tracking refs, most recently committed first.
 *
 * The current branch and its own `origin/` counterpart are excluded: that is the same line of
 * work, not something it forked from.
 */
async function listCandidateRefs(
  cwd: string,
  currentBranch: string,
  logger?: Logger,
): Promise<string[]> {
  const result = await runGitCommand(
    [
      "for-each-ref",
      "--sort=-committerdate",
      `--count=${MAX_PARENT_CANDIDATES}`,
      // Full refnames, not `%(refname:short)`. Git shortens `refs/remotes/origin/HEAD` to the
      // bare remote name `origin`, which then looks like an ordinary branch candidate and wins
      // on merge-base against anything - it is a symbolic ref to the default branch, not a
      // branch of its own. Shortening here instead keeps that case identifiable.
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes/origin",
    ],
    { cwd, envOverlay: READ_ONLY_GIT_ENV, acceptExitCodes: [0, 1], logger },
  );
  if (result.exitCode !== 0) {
    return [];
  }

  const excluded = new Set([currentBranch, `origin/${currentBranch}`]);
  const candidates: string[] = [];
  for (const line of result.stdout.split("\n")) {
    const ref = shortenCandidateRef(line.trim());
    if (ref && !excluded.has(ref)) {
      candidates.push(ref);
    }
  }
  return candidates;
}

/** Returns the short form of a candidate ref, or `null` for refs that are not branches. */
function shortenCandidateRef(refName: string): string | null {
  if (refName === "refs/remotes/origin/HEAD") {
    return null;
  }
  if (refName.startsWith("refs/heads/")) {
    return refName.slice("refs/heads/".length) || null;
  }
  if (refName.startsWith("refs/remotes/")) {
    return refName.slice("refs/remotes/".length) || null;
  }
  return null;
}

/**
 * How many times the fork points are re-scanned looking for a strictly later one.
 *
 * Fork points are all ancestors of HEAD, but ancestors of a commit form a DAG rather than a
 * chain - two of them are incomparable whenever HEAD's history contains a merge. So a single
 * greedy max-scan is not guaranteed to land on a maximal element and its answer depends on the
 * order refs came back in. Re-scanning until nothing moves fixes that for a few subprocess
 * calls; the cap stops a pathological graph from spinning.
 */
const MAX_FORK_POINT_SCANS = 3;

/**
 * The winner is the candidate whose fork point no other candidate's fork point descends from.
 *
 * Ordering is by ancestry rather than by date, because commit timestamps are rebase- and
 * clock-controlled and routinely disagree with topology.
 */
async function pickNearestForkPoint(
  cwd: string,
  candidates: ParentCandidate[],
  defaultBranch: string | null,
  logger?: Logger,
): Promise<string | null> {
  const first = candidates[0];
  if (!first) {
    return null;
  }

  let best = first;
  for (let scan = 0; scan < MAX_FORK_POINT_SCANS; scan += 1) {
    let moved = false;
    for (const candidate of candidates) {
      if (candidate.forkPoint === best.forkPoint) {
        continue;
      }
      // A strictly later fork point wins outright: it is closer to HEAD, so diffing against it
      // drags in fewer commits the branch did not author.
      if (await isAncestor(cwd, best.forkPoint, candidate.forkPoint, logger)) {
        best = candidate;
        moved = true;
      }
    }
    if (!moved) {
      break;
    }
  }

  const bestForkPoint = best.forkPoint;
  const tied = candidates.filter((candidate) => candidate.forkPoint === bestForkPoint);
  if (tied.length <= 1) {
    return best.ref;
  }
  return breakForkPointTie(cwd, tied, best.ref, defaultBranch, logger);
}

/**
 * Several branches fork at the same commit, so the graph genuinely cannot tell them apart.
 * Resolve it the same way every time rather than letting ref enumeration order decide: the
 * repository default branch, then the branch carrying the least unrelated work, then the
 * shortest name.
 */
async function breakForkPointTie(
  cwd: string,
  tied: ParentCandidate[],
  fallbackRef: string,
  defaultBranch: string | null,
  logger?: Logger,
): Promise<string> {
  if (defaultBranch) {
    const preferred = tied.find(
      (candidate) => candidate.ref === defaultBranch || candidate.ref === `origin/${defaultBranch}`,
    );
    if (preferred) {
      return preferred.ref;
    }
  }

  const scored: Array<{ ref: string; ahead: number }> = [];
  for (const candidate of tied) {
    scored.push({
      ref: candidate.ref,
      ahead: await countCommitsAhead(cwd, candidate.forkPoint, candidate.ref, logger),
    });
  }

  scored.sort((a, b) => {
    if (a.ahead !== b.ahead) return a.ahead - b.ahead;
    if (a.ref.length !== b.ref.length) return a.ref.length - b.ref.length;
    return a.ref < b.ref ? -1 : 1;
  });

  return scored[0]?.ref ?? fallbackRef;
}

async function countCommitsAhead(
  cwd: string,
  forkPoint: string,
  ref: string,
  logger?: Logger,
): Promise<number> {
  const result = await runGitCommand(["rev-list", "--count", `${forkPoint}..${ref}`], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 128],
    logger,
  });
  if (result.exitCode !== 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  const parsed = Number.parseInt(result.stdout.trim(), 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

async function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
  logger?: Logger,
): Promise<boolean> {
  const result = await runGitCommand(["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
    logger,
  });
  return result.exitCode === 0;
}

async function tryMergeBase(
  cwd: string,
  left: string,
  right: string,
  logger?: Logger,
): Promise<string | null> {
  const result = await runGitCommand(["merge-base", left, right], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1, 128],
    logger,
  });
  if (result.exitCode !== 0) {
    return null;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : null;
}

async function revParse(cwd: string, ref: string, logger?: Logger): Promise<string | null> {
  const result = await runGitCommand(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    acceptExitCodes: [0, 1],
    logger,
  });
  if (result.exitCode !== 0) {
    return null;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : null;
}

import path from "node:path";

import { run } from "./repo.js";

/**
 * Mine benchmark tasks out of real git history.
 *
 * A commit that changed both source and tests in the same workspace is a
 * candidate task: check out its parent, bring in only the test changes, and the
 * new tests describe a bug that the parent commit still has. The author's own
 * fix is the reference solution and their tests are the oracle - which is the
 * property that makes this worth more than a hand-written prompt.
 *
 * Nothing here reads file contents. Tasks carry SHAs and paths only, so a task
 * set can be shared or version-controlled without exposing private source.
 */

const TEST_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/;

// Commits whose subject suggests a behavioural fix make the best tasks; the
// rest are still usable but ranked below these.
const FIX_HINT = /\b(fix|bug|regression|broken|crash|incorrect|wrong|fail)/i;

export function isTest(file: string): boolean {
  return TEST_PATTERN.test(file);
}

export function isSource(file: string): boolean {
  return SOURCE_PATTERN.test(file) && !isTest(file);
}

/** One commit parsed out of `git log`. */
interface Commit {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

/** Options for {@link mine}. */
export interface MineOptions {
  dir: string;
  workspaceDir: string;
  limit?: number;
  maxFiles?: number;
  since?: string | null;
  ref?: string;
}

/** A benchmark task mined from a fix commit. */
export interface MinedTask {
  id: string;
  workspaceDir: string;
  fix: string;
  parent: string;
  date: string;
  subject: string;
  testPaths: string[];
  sourcePaths: string[];
  looksLikeFix: boolean;
}

/**
 * @param {object} options
 * @param {string} options.dir           repo working copy
 * @param {string} options.workspaceDir  e.g. "packages/protocol"
 * @param {number} options.limit         how many commits of history to scan
 * @param {number} options.maxFiles      skip sprawling commits; they make poor tasks
 */
export async function mine({
  dir,
  workspaceDir,
  limit = 2000,
  maxFiles = 12,
  since = null,
  ref = "origin/main",
}: MineOptions): Promise<MinedTask[]> {
  // Mine from a fixed ref, never HEAD: the harness moves HEAD around between
  // tasks, and a HEAD parked on some parent commit makes every descendant
  // unreachable - silently shrinking the task set instead of failing loudly.
  const logArgs = [
    "log",
    ref,
    `--max-count=${limit}`,
    "--format=%H%x00%an%x00%ad%x00%s",
    "--date=short",
  ];
  if (since) logArgs.push(`--since=${since}`);
  logArgs.push("--", workspaceDir);

  const log = await run("git", logArgs, { cwd: dir, timeout: 120_000 });
  if (!log.ok) throw new Error(`git log failed: ${log.stderr.trim()}`);

  const commits: Commit[] = log.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, author, date, subject] = line.split("\0");
      return { sha, author, date, subject };
    });

  const candidates: MinedTask[] = [];
  for (const commit of commits) {
    const show = await run(
      "git",
      ["show", "--name-only", "--format=", "--no-renames", commit.sha, "--", workspaceDir],
      { cwd: dir, timeout: 30_000 },
    );
    if (!show.ok) continue;

    const files = show.stdout
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
    if (!files.length || files.length > maxFiles) continue;

    const testPaths = files.filter(isTest);
    const sourcePaths = files.filter(isSource);
    if (!testPaths.length || !sourcePaths.length) continue;

    // A commit with no parent (or a merge) cannot define a clean "before" state.
    const parents = await run("git", ["rev-list", "--parents", "-n", "1", commit.sha], {
      cwd: dir,
      timeout: 15_000,
    });
    const parts = parents.stdout.trim().split(/\s+/);
    if (parts.length !== 2) continue; // 0 parents (root) or >1 (merge)

    candidates.push({
      id: `${path.basename(workspaceDir)}-${commit.sha.slice(0, 8)}`,
      workspaceDir,
      fix: commit.sha,
      parent: parts[1],
      date: commit.date,
      subject: commit.subject,
      testPaths,
      sourcePaths,
      looksLikeFix: FIX_HINT.test(commit.subject),
    });
  }

  // Fix-shaped commits first, then smaller diffs - both correlate with tasks
  // that have a crisp, checkable outcome.
  candidates.sort((a, b) => {
    if (a.looksLikeFix !== b.looksLikeFix) return a.looksLikeFix ? -1 : 1;
    return a.sourcePaths.length + a.testPaths.length - (b.sourcePaths.length + b.testPaths.length);
  });

  return candidates;
}

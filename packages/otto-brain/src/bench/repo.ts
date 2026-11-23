import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { commandPlan } from "./command.js";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "../config/private-files.js";

/**
 * Repository control for SWE-bench-style tasks.
 *
 * One working copy is reused for every task rather than re-cloning: reset the
 * tracked files, keep the ignored ones. That is deliberate and cheap -
 * `git clean -fd` (crucially WITHOUT -x) removes the model's stray files while
 * preserving node_modules and dist. Measured on otto-code: reset under a
 * second, warm install 1.7s, build 6.1s, full protocol suite 4.3s.
 *
 * Tasks therefore serialise on the working copy, which costs nothing real:
 * only one model fits in VRAM at a time, so they were already serialised.
 */

const DEFAULT_TIMEOUT = 300_000;

/** Outcome of running a child process. */
export interface RunResult {
  ok: boolean;
  code: number | string;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export function run(
  command: string,
  args: string[],
  { cwd, timeout = DEFAULT_TIMEOUT, env, signal }: RunOptions = {},
): Promise<RunResult> {
  signal?.throwIfAborted();
  const plan = commandPlan(command, args, env ?? process.env);
  return new Promise((resolve, reject) => {
    execFile(
      plan.command,
      plan.args,
      {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: plan.env,
        signal,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        resolve({
          ok: !error,
          code: error?.code ?? 0,
          timedOut: Boolean(error?.killed),
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

interface RepoOptions {
  dir: string;
  workspace: string;
  workspaceDir: string;
  env?: NodeJS.ProcessEnv;
  ownedRoot?: string;
}

/** One failing test file that could not even be imported. */
export interface FileFailure {
  file: string;
  message: string;
}

/** Aggregate pass/fail counts from a vitest report. */
export interface VitestTotals {
  total: number;
  passed: number;
  failed: number;
}

/** Pass/fail sets parsed out of a vitest JSON report. */
export interface ParsedVitest {
  passed: Set<string>;
  failed: Set<string>;
  fileFailures: FileFailure[];
  totals: VitestTotals;
}

/** Result of running a workspace test suite. */
export interface TestResult {
  ok: boolean;
  parsed: boolean;
  passed: Set<string>;
  failed: Set<string>;
  fileFailures: FileFailure[];
  totals?: VitestTotals;
  error?: string;
}

/** A single vitest assertion result. */
interface VitestAssertion {
  fullName: string;
  status: string;
}

/** A vitest suite (one test file) in the JSON report. */
interface VitestSuite {
  name?: string;
  status?: string;
  message?: string;
  assertionResults?: VitestAssertion[];
}

/** The subset of the vitest JSON report we read. */
interface VitestReport {
  testResults?: VitestSuite[];
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
}

export class Repo {
  dir: string;
  workspace: string;
  workspaceDir: string;
  lastLockHash: string | null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly ownedRoot?: string;

  /**
   * @param {object} options
   * @param {string} options.dir           working copy
   * @param {string} options.workspace     npm workspace name, e.g. @otto-code/protocol
   * @param {string} options.workspaceDir  its path relative to dir
   */
  constructor({ dir, workspace, workspaceDir, env = process.env, ownedRoot }: RepoOptions) {
    this.dir = path.resolve(dir);
    this.workspace = workspace;
    this.workspaceDir = workspaceDir;
    this.lastLockHash = null;
    this.env = env;
    this.ownedRoot = ownedRoot;
    const relative = path.relative(this.dir, path.resolve(this.dir, workspaceDir));
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Benchmark workspace must be inside its checkout");
  }

  git(args: string[], options: Partial<RunOptions> = {}): Promise<RunResult> {
    return run("git", args, { cwd: this.dir, env: this.env, ...options });
  }

  /** Discard all local modifications and untracked files, keeping ignored ones. */
  async reset(sha: string, signal?: AbortSignal): Promise<boolean> {
    assertOwnedCheckout(this.dir, this.ownedRoot);
    if (!/^[a-f0-9]{40,64}$/iu.test(sha))
      throw new Error("Benchmark reset requires a commit identity");
    const hard = await this.git(["reset", "--hard", sha], { signal });
    if (!hard.ok) throw new Error(`git reset --hard ${sha} failed: ${hard.stderr.trim()}`);
    // No -x: node_modules and dist are ignored and must survive.
    const clean = await this.git(["clean", "-fd"], { signal });
    if (!clean.ok) throw new Error(`git clean failed: ${clean.stderr.trim()}`);
    return true;
  }

  /** Bring specific paths in from another commit - used to apply the oracle. */
  async checkoutPaths(sha: string, paths: string[], signal?: AbortSignal): Promise<boolean> {
    assertOwnedCheckout(this.dir, this.ownedRoot);
    if (!/^[a-f0-9]{40,64}$/iu.test(sha))
      throw new Error("Benchmark oracle requires a commit identity");
    if (!paths.length) return true;
    const result = await this.git(["checkout", sha, "--", ...paths], { signal });
    if (!result.ok)
      throw new Error(`git checkout ${sha} -- <paths> failed: ${result.stderr.trim()}`);
    return true;
  }

  async headSha(): Promise<string> {
    const result = await this.git(["rev-parse", "HEAD"]);
    return result.stdout.trim();
  }

  /**
   * Install only when the lockfile actually changed since the last install.
   * Across neighbouring commits this is almost always a no-op.
   */
  async ensureDependencies(signal?: AbortSignal): Promise<{ installed: boolean }> {
    assertOwnedCheckout(this.dir, this.ownedRoot);
    const lock = path.join(this.dir, "package-lock.json");
    let hash = "none";
    try {
      hash = crypto.createHash("sha1").update(fs.readFileSync(lock)).digest("hex");
    } catch {
      /* no lockfile: fall through and install once */
    }
    if (hash === this.lastLockHash) return { installed: false };

    // --ignore-scripts: the root `prepare` hook runs lefthook (git hooks),
    // which fails here and is not wanted in a benchmark harness anyway.
    const result = await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: this.dir,
      timeout: 900_000,
      env: this.env,
      signal,
    });
    if (!result.ok) {
      throw new Error(`npm install failed: ${(result.stderr || result.stdout).slice(-500)}`);
    }
    this.lastLockHash = hash;
    return { installed: true };
  }

  /**
   * Build the workspace. Required, not optional: some tests import through the
   * package's own `exports` map into dist/, and fail at import time otherwise.
   */
  async build(signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
    assertOwnedCheckout(this.dir, this.ownedRoot);
    const result = await run("npm", ["run", "build", "--workspace", this.workspace], {
      cwd: this.dir,
      timeout: 600_000,
      env: this.env,
      signal,
    });
    return {
      ok: result.ok,
      output: (result.stderr || result.stdout).slice(-2000),
    };
  }

  /**
   * Run the workspace test suite and return per-test outcomes.
   *
   * `files` restricts the run to those test paths (passed to vitest as filters).
   * The SWE-bench oracle only ever scores its own test files, so scoping to them
   * avoids running the whole workspace suite - faster, and it keeps the harness
   * within the "never run the full suite" rule.
   *
   * vitest's --outputFile needs a native path; a POSIX-style /tmp path silently
   * produces no file on Windows.
   */
  async test({
    timeout = 600_000,
    files,
    signal,
  }: { timeout?: number; files?: string[]; signal?: AbortSignal } = {}): Promise<TestResult> {
    assertOwnedCheckout(this.dir, this.ownedRoot);
    if (!files?.length) throw new Error("Benchmark tests require explicit oracle file filters");
    const outFile = path.join(this.ownedRoot!, `vitest-${crypto.randomUUID()}.json`);
    const cwd = path.join(this.dir, this.workspaceDir);

    const args = [
      "vitest",
      "run",
      "--bail=1",
      "--maxWorkers=1",
      "--reporter=json",
      `--outputFile=${outFile}`,
      "--",
      ...files,
    ];
    const result = await run("npx", args, { cwd, timeout, env: this.env, signal });

    let report: VitestReport;
    try {
      report = JSON.parse(fs.readFileSync(outFile, "utf8")) as VitestReport;
    } catch {
      return {
        ok: false,
        parsed: false,
        passed: new Set(),
        failed: new Set(),
        fileFailures: [],
        error: (result.stderr || result.stdout).slice(-1500),
      };
    } finally {
      fs.rmSync(outFile, { force: true });
    }

    return { ...parseVitest(report, this.dir), ok: result.ok, parsed: true };
  }
}

function assertOwnedCheckout(dir: string, root: string | undefined): asserts root is string {
  if (!root) throw new Error("Benchmark mutation requires a Brain-owned disposable checkout");
  const realRoot = fs.realpathSync(root);
  const realDir = fs.realpathSync(dir);
  const expected = path.join(realRoot, "checkout");
  const owner = JSON.parse(fs.readFileSync(path.join(realRoot, "owner.json"), "utf8")) as {
    checkout?: unknown;
    source?: unknown;
  };
  if (realDir !== expected || owner.checkout !== realDir || owner.source === realDir)
    throw new Error("Benchmark checkout ownership does not match its directory");
}

export interface BenchmarkCheckout {
  dir: string;
  root: string;
  dispose(): void;
}

/** Clone only an explicit local source. All task resets stay in the generated copy. */
export async function createBenchmarkCheckout(
  source: string,
  directory: string,
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BenchmarkCheckout> {
  signal?.throwIfAborted();
  const realSource = fs.realpathSync(source);
  if (!fs.statSync(realSource).isDirectory())
    throw new Error("Benchmark source must be a local repository directory");
  ensurePrivateDirectory(directory);
  const root = fs.mkdtempSync(path.join(fs.realpathSync(directory), "repo-"));
  const dir = path.join(root, "checkout");
  try {
    const cloned = await run(
      "git",
      ["clone", "--no-hardlinks", "--no-checkout", "--", realSource, dir],
      { signal, env },
    );
    if (!cloned.ok) throw new Error("Could not create the disposable benchmark checkout");
    writePrivateFileAtomicSync(
      path.join(root, "owner.json"),
      JSON.stringify({ source: realSource, checkout: fs.realpathSync(dir) }),
    );
  } catch (error) {
    // root was generated here under the explicitly supplied parent; never remove source.
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    dir,
    dispose() {
      assertOwnedCheckout(dir, root);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Turn a vitest JSON report into pass/fail sets keyed by a stable test id.
 *
 * A file that fails to import has no assertion results at all - those are
 * recorded separately, because "no tests ran" is not the same as "tests failed"
 * and must not be mistaken for a passing baseline.
 */
export function parseVitest(report: VitestReport, repoDir: string): ParsedVitest {
  const passed = new Set<string>();
  const failed = new Set<string>();
  const fileFailures: FileFailure[] = [];

  for (const suite of report.testResults || []) {
    const file = path.relative(repoDir, suite.name || "").replace(/\\/g, "/");
    const assertions = suite.assertionResults || [];

    if (!assertions.length && suite.status !== "passed") {
      fileFailures.push({ file, message: (suite.message || "").slice(0, 500) });
      continue;
    }
    for (const assertion of assertions) {
      const id = `${file}::${assertion.fullName}`;
      if (assertion.status === "passed") passed.add(id);
      else failed.add(id);
    }
  }

  return {
    passed,
    failed,
    fileFailures,
    totals: {
      total: report.numTotalTests ?? passed.size + failed.size,
      passed: report.numPassedTests ?? passed.size,
      failed: report.numFailedTests ?? failed.size,
    },
  };
}

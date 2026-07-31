import fs from "node:fs";
import path from "node:path";

import { Repo } from "./repo.js";
import { mine } from "./mine.js";

import type { TestResult } from "./repo.js";
import type { MinedTask } from "./mine.js";
import type {
  ChatMessage,
  ChatRequestMessage,
  Task,
  TaskOutcome,
  TaskRunContext,
  Tool,
} from "./tasks.js";

/**
 * Turn a mined commit into a real, runnable agentic-coding task.
 *
 * This is the SWE-bench-style oracle wired end to end: reset the working copy to
 * the buggy parent, bring in ONLY the author's tests as the oracle (source stays
 * broken), then hand the model real read/write/run tools against that working
 * copy and score on whether the previously-failing tests actually pass afterward.
 *
 * Two properties are load-bearing:
 *   - Nothing here is simulated. `run_tests` builds and runs the workspace suite
 *     through {@link Repo}; the score is a delta between two real test runs, not a
 *     regex over the model's prose.
 *   - The oracle test files are read-only to the model. A write that lands on a
 *     test path is refused, so a model cannot "pass" by rewriting the assertions.
 *
 * The scorer ({@link scoreTestDeltas}) is a pure function of four id sets and is
 * unit-tested directly; the process-spawning half (build/test/fs) lives only in
 * the task's run() and is never exercised by tests.
 */

/** The tools a repo task exposes to the model, in OpenAI function shape. */
export const REPO_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a source file from the repository working copy.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Repo-relative path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Overwrite a source file with new contents. The oracle test files are read-only.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repo-relative path" },
          content: { type: "string", description: "Complete new file contents" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List the entries of a directory in the repository working copy.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Repo-relative path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_tests",
      description:
        "Build the workspace and run the oracle test suite. Returns pass/fail counts and the names of failing tests.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// ------------------------------------------------------------------ scoring

/**
 * Oracle test outcomes from one {@link Repo.test} run, restricted to the oracle
 * files. `importFailed` carries oracle test files that could not even be
 * imported - a state distinct from "its assertions failed" and scored as such.
 */
export interface OracleTestRun {
  passed: Set<string>;
  failed: Set<string>;
  importFailed: Set<string>;
}

/** The pass/fail delta between a baseline run and a post-edit run. */
export interface TestDelta {
  score: number;
  targets: number;
  fixed: number;
  regressions: number;
  keptPassing: number;
  fixedTests: string[];
  regressedTests: string[];
  degenerate: boolean;
}

/** A test id is `${file}::${fullName}`; recover the file half. */
function fileOf(id: string): string {
  const idx = id.indexOf("::");
  return idx === -1 ? id : id.slice(0, idx);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Score a fix by the fraction of previously-failing oracle tests that now pass,
 * discounted by any previously-passing tests it regressed.
 *
 * The target set is every oracle test that failed at baseline, plus - for oracle
 * files that could not be imported at baseline - every test that surfaced in the
 * file once it imported after the fix. That captures the common missing-symbol
 * bug, where the buggy source has no assertions to fail because the test file
 * never loaded. A file that newly fails to import after the fix counts its
 * previously-passing tests as regressed.
 */
export function scoreTestDeltas(before: OracleTestRun, after: OracleTestRun): TestDelta {
  const targets = new Set(before.failed);
  if (before.importFailed.size) {
    for (const id of [...after.passed, ...after.failed]) {
      if (before.importFailed.has(fileOf(id))) targets.add(id);
    }
  }

  const fixedTests = [...targets].filter((id) => after.passed.has(id));
  const regressedTests = [...before.passed].filter(
    (id) => after.failed.has(id) || after.importFailed.has(fileOf(id)),
  );
  const keptPassing = before.passed.size - regressedTests.length;

  // Nothing failed at baseline means the oracle never reproduced the bug on the
  // buggy parent - the task is degenerate and cannot credit a fix.
  const degenerate = before.failed.size === 0 && before.importFailed.size === 0;

  let score = 0;
  if (!degenerate && targets.size > 0) {
    const fixedFraction = fixedTests.length / targets.size;
    const regressionGuard = before.passed.size ? keptPassing / before.passed.size : 1;
    score = clamp01(fixedFraction * regressionGuard);
  }

  return {
    score,
    targets: targets.size,
    fixed: fixedTests.length,
    regressions: regressedTests.length,
    keptPassing,
    fixedTests,
    regressedTests,
    degenerate,
  };
}

/** Restrict a {@link TestResult} to the oracle test files. */
export function collectOracleRun(result: TestResult, oracleFiles: Set<string>): OracleTestRun {
  return {
    passed: new Set([...result.passed].filter((id) => oracleFiles.has(fileOf(id)))),
    failed: new Set([...result.failed].filter((id) => oracleFiles.has(fileOf(id)))),
    importFailed: new Set(
      result.fileFailures.map((f) => f.file).filter((file) => oracleFiles.has(file)),
    ),
  };
}

// -------------------------------------------------------------- tool loop

/** Everything a mined task needs beyond the mined record itself. */
export interface RepoTaskOptions {
  repo: Repo;
  weight?: number;
  maxTurns?: number;
  testTimeoutMs?: number;
  maxFileChars?: number;
}

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Resolve a model-supplied path inside the repo, refusing to escape it. */
function resolveInRepo(repoDir: string, p: string): string | null {
  const resolved = path.resolve(repoDir, p);
  const rel = path.relative(repoDir, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

/** Build the workspace, then run its suite. Build failure is non-fatal: vitest
 *  transpiles per file and still runs when a tsc build has type errors. */
async function runOracleTests(repo: Repo, timeoutMs: number): Promise<TestResult> {
  await repo.build();
  return repo.test({ timeout: timeoutMs });
}

/** Compact one oracle run into a line for the model. */
function describeRun(run: OracleTestRun): string {
  const failing = [...run.failed];
  const importFailed = [...run.importFailed];
  const bits = [`${run.passed.size} passing, ${run.failed.size} failing`];
  if (importFailed.length) bits.push(`${importFailed.length} file(s) failed to import`);
  const names = failing.slice(0, 12).map((id) => id.split("::").slice(1).join("::") || id);
  if (names.length) bits.push(`failing: ${names.join("; ")}`);
  if (importFailed.length) bits.push(`import-failed files: ${importFailed.join(", ")}`);
  return bits.join(". ");
}

interface ToolCall {
  id?: string;
  name?: string;
  input?: unknown;
  function?: { name?: string; arguments?: unknown };
}

function parseArgs(call: ToolCall): Record<string, unknown> {
  let args: unknown = call.function?.arguments ?? call.input ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      args = {};
    }
  }
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

/**
 * Adapt one {@link MinedTask} into a runnable {@link Task}. The bound {@link Repo}
 * is reused across tasks (only one model fits in VRAM, so tasks already
 * serialise on a single working copy).
 */
export function makeRepoTask(mined: MinedTask, options: RepoTaskOptions): Task {
  const { repo } = options;
  const weight = options.weight ?? 3;
  const maxTurns = options.maxTurns ?? 12;
  const testTimeoutMs = options.testTimeoutMs ?? 600_000;
  const maxFileChars = options.maxFileChars ?? 20_000;

  const oracleFiles = new Set(mined.testPaths.map(normalizeRepoPath));

  return {
    id: mined.id,
    category: "SWE-bench repo",
    weight,
    description: `Make the mined oracle tests pass: ${mined.subject}`,
    async run({ chat }: TaskRunContext): Promise<TaskOutcome> {
      // 1. Buggy parent source + author's oracle tests.
      await repo.reset(mined.parent);
      await repo.checkoutPaths(mined.fix, mined.testPaths);
      await repo.ensureDependencies();

      const baselineResult = await runOracleTests(repo, testTimeoutMs);
      const baseline = collectOracleRun(baselineResult, oracleFiles);

      const preDelta = scoreTestDeltas(baseline, baseline);
      if (preDelta.degenerate) {
        return {
          score: 0,
          summary: `oracle did not reproduce on the buggy parent (${mined.id})`,
          detail: { baseline: describeRun(baseline), mined: mined.id },
        };
      }

      // 2. Real agentic repair loop against the working copy.
      const messages: ChatRequestMessage[] = [
        {
          role: "user",
          content:
            `A bug in this TypeScript repository is described by a failing test suite.\n\n` +
            `Task: ${mined.subject}\n\n` +
            `Oracle test file(s) (do NOT edit these): ${mined.testPaths.join(", ")}\n` +
            `Source file(s) that likely need the fix: ${mined.sourcePaths.join(", ")}\n\n` +
            `Current state - ${describeRun(baseline)}\n\n` +
            `Fix the SOURCE so the failing tests pass. Use read_file and list_directory to ` +
            `explore, write_file to save your fix, and run_tests to check progress. When the ` +
            `oracle tests pass, stop.`,
        },
      ];

      let turns = 0;
      let ranTests = false;
      let wrote = false;
      let stalled: string | null = null;

      while (turns < maxTurns) {
        turns += 1;
        const response = await chat({
          messages,
          tools: REPO_TOOLS,
          max_tokens: 4096,
          temperature: 0.3,
        });
        const message: ChatMessage = response.choices?.[0]?.message || {};
        const calls = (message.tool_calls as ToolCall[] | undefined) || [];

        if (!calls.length) {
          if (!message.content) stalled = "produced neither content nor a tool call";
          break;
        }

        messages.push({
          role: "assistant",
          content: message.content || null,
          tool_calls: message.tool_calls,
        });

        for (const call of calls) {
          const name = call.function?.name || call.name;
          const args = parseArgs(call);
          let toolResult = "ok";

          if (name === "read_file") {
            const target = resolveInRepo(repo.dir, String(args.path ?? ""));
            if (!target) toolResult = "error: path is outside the repository";
            else {
              try {
                toolResult = fs.readFileSync(target, "utf8").slice(0, maxFileChars);
              } catch (error) {
                toolResult = `error: ${error instanceof Error ? error.message : String(error)}`;
              }
            }
          } else if (name === "write_file") {
            const rel = normalizeRepoPath(String(args.path ?? ""));
            const target = resolveInRepo(repo.dir, rel);
            if (!target) toolResult = "error: path is outside the repository";
            else if (oracleFiles.has(rel))
              toolResult = "error: the oracle test files are read-only";
            else {
              try {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, String(args.content ?? ""), "utf8");
                wrote = true;
                toolResult = `wrote ${rel}`;
              } catch (error) {
                toolResult = `error: ${error instanceof Error ? error.message : String(error)}`;
              }
            }
          } else if (name === "list_directory") {
            const target = resolveInRepo(repo.dir, String(args.path ?? "."));
            if (!target) toolResult = "error: path is outside the repository";
            else {
              try {
                toolResult =
                  fs
                    .readdirSync(target, { withFileTypes: true })
                    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
                    .join("\n") || "(empty)";
              } catch (error) {
                toolResult = `error: ${error instanceof Error ? error.message : String(error)}`;
              }
            }
          } else if (name === "run_tests") {
            ranTests = true;
            const current = collectOracleRun(
              await runOracleTests(repo, testTimeoutMs),
              oracleFiles,
            );
            toolResult = describeRun(current);
          } else {
            toolResult = `error: unknown tool "${String(name)}"`;
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id || "call_0",
            content: toolResult,
          });
        }
      }

      // 3. Authoritative final run and delta scoring.
      const finalResult = await runOracleTests(repo, testTimeoutMs);
      const after = collectOracleRun(finalResult, oracleFiles);
      const delta = scoreTestDeltas(baseline, after);

      const summaryBits = [`fixed ${delta.fixed}/${delta.targets} oracle tests`];
      if (delta.regressions) summaryBits.push(`${delta.regressions} regressions`);
      if (!wrote) summaryBits.push("no edit written");
      if (stalled) summaryBits.push(stalled);
      if (!ranTests) summaryBits.push("never ran tests");

      return {
        score: delta.score,
        summary: summaryBits.join(", "),
        detail: {
          turns,
          wrote,
          ranTests,
          stalled,
          baseline: describeRun(baseline),
          after: describeRun(after),
          delta: {
            targets: delta.targets,
            fixed: delta.fixed,
            regressions: delta.regressions,
            fixedTests: delta.fixedTests.slice(0, 20),
            regressedTests: delta.regressedTests.slice(0, 20),
          },
          mined: {
            id: mined.id,
            fix: mined.fix,
            parent: mined.parent,
            subject: mined.subject,
            testPaths: mined.testPaths,
            sourcePaths: mined.sourcePaths,
          },
        },
      };
    },
  };
}

// ---------------------------------------------------------------- loading

/** Options for {@link loadRepoTasks}. */
export interface LoadRepoTasksOptions {
  dir: string;
  workspace: string;
  workspaceDir: string;
  ref?: string;
  limit?: number;
  maxTasks?: number;
  onlyFixes?: boolean;
  maxTurns?: number;
  weight?: number;
}

/**
 * Mine a target repo and wrap the top mined commits as runnable tasks, all bound
 * to a single reused {@link Repo}. Returns an empty array when nothing mines -
 * the caller decides whether that is fatal.
 */
export async function loadRepoTasks(options: LoadRepoTasksOptions): Promise<Task[]> {
  const mined = await mine({
    dir: options.dir,
    workspaceDir: options.workspaceDir,
    limit: options.limit,
    ref: options.ref,
  });
  const pool = options.onlyFixes ? mined.filter((m) => m.looksLikeFix) : mined;
  const chosen = pool.slice(0, options.maxTasks ?? 5);
  if (!chosen.length) return [];

  const repo = new Repo({
    dir: options.dir,
    workspace: options.workspace,
    workspaceDir: options.workspaceDir,
  });
  return chosen.map((m) =>
    makeRepoTask(m, { repo, maxTurns: options.maxTurns, weight: options.weight }),
  );
}

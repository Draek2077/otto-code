import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";

/**
 * Objective verification of generated code.
 *
 * A benchmark is only worth trusting if a pass means something checkable, so
 * nothing here asks a model to grade another model. Generated Python is
 * written to a scratch directory and handed to the real interpreter: it either
 * compiles and its tests pass, or it does not.
 *
 * NOTE: `runTests` executes model-generated code. It runs in a temporary
 * directory under a timeout, but it is still arbitrary code execution - pass
 * `execute: false` to stop at syntax checking.
 */

/** A discovered Python interpreter. */
export interface PythonInfo {
  exe: string;
  version: string;
}

/** Outcome of running a child process. */
export interface RunResult {
  ok: boolean;
  code: number | string;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  cwd: string;
  timeout?: number;
}

function which(candidates: string[]): PythonInfo | null {
  for (const candidate of candidates) {
    try {
      const result = execFileSync(candidate, ["--version"], {
        timeout: 8000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { exe: candidate, version: String(result).trim() };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

let cachedPython: PythonInfo | null | undefined;
export function findPython(): PythonInfo | null {
  if (cachedPython === undefined) cachedPython = which(["python", "py", "python3"]);
  return cachedPython;
}

function run(
  exe: string,
  args: string[],
  { cwd, timeout = 60_000 }: RunOptions,
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code ?? 0,
          timedOut: error?.killed === true || error?.signal === "SIGTERM",
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

const CODE_LANGUAGES = new Set(["python", "py", "python3", ""]);
const FILENAME_PATTERN = /([\w./-]+\.(?:py|md|txt|json|toml|cfg|ini))/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find which expected filename a snippet of text refers to.
 *
 * Plain `includes` is wrong here and was a real bug: "test_lru.py" contains
 * "lru.py", so a naive scan attributed every test block to lru.py and silently
 * overwrote it. Match longest-first and require a boundary before the name.
 */
export function findExpectedName(source: string, expectedFiles: string[]): string | null {
  const longestFirst = [...expectedFiles].sort((a, b) => b.length - a.length);
  for (const name of longestFirst) {
    const boundary = new RegExp(`(^|[^\\w.\\-])${escapeRegExp(name)}(\\W|$)`);
    if (boundary.test(source)) return name;
  }
  return null;
}

/**
 * Models label files in markdown, which means the label is often escaped
 * (`test\_lru.py`) or decorated (`**test_lru.py**`, `### 3. test_lru.py`).
 * Undo that before pattern matching or the leading segment gets lost.
 */
export function unescapeMarkdown(text: string): string {
  return String(text).replace(/\\([_*`~[\]()#+\-.!])/g, "$1");
}

/** Guess a filename from what the code itself contains. */
function inferFromContent(code: string, expectedFiles: string[]): string | null {
  const isTest = /import\s+unittest|unittest\.TestCase|^\s*import\s+pytest/m.test(code);
  if (isTest) {
    const named = expectedFiles.find((f) => /^test_/.test(f));
    if (named) return named;
    return "test_generated.py";
  }
  // Match a definition against an expected module name, e.g. class Metrics -> metrics.py
  for (const candidate of expectedFiles) {
    const stem = candidate.replace(/\.py$/, "");
    if (!stem || candidate.startsWith("test_")) continue;
    const defined = new RegExp(`(?:class|def)\\s+${stem}`, "i").test(code);
    if (defined) return candidate;
  }
  return null;
}

/** A fenced code block extracted from a model response. */
export interface CodeBlock {
  language: string;
  filename: string | null;
  code: string;
  isCode: boolean;
}

/**
 * Pull fenced code blocks out of a response and work out which file each is.
 *
 * @param {string} text
 * @param {string[]} expectedFiles names the task asked for, used to
 *        disambiguate unlabelled blocks
 */
export function extractCodeBlocks(text: string, expectedFiles: string[] = []): CodeBlock[] {
  const clean = unescapeMarkdown(text);
  const blocks: CodeBlock[] = [];
  const fence = /```([\w+-]*)[ \t]*([^\n]*)\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = fence.exec(clean)) !== null) {
    const [, rawLanguage, info, code] = match;
    const language = rawLanguage.toLowerCase();

    // Only the 300 characters immediately before the fence, so a filename
    // mentioned paragraphs earlier cannot be misattributed to this block.
    const before = clean.slice(Math.max(0, match.index - 300), match.index);
    const lastLines = before.split(/\n/).slice(-4).join("\n");

    let filename: string | null = null;
    // Strongest signal first: the fence info string, then a comment on the
    // first line of the code, then the prose immediately above.
    for (const source of [info, code.split("\n", 2).join("\n"), lastLines]) {
      // Prefer an expected name if one appears literally.
      const expected = findExpectedName(source, expectedFiles);
      if (expected) {
        filename = expected;
        break;
      }
      const found = source.match(FILENAME_PATTERN);
      if (found) {
        filename = path.basename(found[1]);
        break;
      }
    }

    if (!filename) filename = inferFromContent(code, expectedFiles);

    blocks.push({ language, filename, code, isCode: CODE_LANGUAGES.has(language) });
  }
  return blocks;
}

/** True when the response elided work instead of writing it out. */
export function findPlaceholders(text: string): number {
  const patterns = [
    /\.\.\.\s*(?:rest of|remaining|etc)/i,
    /#\s*(?:TODO|FIXME|implement(?:ation)? (?:here|omitted)|rest of the (?:code|implementation))/i,
    /\b(?:omitted for brevity|truncated for brevity|and so on)\b/i,
    /<\s*(?:your code here|implementation)\s*>/i,
  ];
  return patterns.filter((p) => p.test(text)).length;
}

/** Options for {@link verifyPython}. */
export interface VerifyPythonOptions {
  expectedFiles?: string[];
  execute?: boolean;
  timeoutMs?: number;
}

/** Result of writing, syntax-checking, and running generated Python. */
export interface VerifyResult {
  pythonAvailable: boolean;
  blocks: number;
  filesWritten: string[];
  filesExpected: string[];
  filesMissing: string[];
  syntaxErrors: string[];
  testFile: string | null;
  nameCollisions: string[];
  placeholders: number;
  compiled: boolean | null;
  testsRun: boolean;
  testsPassed: number | null;
  testsTotal: number | null;
  testOutput: string | null;
}

/**
 * Write the extracted files to disk, syntax-check them, and optionally run the
 * test module.
 */
export async function verifyPython(
  text: string,
  { expectedFiles = [], execute = true, timeoutMs = 90_000 }: VerifyPythonOptions = {},
): Promise<VerifyResult> {
  const python = findPython();
  const blocks = extractCodeBlocks(text, expectedFiles);

  const result: VerifyResult = {
    pythonAvailable: Boolean(python),
    blocks: blocks.length,
    filesWritten: [],
    filesExpected: expectedFiles,
    filesMissing: [],
    syntaxErrors: [],
    testFile: null,
    nameCollisions: [],
    placeholders: findPlaceholders(text),
    compiled: null,
    testsRun: false,
    testsPassed: null,
    testsTotal: null,
    testOutput: null,
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-brain-bench-"));
  try {
    // Prefer named blocks; fall back to positional naming for code blocks.
    let anonymous = 0;
    for (const block of blocks) {
      let name = block.filename;
      if (!name) {
        // Never write prose (markdown, shell transcripts) into a .py file.
        if (!block.isCode) continue;
        name = `block_${(anonymous += 1)}.py`;
      }
      // Never let a model-chosen name escape the scratch directory.
      let safe = path.basename(name);
      // Two blocks resolving to one name means a misattribution, not an
      // intentional rewrite - keep both rather than losing one silently.
      if (result.filesWritten.includes(safe)) {
        const ext = path.extname(safe);
        safe = `${path.basename(safe, ext)}_${result.filesWritten.length}${ext}`;
        result.nameCollisions.push(name);
      }
      fs.writeFileSync(path.join(dir, safe), block.code, "utf8");
      result.filesWritten.push(safe);
      if (/^test_.*\.py$/.test(safe) || /unittest\.TestCase/.test(block.code)) {
        result.testFile = safe;
      }
    }

    result.filesMissing = expectedFiles.filter((f) => !result.filesWritten.includes(f));

    if (!python) return result;

    // Syntax check every python file.
    const pyFiles = result.filesWritten.filter((f) => f.endsWith(".py"));
    if (pyFiles.length) {
      const compileResult = await run(python.exe, ["-m", "py_compile", ...pyFiles], {
        cwd: dir,
        timeout: 45_000,
      });
      result.compiled = compileResult.ok;
      if (!compileResult.ok) {
        for (const line of compileResult.stderr.split(/\r?\n/)) {
          if (/Error|error:/.test(line)) result.syntaxErrors.push(line.trim());
        }
      }
    } else {
      result.compiled = false;
    }

    // Run the tests only if everything at least parses.
    const testFile = result.testFile || result.filesWritten.find((f) => /^test_.*\.py$/.test(f));
    result.testFile = testFile || null;
    if (execute && result.compiled && testFile) {
      const testResult = await run(
        python.exe,
        ["-m", "unittest", "-v", testFile.replace(/\.py$/, "")],
        { cwd: dir, timeout: timeoutMs },
      );
      result.testsRun = true;
      // Keep stdout+stderr for display, but the pass/fail VERDICT is parsed from
      // stderr only: unittest writes its "Ran N tests" + "OK"/"FAILED" summary to
      // stderr, while the model's solution prints to stdout. Concatenating them
      // and scanning for "OK" anywhere let a solution that prints "OK" spoof a
      // pass. parseUnittest anchors the status to the end of the transcript.
      result.testOutput = `${testResult.stdout}\n${testResult.stderr}`.trim().slice(-4000);
      const verdict = parseUnittest(testResult.stderr);
      result.testsTotal = verdict.total;
      result.testsPassed = verdict.passed;
      if (testResult.timedOut)
        result.testOutput = `TIMED OUT after ${timeoutMs}ms\n${result.testOutput}`;
    }

    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Parse a `python -m unittest` transcript into passed/total counts.
 *
 * Pass this the unittest STDERR stream, not stdout+stderr combined: unittest
 * emits its summary ("Ran N tests", then a final "OK" or "FAILED (...)" line) to
 * stderr, whereas a graded solution prints to stdout. The final-status match is
 * anchored to the end of the transcript so a solution that prints "OK" earlier
 * cannot spoof a pass; "FAILED" is honored explicitly.
 */
export function parseUnittest(output: string): { total: number | null; passed: number | null } {
  const trimmed = output.trimEnd();
  const ran = trimmed.match(/Ran (\d+) tests?/);
  const total = ran ? Number(ran[1]) : null;
  if (total === null) return { total: null, passed: null };
  // The last line of a unittest run is "OK" (maybe with skips) or "FAILED (...)".
  const status = trimmed.match(/(?:^|\n)(OK|FAILED)\b[^\n]*$/);
  if (status && status[1] === "OK") return { total, passed: total };
  const failures = Number(trimmed.match(/failures=(\d+)/)?.[1] || 0);
  const errors = Number(trimmed.match(/errors=(\d+)/)?.[1] || 0);
  // No trailing OK and no failure counts (e.g. a crash before the summary) means
  // nothing verifiably passed.
  if (!status && failures === 0 && errors === 0) return { total, passed: 0 };
  return { total, passed: Math.max(0, total - failures - errors) };
}

/** Outcome of running one unittest module over a set of in-memory files. */
export interface UnitRunResult {
  ran: boolean;
  compiled: boolean;
  passed: number | null;
  total: number | null;
  output: string;
}

/**
 * Write the given files to a scratch dir, syntax-check them, and run one
 * unittest module against the real interpreter. The agentic-loop task uses this
 * to grade a model's fix against a hidden test suite - objective, deterministic,
 * and never a model grading a model. Returns `ran: false` when Python is absent
 * or execution is disabled, so the caller can fall back to process credit.
 */
export async function runUnittestFiles(
  files: Record<string, string>,
  testModule: string,
  { execute = true, timeoutMs = 60_000 }: { execute?: boolean; timeoutMs?: number } = {},
): Promise<UnitRunResult> {
  const result: UnitRunResult = {
    ran: false,
    compiled: false,
    passed: null,
    total: null,
    output: "",
  };
  const python = findPython();
  if (!python) return result;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-brain-agentic-"));
  try {
    const pyFiles: string[] = [];
    for (const [name, content] of Object.entries(files)) {
      const safe = path.basename(name);
      fs.writeFileSync(path.join(dir, safe), content, "utf8");
      if (safe.endsWith(".py")) pyFiles.push(safe);
    }

    const compileResult = await run(python.exe, ["-m", "py_compile", ...pyFiles], {
      cwd: dir,
      timeout: 30_000,
    });
    result.compiled = compileResult.ok;
    if (!compileResult.ok) {
      result.output = compileResult.stderr.trim().slice(-2000);
      return result;
    }
    if (!execute) return result;

    const testResult = await run(python.exe, ["-m", "unittest", "-v", testModule], {
      cwd: dir,
      timeout: timeoutMs,
    });
    result.ran = true;
    result.output = `${testResult.stdout}\n${testResult.stderr}`.trim().slice(-2000);
    // Verdict from stderr only (see parseUnittest) so model stdout can't spoof it.
    const parsed = parseUnittest(testResult.stderr);
    result.total = parsed.total;
    result.passed = parsed.passed;
    if (testResult.timedOut) result.output = `TIMED OUT after ${timeoutMs}ms\n${result.output}`;
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A single tool-call the model may emit, in either Anthropic or OpenAI shape. */
export interface ToolCall {
  id?: string;
  name?: string;
  input?: unknown;
  function?: { name?: string; arguments?: unknown };
}

/** What a tool-call case expects: a name, required args, and a predicate. */
export interface ToolCallExpectation {
  name: string;
  requiredArgs?: string[];
  check?: (args: Record<string, unknown>) => boolean | string;
}

/** Verdict from checking a tool call against an expectation. */
export interface ToolCallVerdict {
  ok: boolean;
  reason?: string | null;
  args?: Record<string, unknown>;
}

/** Check a tool call against an expected name and argument predicate. */
export function verifyToolCall(
  toolCalls: ToolCall[] | null | undefined,
  expectation: ToolCallExpectation,
): ToolCallVerdict {
  if (!toolCalls || !toolCalls.length) {
    return { ok: false, reason: "no tool call emitted" };
  }
  const call = toolCalls.find((c) => (c.function?.name || c.name) === expectation.name);
  if (!call) {
    const names = toolCalls.map((c) => c.function?.name || c.name).join(", ");
    return { ok: false, reason: `expected ${expectation.name}, got ${names}` };
  }

  let args: unknown = call.function?.arguments ?? call.input ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      return { ok: false, reason: "arguments were not valid JSON" };
    }
  }
  const record: Record<string, unknown> =
    args && typeof args === "object" ? (args as Record<string, unknown>) : {};

  for (const key of expectation.requiredArgs || []) {
    if (record[key] === undefined || record[key] === null || record[key] === "") {
      return { ok: false, reason: `missing required argument "${key}"` };
    }
  }
  if (expectation.check) {
    const verdict = expectation.check(record);
    if (verdict !== true) return { ok: false, reason: verdict || "argument check failed" };
  }
  return { ok: true, args: record };
}

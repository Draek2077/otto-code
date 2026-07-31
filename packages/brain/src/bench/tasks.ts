import { runUnittestFiles, verifyPython, verifyToolCall } from "./verify.js";
import { EXTRA_CORPUS, EXTRA_HIDDEN_TEST, EXTRA_PY_FILES, EXTRA_TARGET_FILE } from "./corpus.js";

import type { ToolCall, ToolCallExpectation } from "./verify.js";

/**
 * Benchmark tasks for agentic coding on this machine.
 *
 * Every task scores 0..1 from something checkable - a tool call with the right
 * name and arguments, code the interpreter accepts, tests that actually pass -
 * rather than a subjective read of the output.
 */

/** A single JSON-schema parameter of a tool. */
export interface ToolParameterSpec {
  type: string;
  description?: string;
}

/** The parameters object of a tool function. */
export interface ToolFunctionParameters {
  type: string;
  properties: Record<string, ToolParameterSpec>;
  required: string[];
}

/** An OpenAI-style function tool. */
export interface ToolFunction {
  name: string;
  description: string;
  parameters: ToolFunctionParameters;
}

/** A tool exposed to the model. */
export interface Tool {
  type: string;
  function: ToolFunction;
}

/** A message sent to the chat endpoint. */
export interface ChatRequestMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** The payload POSTed to /v1/chat/completions. */
export interface ChatPayload {
  messages: ChatRequestMessage[];
  tools?: Tool[];
  max_tokens?: number;
  temperature?: number;
}

/** A message returned by the model. */
export interface ChatMessage {
  role?: string;
  content?: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
}

/** Token accounting reported by the endpoint. */
export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** Timing information reported by llama-server. */
export interface ChatTimings {
  prompt_ms?: number;
  prompt_per_second?: number;
  predicted_per_second?: number;
}

/** One choice in a chat completion response. */
export interface ChatChoice {
  message?: ChatMessage;
  finish_reason?: string;
}

/** A chat completion response (with an `error` slot for a failed request). */
export interface ChatResponse {
  choices?: ChatChoice[];
  usage?: ChatUsage;
  timings?: ChatTimings;
  error?: string;
}

/** The function each task uses to talk to the endpoint. */
export interface ChatFn {
  (payload: ChatPayload): Promise<ChatResponse>;
}

/** Context handed to each task's run(). */
export interface TaskRunContext {
  chat: ChatFn;
  execute?: boolean;
  depths?: number[];
  concurrency?: number;
  /**
   * The model's reasoning-token budget, so tasks can size their response cap
   * above it. A thinking model given a max_tokens smaller than its budget spends
   * the whole allowance reasoning and returns empty content. Null/unset means
   * unknown (e.g. an arbitrary --endpoint), and tasks fall back to a safe cap.
   */
  reasoningBudget?: number | null;
  /**
   * The model's loaded context window (tokens). Long-horizon tasks report peak
   * prompt-token usage as a fraction of this, so a run says not just whether the
   * model fixed the bug but how much context it held while doing it. Null/unset
   * means unknown (e.g. an arbitrary --endpoint).
   */
  contextWindow?: number | null;
}

/** What a task returns after running. */
export interface TaskOutcome {
  score: number;
  summary: string;
  detail?: unknown;
}

/** A single benchmark task. */
export interface Task {
  id: string;
  category: string;
  weight: number;
  description: string;
  run(ctx: TaskRunContext): Promise<TaskOutcome>;
}

/** A single tool-calling test case. */
export interface ToolCase {
  id: string;
  prompt: string;
  expect: ToolCallExpectation;
}

export const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full contents of a file from disk.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path to the file" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write contents to a file, replacing it entirely.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string", description: "Complete new file contents" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the project directory and return its output.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List the files in a directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Apply a targeted edit to a file by replacing an exact string with a new one. " +
        "Use this instead of write_file when changing part of an existing file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string", description: "Exact text to find and replace" },
          new_text: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Search the contents of files across the project for a string or pattern (like grep). " +
        "Returns the matching lines and their file paths.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The text or pattern to search for" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_files",
      description:
        "Find files by name or glob pattern across the project (like a filename search). " +
        "Use this to locate files by their name, not their contents.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "A filename or glob, e.g. **/*_test.py" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file from disk.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_directory",
      description: "Create a new directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

// --------------------------------------------------------------- tool calling

export const TOOL_CASES: ToolCase[] = [
  {
    id: "tools/read",
    prompt: "I need to see what is inside src/config.py. Use your tools.",
    expect: {
      name: "read_file",
      requiredArgs: ["path"],
      check: (args) =>
        String(args.path).includes("config.py") ? true : `path was "${String(args.path)}"`,
    },
  },
  {
    id: "tools/command",
    prompt: "Run the project test suite with pytest and tell me what happens. Use your tools.",
    expect: {
      name: "run_command",
      requiredArgs: ["command"],
      check: (args) =>
        /pytest|python -m pytest/i.test(String(args.command))
          ? true
          : `command was "${String(args.command)}"`,
    },
  },
  {
    id: "tools/write-content",
    prompt:
      "Create a file called greet.py containing a single function greet(name) that " +
      'returns the string "Hello, " followed by the name. Use your tools to write it.',
    expect: {
      name: "write_file",
      requiredArgs: ["path", "content"],
      check: (args) => {
        if (!String(args.path).includes("greet.py")) return `path was "${String(args.path)}"`;
        const content = String(args.content);
        if (!/def\s+greet\s*\(/.test(content)) return "content has no greet() definition";
        if (!/return/.test(content)) return "content has no return statement";
        return true;
      },
    },
  },
  {
    id: "tools/list",
    prompt: "What files are in the tests directory? Use your tools.",
    expect: {
      name: "list_directory",
      requiredArgs: ["path"],
      check: (args) =>
        /tests?/.test(String(args.path)) ? true : `path was "${String(args.path)}"`,
    },
  },
  {
    id: "tools/edit",
    prompt:
      "In src/config.py there is a line `TIMEOUT = 30`. Change it to `TIMEOUT = 60`. " +
      "Edit the file in place, do not rewrite the whole thing. Use your tools.",
    expect: {
      name: "edit_file",
      requiredArgs: ["path", "old_text", "new_text"],
      check: (args) => {
        if (!String(args.path).includes("config.py")) return `path was "${String(args.path)}"`;
        if (!/\b30\b/.test(String(args.old_text))) return "old_text did not target the 30 value";
        if (!/\b60\b/.test(String(args.new_text))) return "new_text did not contain 60";
        return true;
      },
    },
  },
  {
    id: "tools/search",
    prompt:
      "Where in the codebase is the string DATABASE_URL used? Search the file contents. Use your tools.",
    expect: {
      name: "search_files",
      requiredArgs: ["query"],
      check: (args) =>
        /DATABASE_URL/.test(String(args.query)) ? true : `query was "${String(args.query)}"`,
    },
  },
  {
    id: "tools/find",
    prompt:
      "Locate every file in the project whose name ends in _test.py. Match by filename, not contents. Use your tools.",
    expect: {
      name: "find_files",
      requiredArgs: ["pattern"],
      check: (args) =>
        /_test\.py|test/i.test(String(args.pattern))
          ? true
          : `pattern was "${String(args.pattern)}"`,
    },
  },
  {
    id: "tools/delete",
    prompt: "Delete the stale file build/output.log from the project. Use your tools.",
    expect: {
      name: "delete_file",
      requiredArgs: ["path"],
      check: (args) =>
        /output\.log/.test(String(args.path)) ? true : `path was "${String(args.path)}"`,
    },
  },
  {
    id: "tools/mkdir",
    prompt: "Create a new directory named migrations at the project root. Use your tools.",
    expect: {
      name: "make_directory",
      requiredArgs: ["path"],
      check: (args) =>
        /migrations/.test(String(args.path)) ? true : `path was "${String(args.path)}"`,
    },
  },
];

/** Single-shot tool selection and argument correctness. */
const toolCallingTask: Task = {
  id: "tool-calling",
  category: "Tool calling",
  weight: 2,
  description: "Picks the right tool and fills its arguments correctly",
  async run({ chat }) {
    const outcomes = [];
    for (const testCase of TOOL_CASES) {
      const response = await chat({
        messages: [{ role: "user", content: testCase.prompt }],
        tools: TOOLS,
        max_tokens: 2048,
        temperature: 0.3,
      });
      const message: ChatMessage = response.choices?.[0]?.message || {};
      const verdict = verifyToolCall(message.tool_calls, testCase.expect);
      outcomes.push({
        id: testCase.id,
        ok: verdict.ok,
        reason: verdict.reason || null,
        tokens: response.usage?.completion_tokens ?? null,
      });
    }
    const passed = outcomes.filter((o) => o.ok).length;
    // Name the cases that failed (and why) so the scorecard says which tool
    // call the model missed, not just how many. Case ids drop the "tools/"
    // prefix to stay legible in the fixed-width summary column.
    const failed = outcomes
      .filter((o) => !o.ok)
      .map((o) => `${o.id.replace(/^tools\//, "")} (${o.reason ?? "failed"})`);
    return {
      score: passed / outcomes.length,
      summary:
        `${passed}/${outcomes.length} tool calls correct` +
        (failed.length ? ` - missed: ${failed.join("; ")}` : ""),
      detail: outcomes,
    };
  },
};

// ------------------------------------------------------------ agentic loop

/**
 * A read-fix-verify loop graded by real execution. The model reads a buggy
 * file, writes (or edits) a fix, then runs the tests - and the harness actually
 * runs its fix against a HIDDEN unittest suite, feeding the real pass/fail back
 * so the model can iterate. Scoring is the fraction of hidden tests that pass,
 * which discriminates: the empty-list crash is obvious, but the equal-values
 * (zero-span) crash is easy to miss, so weaker models land partway.
 *
 * The `read_file` result is simulated (deterministic input), but the verdict is
 * the interpreter's - never a model grading a model.
 */
const BUGGY_SCALE = `def normalize(values, low=0.0, high=1.0):
    lo = min(values)
    hi = max(values)
    span = hi - lo
    return [low + (high - low) * (v - lo) / span for v in values]
`;

const SCALE_TESTS = `import unittest
from scale import normalize


class TestNormalize(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(normalize([0, 5, 10]), [0.0, 0.5, 1.0])

    def test_custom_range(self):
        self.assertEqual(normalize([0, 10], 1.0, 3.0), [1.0, 3.0])

    def test_empty(self):
        self.assertEqual(normalize([]), [])

    def test_all_equal(self):
        self.assertEqual(normalize([7, 7, 7]), [0.0, 0.0, 0.0])

    def test_single(self):
        self.assertEqual(normalize([4]), [0.0])


if __name__ == "__main__":
    unittest.main()
`;

const agenticLoopTask: Task = {
  id: "agentic-loop",
  category: "Agentic loop",
  weight: 3,
  description: "Reads a bug, fixes it, and iterates against a hidden test suite",
  async run({ chat, execute = true, contextWindow }) {
    const messages: ChatRequestMessage[] = [
      {
        role: "user",
        content:
          "scale.py has a function normalize(values, low=0.0, high=1.0) that linearly rescales " +
          "the numbers in `values` into the range [low, high]. It crashes on some inputs. Make " +
          "it robust: an empty list must return [], and when every value is equal each result " +
          "should be the low bound. Read the file first, then write the corrected scale.py, then " +
          'run the tests with "python -m unittest". Use your tools for every step.',
      },
    ];

    // The model's current version of scale.py, updated by write_file/edit_file.
    let currentFile = BUGGY_SCALE;
    const steps = { read: false, wrote: false, ranTests: false };
    let bestPassed = 0;
    let total: number | null = null;
    let lastOutput = "";
    let testsExecuted = false;
    let turns = 0;
    const maxTurns = 8;
    let stalled: string | null = null;
    // Peak prompt size across turns: how much context the model actually held
    // while working. Reported as a fraction of the loaded window.
    let peakPromptTokens = 0;

    while (turns < maxTurns) {
      turns += 1;
      const response = await chat({ messages, tools: TOOLS, max_tokens: 4096, temperature: 0.3 });
      peakPromptTokens = Math.max(peakPromptTokens, response.usage?.prompt_tokens ?? 0);
      const message: ChatMessage = response.choices?.[0]?.message || {};
      const calls = message.tool_calls || [];

      if (!calls.length) {
        if (!message.content) stalled = "produced neither content nor a tool call";
        break;
      }

      messages.push({ role: "assistant", content: message.content || null, tool_calls: calls });

      for (const call of calls) {
        const name = call.function?.name || call.name;
        let args: unknown = call.function?.arguments ?? call.input ?? {};
        if (typeof args === "string") {
          try {
            args = JSON.parse(args) as unknown;
          } catch {
            args = {};
          }
        }
        const argObj: Record<string, unknown> =
          args && typeof args === "object" ? (args as Record<string, unknown>) : {};

        let toolResult = "ok";
        if (name === "read_file") {
          steps.read = true;
          toolResult = currentFile;
        } else if (name === "write_file") {
          steps.wrote = true;
          currentFile = String(argObj.content || "");
          toolResult = "wrote scale.py";
        } else if (name === "edit_file") {
          // Apply the targeted edit to the file we are tracking.
          steps.wrote = true;
          const oldText = String(argObj.old_text ?? "");
          const newText = String(argObj.new_text ?? "");
          if (oldText && currentFile.includes(oldText)) {
            currentFile = currentFile.replace(oldText, newText);
            toolResult = "edited scale.py";
          } else {
            toolResult = "edit failed: old_text not found in scale.py";
          }
        } else if (name === "run_command") {
          steps.ranTests = true;
          const run = await runUnittestFiles(
            { "scale.py": currentFile, "test_scale.py": SCALE_TESTS },
            "test_scale",
            { execute },
          );
          if (run.ran && run.total) {
            testsExecuted = true;
            total = run.total;
            bestPassed = Math.max(bestPassed, run.passed ?? 0);
            lastOutput = run.output;
            toolResult = run.output || `ran ${run.total} tests`;
          } else if (!run.compiled) {
            toolResult = `scale.py failed to compile:\n${run.output}`;
          } else {
            toolResult = "tests could not be executed in this environment";
          }
        } else if (name === "list_directory") {
          toolResult = "scale.py\ntest_scale.py";
        } else if (name === "find_files") {
          toolResult = "scale.py\ntest_scale.py";
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id || "call_0",
          content: toolResult,
        });
      }

      if (testsExecuted && total !== null && bestPassed >= total) break;
    }

    const ratio = total ? bestPassed / total : 0;
    let score: number;
    if (testsExecuted) {
      // Correctness dominates; a little credit for driving the loop at all.
      score =
        (steps.read ? 0.1 : 0) + (steps.wrote ? 0.1 : 0) + (steps.ranTests ? 0.1 : 0) + ratio * 0.7;
    } else {
      // No interpreter (or execute disabled): fall back to process credit only.
      score = (steps.read ? 0.34 : 0) + (steps.wrote ? 0.33 : 0) + (steps.ranTests ? 0.33 : 0);
    }

    const contextUtilization =
      contextWindow && contextWindow > 0 ? peakPromptTokens / contextWindow : null;
    const ctxNote =
      contextUtilization !== null ? `, held ${Math.round(contextUtilization * 100)}% ctx` : "";

    return {
      score: Math.min(1, score),
      summary: stalled
        ? `stalled: ${stalled}`
        : testsExecuted
          ? `${bestPassed}/${total} hidden tests pass in ${turns} turns${ctxNote}`
          : `no tests executed (${[steps.read && "read", steps.wrote && "wrote", steps.ranTests && "ran"].filter(Boolean).join(", ") || "no progress"})`,
      detail: {
        steps,
        turns,
        bestPassed,
        total,
        testsExecuted,
        stalled,
        lastOutput,
        peakPromptTokens,
        contextWindow: contextWindow ?? null,
        contextUtilization,
      },
    };
  },
};

// --------------------------------------------------------- long-horizon code

export const LONG_TASK_PROMPT =
  "Write a complete, working Python implementation of a thread-safe LRU cache with " +
  "per-entry TTL expiry and an eviction callback. Produce these THREE files in full, " +
  "each in its own fenced code block labelled with its filename:\n\n" +
  "1. lru.py - class LRUCache(maxsize, ttl=None, on_evict=None) built on OrderedDict " +
  "and threading.RLock, with:\n" +
  "   - get(key): returns the value and marks it most-recently-used; returns None if " +
  "missing or expired.\n" +
  "   - peek(key): returns the value WITHOUT changing recency; None if missing/expired.\n" +
  "   - put(key, value): inserts/updates; evicts the least-recently-used entry when over " +
  "maxsize.\n" +
  "   - delete(key), clear(), __len__ and __contains__ - all treating expired entries as " +
  "absent.\n" +
  "   - resize(new_maxsize): change the cap, evicting least-recently-used entries if now " +
  "over it.\n" +
  "   - on_evict, when provided, is called with (key, value) for every eviction AND every " +
  "TTL expiry.\n" +
  "2. metrics.py - class Metrics tracking hits, misses, evictions and expirations, with " +
  "snapshot() returning a dict of those four counts and reset() zeroing them.\n" +
  "3. test_lru.py - a unittest suite with at least 12 test methods covering recency/eviction " +
  "order, TTL expiry, peek not changing recency, resize eviction, the on_evict callback, " +
  "delete, clear, __contains__, and concurrent access from threads. It must import from lru " +
  'and metrics and pass when run with "python -m unittest test_lru".\n\n' +
  "Write every file completely. Do not abbreviate or leave placeholders.";

const longHorizonTask: Task = {
  id: "long-horizon",
  category: "Long-horizon code",
  weight: 4,
  description: "Generates a multi-file program that compiles and whose tests pass",
  async run({ chat, execute }) {
    const started = Date.now();
    const response = await chat({
      messages: [{ role: "user", content: LONG_TASK_PROMPT }],
      // Richer spec than before (peek, resize, eviction callback, 12+ tests);
      // give thinking models room to reason and still emit every file.
      max_tokens: 16384,
      temperature: 0.4,
    });
    const elapsedSeconds = (Date.now() - started) / 1000;

    const choice: ChatChoice = response.choices?.[0] || {};
    const message: ChatMessage = choice.message || {};
    const content = message.content || "";
    const reasoning = message.reasoning_content || "";

    if (!content) {
      return {
        score: 0,
        summary: reasoning
          ? `no content - all ${response.usage?.completion_tokens ?? "?"} tokens went to reasoning`
          : "empty response",
        detail: {
          finishReason: choice.finish_reason,
          reasoningChars: reasoning.length,
          outputTokens: response.usage?.completion_tokens ?? null,
        },
      };
    }

    const verification = await verifyPython(content, {
      expectedFiles: ["lru.py", "metrics.py", "test_lru.py"],
      execute,
    });

    // Credit progressive achievement: files present, then compiling, then passing.
    const fileScore = (3 - verification.filesMissing.length) / 3;
    const compileScore = verification.compiled ? 1 : 0;
    let testScore: number | null = 0;
    if (verification.testsRun && verification.testsTotal) {
      testScore = (verification.testsPassed ?? 0) / verification.testsTotal;
    } else if (!execute && verification.compiled) {
      testScore = null; // not measured
    }

    const parts = [fileScore * 0.3, compileScore * 0.3];
    let weightUsed = 0.6;
    if (testScore !== null) {
      parts.push(testScore * 0.4);
      weightUsed = 1.0;
    }
    // Penalise elisions - they defeat the purpose of a long-horizon task.
    const placeholderPenalty = Math.min(0.2, verification.placeholders * 0.1);
    const score = Math.max(0, parts.reduce((a, b) => a + b, 0) / weightUsed - placeholderPenalty);

    const bits = [
      `${3 - verification.filesMissing.length}/3 files`,
      verification.compiled ? "compiles" : "syntax errors",
    ];
    if (verification.testsRun) {
      bits.push(`${verification.testsPassed}/${verification.testsTotal} tests pass`);
    } else if (!execute) {
      bits.push("tests not executed");
    } else if (!verification.compiled) {
      bits.push("tests not run (compile failed)");
    } else if (!verification.testFile) {
      bits.push("no test file produced");
    } else {
      bits.push("tests did not run");
    }
    if (verification.placeholders) bits.push(`${verification.placeholders} placeholders`);

    return {
      score,
      summary: bits.join(", "),
      detail: {
        finishReason: choice.finish_reason,
        outputTokens: response.usage?.completion_tokens ?? null,
        reasoningChars: reasoning.length,
        contentChars: content.length,
        elapsedSeconds,
        tokensPerSecond: response.timings?.predicted_per_second ?? null,
        verification: {
          ...verification,
          testOutput: verification.testOutput ? verification.testOutput.slice(-800) : null,
        },
      },
    };
  },
};

// --------------------------------------------------------- extra-long horizon

/**
 * The hardest task: fix a spec-driven bug in a multi-file codebase whose correct
 * behaviour lives only in the docs. The model must EXPLORE the tree, read the
 * markdown spec, and only then can it produce a fix the hidden oracle accepts -
 * a naive code-only fix passes some tests but misses the two rules documented in
 * docs/SPEC.md (discounts apply to the original subtotal; combined discount is
 * capped at 50%). Reading widely fills context, which the task reports as a
 * fraction of the loaded window. Scored on the real interpreter, never on prose.
 */
const extraLongHorizonTask: Task = {
  id: "extra-long-horizon",
  category: "Extra-long horizon",
  weight: 4,
  description: "Researches a codebase and its docs to fix a spec-driven bug",
  async run({ chat, execute = true, contextWindow }) {
    // The model's editable copy of the Python modules; docs stay read-only.
    const workingCopy = new Map<string, string>();
    for (const file of EXTRA_PY_FILES) workingCopy.set(file, EXTRA_CORPUS[file]);

    const readFile = (path: string): string | null => {
      if (workingCopy.has(path)) return workingCopy.get(path) ?? null;
      return path in EXTRA_CORPUS ? EXTRA_CORPUS[path] : null;
    };
    const listDir = (dir: string): string => {
      const prefix = dir === "." || dir === "" || dir === "/" ? "" : `${dir.replace(/\/+$/, "")}/`;
      const names = new Set<string>();
      for (const path of Object.keys(EXTRA_CORPUS)) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const seg = rest.split("/")[0];
        if (seg) names.add(rest.includes("/") ? `${seg}/` : seg);
      }
      return [...names].sort().join("\n") || "(empty)";
    };

    const messages: ChatRequestMessage[] = [
      {
        role: "user",
        content:
          "The orderkit library prices an order by applying discount rules to a cart subtotal. A " +
          "bug in pricing.py makes large multi-rule discounts wrong - some order totals come out " +
          "too low. The intended behaviour is defined in the project's own documentation, and is " +
          "NOT obvious from the code. Explore the repository (list_directory, read_file, " +
          "search_files, find_files), find and read the specification, then fix pricing.py so it " +
          'matches the spec, and run the tests with "python -m unittest test_pricing". Use your ' +
          "tools for every step; the test files are read-only.",
      },
    ];

    const filesRead = new Set<string>();
    const steps = { explored: false, researched: false, wrote: false, ranTests: false };
    let bestPassed = 0;
    let total: number | null = null;
    let lastOutput = "";
    let testsExecuted = false;
    let peakPromptTokens = 0;
    let turns = 0;
    const maxTurns = 16;
    let stalled: string | null = null;

    while (turns < maxTurns) {
      turns += 1;
      const response = await chat({ messages, tools: TOOLS, max_tokens: 4096, temperature: 0.3 });
      peakPromptTokens = Math.max(peakPromptTokens, response.usage?.prompt_tokens ?? 0);
      const message: ChatMessage = response.choices?.[0]?.message || {};
      const calls = message.tool_calls || [];
      if (!calls.length) {
        if (!message.content) stalled = "produced neither content nor a tool call";
        break;
      }
      messages.push({ role: "assistant", content: message.content || null, tool_calls: calls });

      for (const call of calls) {
        const name = call.function?.name || call.name;
        let args: unknown = call.function?.arguments ?? call.input ?? {};
        if (typeof args === "string") {
          try {
            args = JSON.parse(args) as unknown;
          } catch {
            args = {};
          }
        }
        const a: Record<string, unknown> =
          args && typeof args === "object" ? (args as Record<string, unknown>) : {};
        const cleanPath = (p: unknown): string => String(p ?? "").replace(/^\.?\//, "");

        let toolResult = "ok";
        if (name === "read_file") {
          const path = cleanPath(a.path);
          const content = readFile(path);
          if (content === null) {
            toolResult = `file not found: ${path}`;
          } else {
            filesRead.add(path);
            if (/spec/i.test(path)) steps.researched = true;
            toolResult = content;
          }
        } else if (name === "list_directory") {
          toolResult = listDir(String(a.path ?? "."));
        } else if (name === "find_files") {
          const needle = String(a.pattern ?? "")
            .toLowerCase()
            .replace(/\*/g, "");
          toolResult =
            Object.keys(EXTRA_CORPUS)
              .filter((p) => p.toLowerCase().includes(needle))
              .join("\n") || "(no matches)";
        } else if (name === "search_files") {
          const query = String(a.query ?? "");
          const hits: string[] = [];
          if (query) {
            for (const [path, content] of Object.entries(EXTRA_CORPUS)) {
              content.split("\n").forEach((line, i) => {
                if (line.includes(query)) hits.push(`${path}:${i + 1}: ${line.trim()}`);
              });
            }
          }
          toolResult = hits.slice(0, 40).join("\n") || "(no matches)";
        } else if (name === "write_file") {
          const path = cleanPath(a.path);
          if (/test_/.test(path)) {
            toolResult = "refused: test files are read-only";
          } else {
            workingCopy.set(path, String(a.content ?? ""));
            if (path === EXTRA_TARGET_FILE) steps.wrote = true;
            toolResult = `wrote ${path}`;
          }
        } else if (name === "edit_file") {
          const path = cleanPath(a.path);
          const oldText = String(a.old_text ?? "");
          const newText = String(a.new_text ?? "");
          const current = workingCopy.get(path) ?? EXTRA_CORPUS[path];
          if (/test_/.test(path)) {
            toolResult = "refused: test files are read-only";
          } else if (current && oldText && current.includes(oldText)) {
            workingCopy.set(path, current.replace(oldText, newText));
            if (path === EXTRA_TARGET_FILE) steps.wrote = true;
            toolResult = `edited ${path}`;
          } else {
            toolResult = "edit failed: old_text not found";
          }
        } else if (name === "run_command") {
          steps.ranTests = true;
          const files: Record<string, string> = { "test_pricing.py": EXTRA_HIDDEN_TEST };
          for (const file of EXTRA_PY_FILES)
            files[file] = workingCopy.get(file) ?? EXTRA_CORPUS[file];
          const run = await runUnittestFiles(files, "test_pricing", { execute });
          if (run.ran && run.total) {
            testsExecuted = true;
            total = run.total;
            bestPassed = Math.max(bestPassed, run.passed ?? 0);
            lastOutput = run.output;
            toolResult = run.output || `ran ${run.total} tests`;
          } else if (!run.compiled) {
            toolResult = `code failed to compile:\n${run.output}`;
          } else {
            toolResult = "tests could not be executed in this environment";
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id || "call_0", content: toolResult });
      }

      steps.explored = filesRead.size >= 3;
      if (testsExecuted && total !== null && bestPassed >= total) break;
    }

    const ratio = total ? bestPassed / total : 0;
    let score: number;
    if (testsExecuted) {
      score =
        (steps.explored ? 0.1 : 0) +
        (steps.researched ? 0.1 : 0) +
        (steps.wrote ? 0.05 : 0) +
        (steps.ranTests ? 0.05 : 0) +
        ratio * 0.7;
    } else {
      score =
        (steps.explored ? 0.3 : 0) +
        (steps.researched ? 0.3 : 0) +
        (steps.wrote ? 0.2 : 0) +
        (steps.ranTests ? 0.2 : 0);
    }

    const contextUtilization =
      contextWindow && contextWindow > 0 ? peakPromptTokens / contextWindow : null;
    const ctxNote =
      contextUtilization !== null ? `, held ${Math.round(contextUtilization * 100)}% ctx` : "";

    return {
      score: Math.min(1, score),
      summary: stalled
        ? `stalled: ${stalled}`
        : testsExecuted
          ? `${bestPassed}/${total} tests pass, ${filesRead.size} files read${steps.researched ? "" : " (missed the spec)"}${ctxNote}`
          : `no tests executed (${filesRead.size} files read)`,
      detail: {
        steps,
        turns,
        bestPassed,
        total,
        testsExecuted,
        filesRead: [...filesRead],
        peakPromptTokens,
        contextWindow: contextWindow ?? null,
        contextUtilization,
        stalled,
        lastOutput,
      },
    };
  },
};

// -------------------------------------------------------------- context depth

/** One depth measurement in the context-depth task. */
interface DepthPoint {
  targetTokens: number;
  promptTokens: number | null;
  ttftSeconds: number | null;
  promptPerSecond: number | null;
  generatePerSecond: number | null;
  answered: boolean;
  reasonedOnly: boolean;
}

/**
 * A 400 from llama-server when the prompt is longer than the model's loaded
 * context. That is a limit of how the model was loaded, not a quality failure,
 * so the depth task stops probing rather than zeroing the whole category.
 */
function isContextLimitError(message: string): boolean {
  return /exceed|context|n_ctx|too (?:many|long|large)|larger than/i.test(message);
}

/**
 * Throughput and latency at realistic prompt depth. Agent loops resend large
 * prefixes, so behaviour on an empty context says little about real use.
 */
const contextDepthTask: Task = {
  id: "context-depth",
  category: "Depth scaling",
  weight: 2,
  description: "Holds latency and throughput as the prompt grows",
  async run({ chat, depths = [] }) {
    const filler = (
      "The following is an excerpt from an internal engineering handbook about " +
      "service reliability, retry budgets, idempotency keys and backoff strategy. "
    ).repeat(40);

    // Ascending, so once a depth exceeds the loaded context every deeper probe
    // would too - we stop there and score the depths that fit.
    const ordered = [...depths].sort((a, b) => a - b);
    const points: DepthPoint[] = [];
    let contextLimited = false;
    for (const targetTokens of ordered) {
      // ~4 characters per token is close enough to hit a depth band.
      const repeats = Math.max(1, Math.round((targetTokens * 4) / filler.length));
      const padding = filler.repeat(repeats);

      let response: ChatResponse;
      try {
        response = await chat({
          messages: [
            {
              role: "user",
              content: `Reference material:\n\n${padding}\n\nIn one sentence, what is an idempotency key for?`,
            },
          ],
          // Generous enough that a thinking model still reaches content; this
          // task measures latency and throughput, not answer quality.
          max_tokens: 2048,
          temperature: 0.3,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A prompt past the loaded context ends the probe cleanly; score what
        // fit. Any other error with no measurement yet is a genuine failure.
        if (isContextLimitError(message)) {
          contextLimited = true;
          break;
        }
        if (points.length === 0) throw error;
        break;
      }

      const usage = response.usage || {};
      const timings = response.timings || {};
      const message: ChatMessage = response.choices?.[0]?.message || {};
      const answered = (message.content || "").trim().length > 0;
      const reasonedOnly = !answered && (message.reasoning_content || "").length > 0;
      points.push({
        targetTokens,
        promptTokens: usage.prompt_tokens ?? null,
        ttftSeconds: timings.prompt_ms ? timings.prompt_ms / 1000 : null,
        promptPerSecond: timings.prompt_per_second ?? null,
        generatePerSecond: timings.predicted_per_second ?? null,
        answered,
        reasonedOnly,
      });
    }

    // Even the shallowest probe exceeded the context - nothing measurable.
    if (points.length === 0) {
      return {
        score: 0,
        summary: contextLimited
          ? "every probe depth exceeds the model's loaded context"
          : "no depth measurements",
        detail: points,
      };
    }

    const answeredAll = points.every((p) => p.answered);
    const first = points[0];
    const last = points[points.length - 1];
    // Generation speed should not collapse as context grows; a large drop
    // usually means the KV cache spilled out of VRAM. Retention needs at least
    // two depths to compare - a single fitting depth says nothing about scaling.
    const firstGen = first?.generatePerSecond;
    const lastGen = last?.generatePerSecond;
    const retention = points.length >= 2 && firstGen && lastGen ? lastGen / firstGen : null;

    let score = answeredAll ? 0.5 : 0.2;
    if (retention !== null) score += Math.max(0, Math.min(0.5, retention * 0.5));

    const depthLabel = last.promptTokens?.toLocaleString() ?? "?";
    let summary =
      retention !== null
        ? `${(retention * 100).toFixed(0)}% of throughput retained at ${depthLabel} tokens`
        : `held ${depthLabel} tokens`;
    if (!answeredAll) {
      summary += points.some((p) => p.reasonedOnly)
        ? ", some depths returned only reasoning"
        : ", some depths returned nothing";
    }
    if (contextLimited)
      summary += `, context-limited (${points.length}/${ordered.length} depths fit)`;

    return {
      score: Math.min(1, score),
      summary,
      detail: points,
    };
  },
};

// ---------------------------------------------------------------- concurrency

/**
 * Aggregate throughput with several requests in flight at once — the load a
 * shared host actually sees when multiple chats or a model's own sub-agents hit
 * it together. Reports tokens/sec in (prompt) and out (generation) summed across
 * the concurrent requests; the score is how many returned real content, which
 * also catches reasoning-runaway showing up only under load.
 */
const THROUGHPUT_PROMPT =
  "Explain, in about 200 words, how a hash map resolves collisions, covering " +
  "separate chaining and open addressing and when each is preferable.";

const concurrencyTask: Task = {
  id: "concurrency",
  category: "Concurrency",
  weight: 2,
  description: "Aggregate tokens/sec with several requests in flight at once",
  async run({ chat, concurrency = 3, reasoningBudget }) {
    const n = Math.max(1, concurrency);
    // A thinking model needs room to finish reasoning AND still emit content.
    // Cap the response at 512 and the whole allowance goes to reasoning, so every
    // request comes back empty and this task scores 0% no matter the model. Size
    // the cap above the reasoning budget: the budget (enforced by llama-server's
    // --reasoning-budget) is then what ends thinking, leaving CONTENT_MARGIN
    // tokens for the actual answer. Fall back to a safe cap when the budget is
    // unknown (an arbitrary --endpoint) or thinking is disabled.
    const CONTENT_MARGIN = 512;
    const maxTokens =
      typeof reasoningBudget === "number" && reasoningBudget > 0
        ? reasoningBudget + CONTENT_MARGIN
        : 2048;
    const started = Date.now();
    const responses = await Promise.all(
      Array.from({ length: n }, () =>
        chat({
          messages: [{ role: "user", content: THROUGHPUT_PROMPT }],
          max_tokens: maxTokens,
          temperature: 0.4,
        }).catch((error: Error): ChatResponse => ({ error: error.message })),
      ),
    );
    const wallSeconds = (Date.now() - started) / 1000;

    let promptTokens = 0;
    let genTokens = 0;
    let completed = 0;
    for (const response of responses) {
      if (response.error) continue;
      const usage = response.usage || {};
      promptTokens += usage.prompt_tokens || 0;
      genTokens += usage.completion_tokens || 0;
      if ((response.choices?.[0]?.message?.content || "").trim()) completed += 1;
    }

    const genPerSecond = wallSeconds ? genTokens / wallSeconds : 0;
    const promptPerSecond = wallSeconds ? promptTokens / wallSeconds : 0;

    return {
      score: completed / n,
      summary: `${n} at once: ${genPerSecond.toFixed(0)} gen tok/s, ${promptPerSecond.toFixed(0)} prompt tok/s, ${completed}/${n} answered`,
      detail: {
        concurrency: n,
        maxTokens,
        wallSeconds,
        promptTokens,
        genTokens,
        genPerSecond,
        promptPerSecond,
        completed,
      },
    };
  },
};

export const TASKS: Task[] = [
  toolCallingTask,
  agenticLoopTask,
  longHorizonTask,
  extraLongHorizonTask,
  contextDepthTask,
  concurrencyTask,
];

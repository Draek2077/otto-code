import { verifyPython, verifyToolCall } from "./verify.js";

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
    return {
      score: passed / outcomes.length,
      summary: `${passed}/${outcomes.length} tool calls correct`,
      detail: outcomes,
    };
  },
};

// ------------------------------------------------------------ agentic loop

/**
 * A scripted three-step repair loop. The model must read a file, write a fixed
 * version that actually corrects the bug, then run the tests. Tool results are
 * simulated so every model faces exactly the same environment.
 */
const BUGGY_FILE = `def average(values):
    total = 0
    for value in values:
        total += value
    return total / len(values)


def summarize(values):
    return {
        "count": len(values),
        "average": average(values),
    }
`;

const agenticLoopTask: Task = {
  id: "agentic-loop",
  category: "Agentic loop",
  weight: 3,
  description: "Completes a read-fix-verify cycle across multiple tool turns",
  async run({ chat }) {
    const messages: ChatRequestMessage[] = [
      {
        role: "user",
        content:
          "The function average() in stats.py crashes with ZeroDivisionError when given an " +
          "empty list. Fix it so an empty list returns 0. Read the file first, then write " +
          'the fix, then run the tests with "python -m pytest -q". Use your tools for every step.',
      },
    ];

    const steps = { read: false, wrote: false, fixCorrect: false, ranTests: false };
    let turns = 0;
    const maxTurns = 8;
    let stalled: string | null = null;

    while (turns < maxTurns) {
      turns += 1;
      const response = await chat({ messages, tools: TOOLS, max_tokens: 4096, temperature: 0.3 });
      const message: ChatMessage = response.choices?.[0]?.message || {};
      const calls = message.tool_calls || [];

      if (!calls.length) {
        // No tool call and no content at all is the reasoning-runaway failure.
        if (!message.content) stalled = "produced neither content nor a tool call";
        break;
      }

      messages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: calls,
      });

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
          toolResult = BUGGY_FILE;
        } else if (name === "write_file") {
          steps.wrote = true;
          const content = String(argObj.content || "");
          // The fix must guard the empty case before dividing.
          const guards =
            /if\s+not\s+values|len\(values\)\s*==\s*0|if\s+len\(values\)\s*<\s*1|values\s*==\s*\[\]/.test(
              content,
            );
          const stillDivides = /total\s*\/\s*len\(values\)/.test(content);
          if (guards && stillDivides) steps.fixCorrect = true;
          toolResult = "wrote 1 file";
        } else if (name === "run_command") {
          steps.ranTests = true;
          toolResult = steps.fixCorrect
            ? "3 passed in 0.04s"
            : "1 failed, 2 passed - ZeroDivisionError in average()";
        } else if (name === "list_directory") {
          toolResult = "stats.py\ntest_stats.py";
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id || "call_0",
          content: toolResult,
        });
      }

      if (steps.read && steps.fixCorrect && steps.ranTests) break;
    }

    // Weighted so that actually fixing the bug dominates.
    const score =
      (steps.read ? 0.2 : 0) +
      (steps.wrote ? 0.2 : 0) +
      (steps.fixCorrect ? 0.4 : 0) +
      (steps.ranTests ? 0.2 : 0);

    const done = Object.entries(steps)
      .filter(([, v]) => v)
      .map(([k]) => k);
    return {
      score,
      summary: stalled
        ? `stalled: ${stalled}`
        : `${done.length}/4 steps in ${turns} turns${steps.fixCorrect ? "" : " (fix incorrect)"}`,
      detail: { steps, turns, stalled },
    };
  },
};

// --------------------------------------------------------- long-horizon code

export const LONG_TASK_PROMPT =
  "Write a complete, working Python implementation of a thread-safe LRU cache with " +
  "per-entry TTL expiry. Produce these THREE files in full, each in its own fenced " +
  "code block labelled with its filename:\n\n" +
  "1. lru.py - class LRUCache(maxsize, ttl) with get(key), put(key, value), " +
  "delete(key), clear(), __len__, using OrderedDict and threading.RLock. " +
  "Expired entries must behave as absent. get() returns None for a missing key.\n" +
  "2. metrics.py - class Metrics tracking hits, misses and evictions with a " +
  "snapshot() method returning a dict of those three counts.\n" +
  "3. test_lru.py - a unittest suite with at least 8 test methods covering " +
  "eviction order, TTL expiry, delete, clear, and concurrent access from threads. " +
  'It must import from lru and metrics and pass when run with "python -m unittest test_lru".\n\n' +
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
      max_tokens: 12288,
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

    const points: DepthPoint[] = [];
    for (const targetTokens of depths) {
      // ~4 characters per token is close enough to hit a depth band.
      const repeats = Math.max(1, Math.round((targetTokens * 4) / filler.length));
      const padding = filler.repeat(repeats);

      const response = await chat({
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

    const answeredAll = points.every((p) => p.answered);
    const first = points[0];
    const last = points[points.length - 1];
    // Generation speed should not collapse as context grows; a large drop
    // usually means the KV cache spilled out of VRAM.
    const firstGen = first?.generatePerSecond;
    const lastGen = last?.generatePerSecond;
    const retention = firstGen && lastGen ? lastGen / firstGen : null;

    let score = answeredAll ? 0.5 : 0.2;
    if (retention !== null) score += Math.max(0, Math.min(0.5, retention * 0.5));

    return {
      score: Math.min(1, score),
      summary:
        retention !== null
          ? `${(retention * 100).toFixed(0)}% of throughput retained at ${last.promptTokens?.toLocaleString() ?? "?"} tokens` +
            (answeredAll
              ? ""
              : points.some((p) => p.reasonedOnly)
                ? ", some depths returned only reasoning"
                : ", some depths returned nothing")
          : "timings unavailable",
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
  async run({ chat, concurrency = 3 }) {
    const n = Math.max(1, concurrency);
    const started = Date.now();
    const responses = await Promise.all(
      Array.from({ length: n }, () =>
        chat({
          messages: [{ role: "user", content: THROUGHPUT_PROMPT }],
          max_tokens: 512,
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
  contextDepthTask,
  concurrencyTask,
];

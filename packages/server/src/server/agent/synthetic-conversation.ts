import type { AgentTimelineItem, ToolCallDetail } from "./agent-sdk-types.js";

// ── Seeded PRNG ──────────────────────────────────────────────────────────────
// Mulberry32: cheap 32-bit generator with acceptable avalanche. Deterministic
// for a given seed so the whole conversation is reproducible byte-for-byte.

function mulberry32(seed: number): () => number {
  let state = seed >>> 0; // force unsigned
  return function (): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick an element from `arr` using the PRNG.
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Return a random integer in [min, max] inclusive.
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// Generate a short pseudo-identifier like "auth", "cache_v2", etc.
function makeId(rng: () => number): string {
  const prefixes = [
    "user",
    "data",
    "cache",
    "auth",
    "api",
    "db",
    "config",
    "route",
    "model",
    "view",
  ];
  const suffixes = ["_v1", "_new", "_util", "", "_core", "_handler", "_parser", "_store"];
  return pick(rng, prefixes) + pick(rng, suffixes);
}

// ── Content pools (fragments for composition) ────────────────────────────────
// Each assistant message is assembled from these parts so every output string
// is effectively unique. This avoids the app's markdown-block-height cache,
// which would make a repetitive corpus look artificially fast.

const PARAGRAPH_STARTERS = [
  "Looking at this more closely,",
  "After reviewing the codebase,",
  "The issue here is that",
  "Based on what you've described,",
  "I can see a few problems with the current approach:",
  "There are several ways to handle this.",
  "Let me break down what's happening:",
  "The key insight is that",
  "This pattern comes up often in codebases like yours.",
  "From my analysis,",
];

const PARAGRAPH_MIDDLES = [
  "the function `{id}` doesn't properly handle the case when `{otherId}` returns null.",
  "`{id}` needs to be refactored so that it can be tested in isolation from `{otherId}`.",
  "we're doing an O(n²) lookup inside `{id}` which becomes visible at scale.",
  "the state managed by `{id}` should instead flow through the context provided by `{otherId}`.",
  "`{id}` is catching all errors and silently swallowing them - we need to surface those from `{otherId}`.",
  "there's a race condition between `{id}` and `{otherId}` that only shows up under load.",
  "`{id}` allocates a new buffer each time, but it could reuse the one from `{otherId}`.",
];

const PARAGRAPH_ENDINGS = [
  "I'd recommend starting with the simplest fix first.",
  "Let me write out a concrete example below.",
  "Here's what I think we should do about it.",
  "The fix is straightforward but requires changes in a few places.",
  "We can address this in two steps, which I'll detail next.",
];

const LIST_ITEM_TEMPLATES = [
  "Update `{id}` to use strict typing",
  "Add validation for the `{otherId}` input",
  "Refactor `{id}` into smaller functions",
  "Cache results from `{otherId}` with a TTL of `{num}s",
  "Add unit tests covering edge cases in `{id}`",
  "Handle the error path when `{otherId}` throws",
  "Extract `{id}` into its own module for testability",
  "Replace the synchronous call to `{otherId}` with an async version",
  "Log metrics from `{id}` every `{num}ms",
  "Add a retry wrapper around `{otherId}` with exponential backoff",
  "Migrate `{id}` to use the new SDK",
  "Remove dead code path in `{otherId}`",
  "Increase the timeout for `{id}` to `{num}s",
  "Add input sanitization before passing data to `{otherId}`",
];

const HEADING_TEMPLATES = [
  "## Analysis of `{id}`",
  "## Proposed Changes for `{otherId}`",
  "## Implementation Plan",
  "## Performance Bottleneck in `{id}`",
  "## Migration Steps",
  "## Root Cause: `{id}`",
  "## Next Steps",
];

const CODE_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "sql",
  "rust",
  "bash",
  "css",
] as const;
type CodeLang = (typeof CODE_LANGUAGES)[number];

// ── User prompts ─────────────────────────────────────────────────────────────

const USER_PROMPTS = [
  "Can you help me fix this bug in my authentication module?",
  "I need to add rate limiting to these API endpoints.",
  "How do I refactor this component to use React hooks?",
  "Please write a test for the user registration flow.",
  "Can you explain why this TypeScript type is failing?",
  "I want to migrate from class components to function components.",
  "Help me optimize this database query - it's running slow in production.",
  "What's the best way to handle file uploads in Express?",
  "Can you add error handling to these API routes?",
  "Please implement a caching layer for the product catalog.",
  "I need to add logging throughout this service.",
  "How can I make this code more testable?",
  "Can you help me set up CI/CD for this project?",
  "Let's add input validation to all these endpoints.",
  "I'm getting a memory leak somewhere - can you help find it?",
  "Please write documentation for the public API.",
  "Can you implement OAuth2 login with Google as the provider?",
  "How do I properly type this GraphQL resolver?",
  "Let's add dark mode support to the dashboard.",
  "I need a pagination component that works with infinite scroll.",
];

// ── Compositional message builders ───────────────────────────────────────────

function fillTemplate(rng: () => number, template: string): string {
  // Replace {id}, {otherId}, and {num} placeholders with rng-derived values.
  return template
    .replace(/{id}/g, makeId(rng))
    .replace(/{otherId}/g, makeId(rng))
    .replace(/{num}/g, String(randInt(rng, 1, 999)));
}

function buildParagraph(rng: () => number): string {
  // Each paragraph = starter + (optional middle) + ending.
  let text = pick(rng, PARAGRAPH_STARTERS);
  if (rng() > 0.3) {
    text += " " + pick(rng, PARAGRAPH_MIDDLES);
  }
  text += " " + pick(rng, PARAGRAPH_ENDINGS);
  return fillTemplate(rng, text);
}

function buildBulletList(rng: () => number): string {
  const count = randInt(rng, 2, 9);
  // Deduplicate items within this list.
  const used = new Set<string>();
  const lines: string[] = [];
  let attempts = 0;
  while (lines.length < count && attempts < 50) {
    attempts++;
    const item = fillTemplate(rng, pick(rng, LIST_ITEM_TEMPLATES));
    if (!used.has(item)) {
      used.add(item);
      lines.push("- " + item);
    }
  }
  return lines.join("\n");
}

function buildNumberedList(rng: () => number): string {
  const count = randInt(rng, 2, 6);
  const items = [
    "Profile the current implementation with `perf` to identify hot paths",
    "Add integration tests covering the critical user flows",
    "Set up monitoring and alerting for the new deployment",
    "Write a migration script that can be rolled back safely",
    "Update the API documentation to reflect the changes",
    "Run load testing with at least `{num}` concurrent users",
  ];
  const lines: string[] = [];
  let idx = 1;
  for (let i = 0; i < count && i < items.length; i++) {
    lines.push(`${idx}. ${fillTemplate(rng, items[i])}`);
    idx++;
  }
  return lines.join("\n");
}

function buildCodeBlock(rng: () => number): string {
  const lang = pick(rng, CODE_LANGUAGES);
  const code = generateSnippet(rng, lang);
  return `\`\`\`${lang}\n${code}\n\`\`\``;
}

// Generate a varied-length code snippet with unique identifiers.
function generateSnippet(rng: () => number, lang: CodeLang): string {
  const id1 = makeId(rng);
  const id2 = makeId(rng);
  const id3 = makeId(rng);
  const n = randInt(rng, 50, 999);
  const m = randInt(rng, 3, 40); // target line count range

  switch (lang) {
    case "typescript":
      return buildTsSnippet(rng, id1, id2, id3, n, m);
    case "javascript":
      return buildJsSnippet(rng, id1, id2, id3, n, m);
    case "python":
      return buildPySnippet(rng, id1, id2, id3, n, m);
    case "sql":
      return buildSqlSnippet(rng, id1, id2, id3, n, m);
    case "rust":
      return buildRustSnippet(rng, id1, id2, id3, n, m);
    case "bash":
      return buildBashSnippet(rng, id1, id2, id3, n, m);
    case "css":
      return buildCssSnippet(rng, id1, id2, id3, n, m);
  }
}

function buildTsSnippet(
  _rng: () => number,
  id1: string,
  id2: string,
  id3: string,
  n: number,
  targetLines: number,
): string {
  const lines: string[] = [];
  lines.push(`interface ${capitalize(id1)}Config {`);
  lines.push(`  enabled: boolean;`);
  lines.push(`  maxRetries: number;`);
  lines.push(`  timeoutMs: number;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`class ${capitalize(id1)}Service {`);
  lines.push(`  private config: ${capitalize(id1)}Config;`);
  lines.push(`  private readonly cache = new Map<string, ReturnType<typeof ${id2}>>();`);
  lines.push(``);
  lines.push(`  constructor(config: Partial<${capitalize(id1)}Config> = {}) {`);
  lines.push(`    this.config = { maxRetries: 3, timeoutMs: ${n}, ...config };`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  async process(input: string): Promise<${capitalize(id2)}Result> {`);
  lines.push(`    const cached = this.cache.get(input);`);
  lines.push(`    if (cached) return cached;`);
  lines.push(``);
  lines.push(`    const result = await ${id3}(input, { timeout: this.config.timeoutMs });`);
  lines.push(`    this.cache.set(input, result);`);
  lines.push(`    return result;`);
  lines.push(`  }`);
  lines.push(`}`);

  // Pad or trim to target length.
  while (lines.length < targetLines) {
    const extra = `  private ${makeId(_rng)}_${_rng() > 0.5 ? "internal" : "private"}(): void { /* step ${lines.length} */ }`;
    lines.splice(12, 0, extra); // insert inside class body
  }
  return lines.slice(0, Math.max(targetLines, 8)).join("\n");
}

function buildJsSnippet(
  _rng: () => number,
  id1: string,
  id2: string,
  _id3: string,
  n: number,
  targetLines: number,
): string {
  const lines: string[] = [];
  lines.push(`// ${id1}: utility for managing ${id2} state`);
  lines.push(`function create${capitalize(id1)}Manager(options) {`);
  lines.push(`  const state = { items: [], buffer: new Uint8Array(${n}) };`);
  lines.push(``);
  lines.push(`  function add(item) {`);
  lines.push(`    if (!item || typeof item !== 'object') throw new Error('Invalid');`);
  lines.push(`    state.items.push({ ...item, addedAt: Date.now() });`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  function remove(predicate) {`);
  lines.push(`    const before = state.items.length;`);
  lines.push(`    state.items = state.items.filter(item => !predicate(item));`);
  lines.push(`    return before - state.items.length;`);
  lines.push(`  }`);

  while (lines.length < targetLines) {
    const fnName = makeId(_rng);
    lines.push(``);
    lines.push(`  function ${fnName}() {`);
    lines.push(`    // computed property for ${id2}`);
    lines.push(`    return state.items.reduce((acc, item) => acc + (item.weight || 0), 0);`);
    lines.push(`  }`);
  }
  lines.push(``);
  lines.push(`  return { add, remove, state };`);
  lines.push(`}`);
  return lines.slice(0, Math.max(targetLines, 6)).join("\n");
}

function buildPySnippet(
  _rng: () => number,
  id1: string,
  id2: string,
  _id3: string,
  n: number,
  targetLines: number,
): string {
  const lines: string[] = [];
  lines.push(`"""${capitalize(id1)} module - handles ${id2} processing."""`);
  lines.push(`from typing import Iterator`);
  lines.push(`import time`);
  lines.push(``);
  lines.push(`class ${capitalize(id1)}Processor:`);
  lines.push(`    """Processes batches of data with configurable retry logic."""`);
  lines.push(``);
  lines.push(`    def __init__(self, batch_size: int = ${n}):`);
  lines.push(`        self.batch_size = batch_size`);
  lines.push(`        self._metrics: dict[str, list[float]] = {}`);
  lines.push(``);
  lines.push(`    def process_batch(self, items: list[dict]) -> Iterator[dict]:`);
  lines.push(`        start = time.monotonic()`);
  lines.push(`        for chunk in _chunks(items, self.batch_size):`);
  lines.push(`            yield from map(self._transform, chunk)`);

  while (lines.length < targetLines) {
    const fnName = makeId(_rng);
    lines.push(``);
    lines.push(`    def ${fnName}(self, data: dict) -> float:`);
    lines.push(`        """Derived metric computation."""`);
    lines.push(`        return sum(data.values()) / max(len(data), 1)`);
  }

  lines.push(``);
  lines.push(`def _chunks(seq, size):`);
  lines.push(`    for i in range(0, len(seq), size):`);
  lines.push(`        yield seq[i:i + size]`);
  return lines.slice(0, Math.max(targetLines, 8)).join("\n");
}

function buildSqlSnippet(
  _rng: () => number,
  id1: string,
  id2: string,
  _id3: string,
  n: number,
  targetLines: number,
): string {
  const tables = [id1.replace(/_/g, "_"), id2.replace(/_/g, "_")];
  const lines: string[] = [];
  lines.push(`-- Query: aggregate ${tables[0]} metrics grouped by status`);
  lines.push(`SELECT`);
  lines.push(`    t1.id,`);
  lines.push(`    t1.status,`);
  lines.push(`    COUNT(t2.id) AS related_count,`);
  lines.push(`    SUM(t2.amount) AS total_amount`);
  lines.push(`FROM ${tables[0]} t1`);
  lines.push(`LEFT JOIN ${tables[1]} t2 ON t1.id = t2.${tables[0]}_id`);
  lines.push(`WHERE t1.created_at >= NOW() - INTERVAL '${n} days'`);
  lines.push(`GROUP BY t1.id, t1.status`);
  lines.push(`HAVING COUNT(t2.id) > ${Math.max(1, Math.floor(n / 10))}`);
  lines.push(`ORDER BY total_amount DESC`);

  while (lines.length < targetLines) {
    const alias = makeId(_rng).substring(0, 4);
    lines.splice(3, 0, `    t1.${alias} AS ${alias},`);
  }
  return lines.slice(0, Math.max(targetLines, 6)).join("\n");
}

function buildRustSnippet(
  _rng: () => number,
  id1: string,
  _id2: string,
  _id3: string,
  n: number,
  targetLines: number,
): string {
  const lines: string[] = [];
  lines.push(`/// Configuration for ${id1}.`);
  lines.push(`struct ${capitalize(id1)}Config {`);
  lines.push(`    max_retries: u32,`);
  lines.push(`    timeout_ms: u64,`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`impl ${capitalize(id1)}Config {`);
  lines.push(`    fn new() -> Self {`);
  lines.push(`        Self { max_retries: ${n}, timeout_ms: ${n * 10} }`);
  lines.push(`    }`);
  lines.push(`}`);

  while (lines.length < targetLines) {
    const field = makeId(_rng);
    lines.splice(2, 0, `    ${field}: String,`);
  }

  return lines.slice(0, Math.max(targetLines, 5)).join("\n");
}

function buildBashSnippet(
  _rng: () => number,
  id1: string,
  _id2: string,
  _id3: string,
  n: number,
  targetLines: number,
): string {
  const lines: string[] = [];
  lines.push(`#!/bin/bash`);
  lines.push(`set -euo pipefail`);
  lines.push(``);
  lines.push(`echo "Starting ${id1} pipeline..."`);
  lines.push(`TEMP_DIR=$(mktemp -d)`);
  lines.push(`trap 'rm -rf "$TEMP_DIR"' EXIT`);

  let step = 1;
  while (lines.length < targetLines) {
    const action = makeId(_rng);
    lines.push(`echo "Step ${step}: processing ${action}"`);
    lines.push(`sleep ${(n % 5) + 1}`);
    step++;
  }

  lines.push(`echo "Done - generated ${n} artifacts."`);
  return lines.slice(0, Math.max(targetLines, 6)).join("\n");
}

function buildCssSnippet(
  _rng: () => number,
  id1: string,
  _id2: string,
  _id3: string,
  n: number,
  targetLines: number,
): string {
  const lines: string[] = [];
  lines.push(`.${id1} {`);
  lines.push(`  display: grid;`);
  lines.push(`  gap: ${(n % 20) + 4}px;`);

  let propIdx = 0;
  const props = [
    "padding",
    "margin",
    "border-radius",
    "font-size",
    "line-height",
    "background",
    "color",
    "opacity",
    "z-index",
    "min-width",
    "max-height",
    "transition",
    "transform",
    "box-shadow",
    "overflow",
  ];

  while (lines.length < targetLines) {
    const prop = props[propIdx % props.length];
    lines.push(`  ${prop}: var(--${id1}-${prop}, auto);`);
    propIdx++;
  }

  lines.push(`}`);
  return lines.slice(0, Math.max(targetLines, 4)).join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Tool call helpers ────────────────────────────────────────────────────────

const TOOL_CALL_NAMES = [
  "ReadFile",
  "WriteFile",
  "EditFile",
  "SearchFiles",
  "GrepSearch",
  "RunCommand",
  "ListDirectory",
] as const;

function makeToolCallDetail(rng: () => number): ToolCallDetail {
  // Weighted toward read/edit/search - those are the common ones.
  const r = rng();
  if (r < 0.3) {
    return {
      type: "read",
      filePath: pick(rng, [
        `src/${makeId(rng)}/index.tsx`,
        `src/utils/${makeId(rng)}.ts`,
        `tests/${makeId(rng)}.test.ts`,
        `package.json`,
        `config/${makeId(rng)}.json`,
      ]),
      content: `// File for ${makeId(rng)}\nexport const ${makeId(rng)} = "${pick(rng, ["hello", "world", "test"])}";`,
    };
  }
  if (r < 0.5) {
    return {
      type: "edit",
      filePath: `src/${makeId(rng)}/${makeId(rng)}.ts`,
      oldString: `const ${makeId(rng)} = null;`,
      newString: `const ${makeId(rng)}: string | null = process.env.${makeId(rng).toUpperCase()} ?? null;`,
    };
  }
  if (r < 0.7) {
    return {
      type: "shell",
      command: pick(rng, ["npm run build", "npx tsc --noEmit", "git status", "npm test"]),
      exitCode: rng() > 0.2 ? 0 : null,
      output: `Done in ${randInt(rng, 1, 30)}.${String(randInt(rng, 0, 9)).padStart(2, "0")}s.`,
    };
  }
  if (r < 0.85) {
    return {
      type: "search",
      query: pick(rng, ["useEffect", "RateLimiter", "interface User", "export const"]),
      numFiles: randInt(rng, 3, 25),
      durationMs: randInt(rng, 10, 200),
    };
  }
  return {
    type: "write",
    filePath: `src/${makeId(rng)}/${makeId(rng)}.ts`,
    content: "// Generated file\nexport function init() {}\n",
  };
}

// ── Assistant message builder (combinatorial) ────────────────────────────────

function buildAssistantMessage(rng: () => number): string {
  // Build a realistic assistant reply from composed parts.
  // Structure: optional heading → paragraphs → optional list → optional code block → closing paragraph.
  const parts: string[] = [];

  // Optional heading (40% chance).
  if (rng() < 0.4) {
    parts.push(fillTemplate(rng, pick(rng, HEADING_TEMPLATES)));
  }

  // Opening paragraphs (1–3).
  const paraCount = randInt(rng, 1, 3);
  for (let i = 0; i < paraCount; i++) {
    parts.push(buildParagraph(rng));
  }

  // Optional list - bullet or numbered (50% chance).
  if (rng() < 0.5) {
    parts.push(rng() > 0.4 ? buildBulletList(rng) : buildNumberedList(rng));
  }

  // Code block (60% of messages get one).
  if (rng() < 0.6) {
    parts.push(buildCodeBlock(rng));
  }

  // Closing paragraph (30% chance).
  if (rng() < 0.3) {
    parts.push(
      "Let me know if you need any further changes or have questions about this approach.",
    );
  }

  return parts.join("\n\n");
}

// ── Reasoning block builder ──────────────────────────────────────────────────

function buildReasoning(rng: () => number): string {
  const edgeCases = [
    "null inputs",
    "empty arrays",
    "race conditions",
    "type mismatches",
    "memory leaks",
  ];
  return `Thinking... I need to analyze this problem step by step.\n\nFirst, let me understand the core issue with ${makeId(rng)}. Then I'll look at the codebase to find the relevant files and determine the best approach. This involves checking for edge cases like ${pick(rng, edgeCases)} and considering performance implications of each option.`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Options for deterministic synthetic conversation generation.
 */
export interface SyntheticConversationOptions {
  /** Seed value controlling all pseudo-random choices. */
  seed: number;
  /** Exact number of timeline items to generate. */
  itemCount: number;
}

/**
 * Generate a deterministic array of fake-but-realistic agent timeline items.
 *
 * Same `seed` + `itemCount` always produces byte-identical output. No wall-clock
 * or non-deterministic APIs are used.
 */
export function generateSyntheticConversation(
  options: SyntheticConversationOptions,
): AgentTimelineItem[] {
  const rng = mulberry32(options.seed);
  const items: AgentTimelineItem[] = [];

  // We always start with a user message and end up with exactly itemCount items.
  // The planner decides the sequence structure: user messages kick off turns,
  // then we fill with assistant/tool/thinking content until we hit the budget.

  let nextCallId = 0;

  function addToolCalls(count: number): void {
    for (let i = 0; i < count; i++) {
      if (items.length >= options.itemCount) return;
      const callId = `call_${nextCallId++}`;

      // Use literal types so each branch matches the discriminated union exactly.
      if (rng() > 0.15) {
        items.push({
          type: "tool_call",
          callId,
          name: pick(rng, TOOL_CALL_NAMES),
          detail: makeToolCallDetail(rng),
          status: "completed" as const,
          error: null,
        });
      } else {
        items.push({
          type: "tool_call",
          callId,
          name: pick(rng, TOOL_CALL_NAMES),
          detail: makeToolCallDetail(rng),
          status: "failed" as const,
          error: pick(rng, ["ECONNREFUSED", "ENOENT", "ETIMEDOUT"]),
        });
      }
    }
  }

  // Build the conversation turn by turn.
  while (items.length < options.itemCount) {
    // User message to kick off a turn - or whenever there's room for another prompt.
    if (items.length === 0 || rng() < 0.15) {
      items.push({
        type: "user_message",
        text: pick(rng, USER_PROMPTS),
      });
      continue;
    }

    // Occasionally insert reasoning before the assistant speaks.
    if (rng() < 0.12) {
      items.push({
        type: "reasoning",
        text: buildReasoning(rng),
      });
      if (items.length >= options.itemCount) break;
    }

    // Assistant message - always present in a turn after the user prompt.
    items.push({
      type: "assistant_message",
      text: buildAssistantMessage(rng),
    });

    if (items.length >= options.itemCount) break;

    // Tool calls happen in bursts of 3–8, but only when there's room.
    if (rng() < 0.5) {
      const remaining = options.itemCount - items.length;
      const burstSize = Math.min(randInt(rng, 3, 8), remaining);
      addToolCalls(burstSize);
    } else if (rng() < 0.4) {
      // Smaller tool call cluster - 1 or 2.
      const remaining = options.itemCount - items.length;
      const burstSize = Math.min(randInt(rng, 1, 2), remaining);
      addToolCalls(burstSize);
    }
  }

  return items.slice(0, options.itemCount);
}

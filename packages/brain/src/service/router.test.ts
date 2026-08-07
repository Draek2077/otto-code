import { test } from "vitest";
import assert from "node:assert/strict";

import {
  analyse,
  Telemetry,
  describeModel,
  buildModelList,
  decideModelGate,
  type TelemetryRecord,
} from "./router.js";
import type { Model } from "../types.js";
import type { Profile } from "../config/schema.js";
import type { Supervisor } from "./supervisor.js";

test("detects the reasoning-only failure in an Anthropic response", () => {
  const body = JSON.stringify({
    stop_reason: "max_tokens",
    usage: { output_tokens: 8192 },
    content: [{ type: "thinking", thinking: "x".repeat(30164) }],
  });
  const result = analyse(body)!;

  assert.equal(result.verdict, "reasoning-only");
  assert.equal(result.contentChars, 0);
  assert.equal(result.reasoningChars, 30164);
  assert.equal(result.outputTokens, 8192);
});

test("detects the reasoning-only failure in an OpenAI response", () => {
  const body = JSON.stringify({
    choices: [
      { finish_reason: "length", message: { content: "", reasoning_content: "y".repeat(500) } },
    ],
    usage: { completion_tokens: 8192 },
  });
  assert.equal(analyse(body)!.verdict, "reasoning-only");
});

test("a healthy response with content is ok even after long reasoning", () => {
  const body = JSON.stringify({
    stop_reason: "end_turn",
    usage: { output_tokens: 5624 },
    content: [
      { type: "thinking", thinking: "z".repeat(6215) },
      { type: "text", text: "a".repeat(16438) },
    ],
  });
  const result = analyse(body)!;

  assert.equal(result.verdict, "ok");
  assert.equal(result.contentChars, 16438);
  assert.equal(result.reasoningChars, 6215);
});

test("tool calls count as delivered output, not a stall", () => {
  const body = JSON.stringify({
    stop_reason: "tool_use",
    usage: { output_tokens: 2838 },
    content: [
      { type: "thinking", thinking: "w".repeat(5996) },
      { type: "tool_use", id: "t1", name: "write_file", input: {} },
    ],
  });
  const result = analyse(body)!;

  assert.equal(result.verdict, "ok", "a tool call is useful output");
  assert.equal(result.toolCalls, 1);
});

test("truncation is distinguished from reasoning-only", () => {
  const body = JSON.stringify({
    choices: [{ finish_reason: "length", message: { content: "partial output" } }],
    usage: { completion_tokens: 4096 },
  });
  assert.equal(analyse(body)!.verdict, "truncated");
});

test("unparseable or unrecognised bodies yield null", () => {
  assert.equal(analyse("not json"), null);
  assert.equal(analyse(JSON.stringify({ unexpected: true })), null);
});

test("describeModel reports the friendly name, not the file path", () => {
  const model = {
    id: "qwen/Qwen3-4B-Thinking-2507-Q4_K_M.gguf",
    displayName: "Qwen3-4B-Thinking-2507-Q4_K_M",
    modelPath: "C:\\Users\\x\\.lmstudio\\models\\qwen\\Qwen3-4B-Thinking-2507-Q4_K_M.gguf",
    quant: "Q4_K_M",
    publisher: "qwen",
    mmprojPath: null,
    metadata: { arch: "qwen3", contextLength: 262144 },
  } as unknown as Model;

  const entry = describeModel(model, {
    state: "loaded",
    profile: { contextSize: 32768 } as Profile,
    createdAt: new Date("2026-07-29T00:00:00Z"),
  });
  assert.equal(entry.id, "qwen/Qwen3-4B-Thinking-2507-Q4_K_M.gguf");
  assert.equal(entry.name, "Qwen3-4B-Thinking-2507-Q4_K_M");
  assert.equal(entry.arch, "qwen3");
  assert.equal(entry.quantization, "Q4_K_M");
  assert.equal(entry.type, "llm");
  assert.equal(entry.state, "loaded");
  assert.equal(entry.max_context_length, 262144);
  assert.equal(entry.loaded_context_length, 32768);
});

test("describeModel reports catalog reasoning efforts", () => {
  const entry = describeModel({
    id: "gpt-oss-20b.gguf",
    displayName: "gpt-oss-20B",
    quant: "MXFP4",
    publisher: "ggml-org",
    mmprojPath: null,
    metadata: {},
    reasoningEfforts: ["low", "medium", "high"],
  } as unknown as Model);
  assert.deepEqual(entry.reasoning_efforts, ["low", "medium", "high"]);
});

test("describeModel reports the per-request window when slots split the context", () => {
  const model = {
    displayName: "M",
    quant: "Q4_K_M",
    publisher: "p",
    mmprojPath: null,
    metadata: { contextLength: 262144 },
  } as unknown as Model;
  const entry = describeModel(model, {
    state: "loaded",
    profile: { contextSize: 32768, parallelSlots: 4 } as Profile,
  });
  assert.equal(entry.loaded_context_length, 8192, "32768 / 4 slots = 8192 per request");
  assert.equal(entry.max_context_length, 262144, "native max is unchanged");
});

test("describeModel omits loaded context for models that are not loaded", () => {
  const model = {
    displayName: "M",
    quant: "Q8_0",
    publisher: "p",
    mmprojPath: "/x/mmproj.gguf",
    metadata: {},
  } as unknown as Model;
  const entry = describeModel(model, {
    state: "not-loaded",
    profile: { contextSize: 8192 } as Profile,
  });
  assert.equal(entry.state, "not-loaded");
  assert.equal(entry.type, "vlm", "a paired projector makes it a vision model");
  assert.equal(entry.loaded_context_length, undefined);
});

test("describeModel returns null when there is no model", () => {
  assert.equal(describeModel(null), null);
});

test("buildModelList lists the whole catalog, marking the running one loaded", () => {
  const a = {
    id: "a/x.gguf",
    displayName: "Model-A",
    quant: "Q4_K_M",
    publisher: "a",
    mmprojPath: null,
    metadata: { arch: "qwen3", contextLength: 262144 },
  } as unknown as Model;
  const b = {
    id: "b/y.gguf",
    displayName: "Model-B",
    quant: "Q8_0",
    publisher: "b",
    mmprojPath: null,
    metadata: { arch: "llama", contextLength: 131072 },
  } as unknown as Model;
  const supervisor = {
    state: "ready",
    startedAt: new Date("2026-07-29T00:00:00Z"),
    model: b,
    profile: { contextSize: 16384 },
  } as unknown as Supervisor;

  const list = buildModelList(supervisor, () => [a, b]);
  assert.deepEqual(
    list.map((e) => e.id),
    ["a/x.gguf", "b/y.gguf"],
    "every model is listed",
  );
  const byId = Object.fromEntries(list.map((e) => [e.id, e]));
  assert.equal(byId["a/x.gguf"].name, "Model-A");
  assert.equal(byId["a/x.gguf"].state, "not-loaded");
  assert.equal(byId["a/x.gguf"].loaded_context_length, undefined);
  assert.equal(byId["b/y.gguf"].name, "Model-B");
  assert.equal(byId["b/y.gguf"].state, "loaded");
  assert.equal(
    byId["b/y.gguf"].loaded_context_length,
    16384,
    "the loaded model reports its running window",
  );
});

test("buildModelList still includes the running model if the catalog snapshot lacks it", () => {
  const running = {
    id: "r/z.gguf",
    displayName: "Runner",
    quant: "Q4_K_M",
    publisher: "r",
    mmprojPath: null,
    metadata: {},
  } as unknown as Model;
  const supervisor = {
    state: "ready",
    startedAt: null,
    model: running,
    profile: { contextSize: 4096 },
  } as unknown as Supervisor;
  const list = buildModelList(supervisor, () => []); // empty snapshot
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "r/z.gguf");
  assert.equal(list[0].name, "Runner");
  assert.equal(list[0].state, "loaded");
});

test("buildModelList returns an empty list when nothing is found or loaded", () => {
  assert.deepEqual(
    buildModelList({ state: "stopped", model: null } as unknown as Supervisor, () => []),
    [],
  );
});

const PINNED = { id: "pin/a.gguf", displayName: "Model-A" } as unknown as Model;
const OTHER = { id: "oth/b.gguf", displayName: "Model-B" } as unknown as Model;

test("lock off: a named model resolves through normally", () => {
  const gate = decideModelGate({
    lockModel: false,
    requestedName: "Model-B",
    pinned: null,
    resolved: OTHER,
  });
  assert.deepEqual(gate, { ok: true, model: OTHER });
});

test("lock off: an unresolved named model is a 404", () => {
  const gate = decideModelGate({
    lockModel: false,
    requestedName: "ghost",
    pinned: null,
    resolved: null,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.ok === false && gate.status, 404);
});

test("lock on: a request for the pinned model is served", () => {
  const gate = decideModelGate({
    lockModel: true,
    requestedName: "Model-A",
    pinned: PINNED,
    resolved: null,
  });
  assert.deepEqual(gate, { ok: true, model: PINNED });
});

test("lock on: an unnamed request rides the pinned model", () => {
  const gate = decideModelGate({
    lockModel: true,
    requestedName: null,
    pinned: PINNED,
    resolved: null,
  });
  assert.deepEqual(gate, { ok: true, model: PINNED });
});

test("lock on: a request for a different model is refused with 409", () => {
  const gate = decideModelGate({
    lockModel: true,
    requestedName: "Model-B",
    pinned: PINNED,
    resolved: null,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.ok === false && gate.status, 409);
  assert.match(gate.ok === false ? gate.message : "", /switching is disabled/);
});

test("lock on: nothing pinned yet yields a 503, not a switch", () => {
  const gate = decideModelGate({
    lockModel: true,
    requestedName: "Model-A",
    pinned: null,
    resolved: null,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.ok === false && gate.status, 503);
});

test("telemetry warns once reasoning-only responses dominate", () => {
  const t = new Telemetry();
  assert.equal(t.warning, null, "no advice from too little data");

  for (let i = 0; i < 4; i += 1) t.record({ verdict: "reasoning-only" });
  t.record({ verdict: "ok" });

  assert.equal(t.totals.requests, 5);
  assert.equal(t.totals.reasoningOnly, 4);
  assert.match(t.warning!, /lower the reasoning budget/);
});

test("telemetry warns about client-side token limits", () => {
  const t = new Telemetry();
  for (let i = 0; i < 4; i += 1) t.record({ verdict: "truncated" });
  assert.match(t.warning!, /max_tokens/);
});

test("a healthy stream of requests produces no warning", () => {
  const t = new Telemetry();
  for (let i = 0; i < 10; i += 1) t.record({ verdict: "ok" });
  assert.equal(t.warning, null);
  assert.equal(t.totals.ok, 10);
});

test("telemetry keeps only the most recent records", () => {
  type NumberedRecord = TelemetryRecord & { n: number };
  const t = new Telemetry(5);
  for (let i = 0; i < 12; i += 1) t.record({ verdict: "ok", n: i } as NumberedRecord);
  assert.equal(t.records.length, 5);
  assert.equal((t.records[4] as NumberedRecord).n, 11);
  assert.equal(t.totals.requests, 12, "totals still count everything");
});

import { test } from "vitest";
import assert from "node:assert/strict";

import http from "node:http";
import { EventEmitter } from "node:events";
import net from "node:net";

import {
  analyse,
  Telemetry,
  completionShape,
  createRouter,
  createSlotEraser,
  describeModel,
  buildModelList,
  decideModelGate,
  applyModelReasoningTemplate,
  injectSystemAddendum,
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

test("describeModel reports catalog reasoning efforts and their native default", () => {
  const entry = describeModel({
    id: "gpt-oss-20b.gguf",
    displayName: "gpt-oss-20B",
    quant: "MXFP4",
    publisher: "ggml-org",
    mmprojPath: null,
    metadata: {},
    reasoningEfforts: ["low", "medium", "high"],
    reasoningEffortDefault: "medium",
  } as unknown as Model);
  assert.deepEqual(entry.reasoning_efforts, ["low", "medium", "high"]);
  assert.equal(entry.reasoning_effort_default, "medium");
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

test("describeModel reports the extended YaRN maximum for the loaded profile", () => {
  const model = {
    displayName: "Muse",
    quant: "IQ3_M",
    publisher: "Unsloth",
    mmprojPath: null,
    metadata: { contextLength: 131072 },
  } as unknown as Model;
  const entry = describeModel(model, {
    state: "loaded",
    profile: { contextSize: 524288, contextMultiplier: 4 } as Profile,
  });
  assert.equal(entry.max_context_length, 524288);
  assert.equal(entry.loaded_context_length, 524288);
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

test("lock on: every model in the configured resident set is served", () => {
  const gate = decideModelGate({
    lockModel: true,
    requestedName: "Model-B",
    pinned: null,
    pinnedModels: [PINNED, OTHER],
    resolved: null,
  });
  assert.deepEqual(gate, { ok: true, model: OTHER });
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

/** Round-trip helper: the injector takes and returns a serialized body. */
function inject(
  body: unknown,
  addendum: string | null,
  shape: "anthropic" | "openai",
): Record<string, unknown> {
  const out = injectSystemAddendum(Buffer.from(JSON.stringify(body), "utf8"), addendum, shape);
  return JSON.parse(out.toString("utf8")) as Record<string, unknown>;
}

test("maps a native model's effort choices onto its template arguments", () => {
  const model = {
    id: "qwen3.8",
    displayName: "Qwen3.8",
    modelPath: "/models/qwen.gguf",
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q4_K_M",
    sizeBytes: 0,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: null,
    reasoningEfforts: ["low", "medium", "xhigh"],
    reasoningTemplate: {
      enableThinkingArgument: "enable_thinking",
      effortArgument: "reasoning_effort",
    },
  } satisfies Model;

  const high = applyModelReasoningTemplate(
    Buffer.from(JSON.stringify({ model: model.id, reasoning_effort: "xhigh" })),
    model,
  );
  assert.deepEqual(JSON.parse(high.toString("utf8")), {
    model: model.id,
    chat_template_kwargs: { enable_thinking: true, reasoning_effort: "xhigh" },
  });

  const off = applyModelReasoningTemplate(
    Buffer.from(JSON.stringify({ model: model.id, reasoning_effort: "off" })),
    model,
  );
  assert.deepEqual(JSON.parse(off.toString("utf8")), {
    model: model.id,
    chat_template_kwargs: { enable_thinking: false },
  });
});

test("drops generic effort fields for a model without a declared control contract", () => {
  const model = {
    id: "custom-reasoner",
    displayName: "Custom reasoner",
    modelPath: "/models/custom.gguf",
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q4_K_M",
    sizeBytes: 0,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: { reasoning: true },
  } satisfies Model;

  for (const reasoning_effort of ["off", "on", "xhigh"]) {
    const output = applyModelReasoningTemplate(
      Buffer.from(JSON.stringify({ model: model.id, reasoning_effort })),
      model,
    );
    assert.deepEqual(JSON.parse(output.toString("utf8")), { model: model.id });
  }
});

test("drops a stale effort level that a native template does not support", () => {
  const model = {
    id: "qwen3.8",
    displayName: "Qwen3.8",
    modelPath: "/models/qwen.gguf",
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q4_K_M",
    sizeBytes: 0,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: null,
    reasoningEfforts: ["low", "medium", "xhigh"],
    reasoningTemplate: {
      enableThinkingArgument: "enable_thinking",
      effortArgument: "reasoning_effort",
    },
  } satisfies Model;

  const output = applyModelReasoningTemplate(
    Buffer.from(JSON.stringify({ model: model.id, reasoning_effort: "high" })),
    model,
  );
  assert.deepEqual(JSON.parse(output.toString("utf8")), { model: model.id });
});

test("completion shape is read from the path, not the body", () => {
  assert.equal(completionShape("/v1/messages"), "anthropic");
  assert.equal(completionShape("/v1/chat/completions"), "openai");
  assert.equal(completionShape(undefined), "openai");
});

test("appends the addendum after the agent's own OpenAI system message", () => {
  const out = inject(
    {
      messages: [
        { role: "system", content: "You are Otto." },
        { role: "user", content: "hi" },
      ],
    },
    "Be concise.",
    "openai",
  );
  const messages = out.messages as { role: string; content: unknown }[];
  assert.equal(messages.length, 2, "no message is added when one already carries the system turn");
  assert.equal(messages[0].content, "You are Otto.\n\nBe concise.");
  assert.equal(messages[1].content, "hi");
});

test("adds a leading system message when the OpenAI request has none", () => {
  const out = inject({ messages: [{ role: "user", content: "hi" }] }, "Be concise.", "openai");
  const messages = out.messages as { role: string; content: unknown }[];
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: "Be concise." });
});

test("treats an OpenAI developer message as the system turn", () => {
  const out = inject(
    {
      messages: [
        { role: "developer", content: "rules" },
        { role: "user", content: "hi" },
      ],
    },
    "Be concise.",
    "openai",
  );
  const messages = out.messages as { role: string; content: unknown }[];
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, "rules\n\nBe concise.");
});

test("appends a text block to structured multimodal system content", () => {
  const out = inject(
    { messages: [{ role: "system", content: [{ type: "text", text: "You are Otto." }] }] },
    "Be concise.",
    "openai",
  );
  const messages = out.messages as { content: unknown[] }[];
  assert.deepEqual(messages[0].content, [
    { type: "text", text: "You are Otto." },
    { type: "text", text: "Be concise." },
  ]);
});

test("uses Anthropic's top-level system field rather than the message list", () => {
  const out = inject(
    { system: "You are Otto.", messages: [{ role: "user", content: "hi" }] },
    "Be concise.",
    "anthropic",
  );
  assert.equal(out.system, "You are Otto.\n\nBe concise.");
  assert.equal((out.messages as unknown[]).length, 1, "the message list is left alone");
});

test("sets Anthropic's system field when the request omits it", () => {
  const out = inject({ messages: [{ role: "user", content: "hi" }] }, "Be concise.", "anthropic");
  assert.equal(out.system, "Be concise.");
});

test("appends to an Anthropic structured system prompt", () => {
  const out = inject(
    { system: [{ type: "text", text: "You are Otto." }] },
    "Be concise.",
    "anthropic",
  );
  assert.deepEqual(out.system, [
    { type: "text", text: "You are Otto." },
    { type: "text", text: "Be concise." },
  ]);
});

test("forwards the body untouched when there is nothing to inject", () => {
  const body = Buffer.from(JSON.stringify({ messages: [] }), "utf8");
  assert.equal(injectSystemAddendum(body, null, "openai"), body, "same buffer, no re-serialize");
  assert.equal(injectSystemAddendum(body, "", "openai"), body);
});

test("forwards an unparseable or unfamiliar body untouched", () => {
  // llama-server must get the chance to reject these itself, with its own error.
  const garbage = Buffer.from("not json", "utf8");
  assert.equal(injectSystemAddendum(garbage, "Be concise.", "openai"), garbage);

  const noMessages = Buffer.from(JSON.stringify({ prompt: "hi" }), "utf8");
  assert.equal(injectSystemAddendum(noMessages, "Be concise.", "openai"), noMessages);
});

/**
 * Stand a fake llama-server and a real brain router (with its scheduler) on
 * loopback, so a completion goes through the whole queue/dispatch path.
 */
async function completionHarness(
  upstreamHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
) {
  const model = { id: "qwen", displayName: "Qwen" } as unknown as Model;
  const supervisor = new EventEmitter() as unknown as Supervisor & EventEmitter;
  supervisor.state = "ready";
  supervisor.model = model;
  supervisor.profile = { parallelSlots: 1 } as Profile;
  supervisor.host = "127.0.0.1";
  supervisor.internalPort = 0;
  const router = createRouter({
    supervisor,
    telemetry: new Telemetry(),
    getCatalog: () => [model],
    // A no-op switch so the router runs completions through the scheduler's
    // proxyBuffered path (the model is already "loaded").
    loadModel: async () => {},
  });
  const brain = http.createServer((req, res) => router(req, res));
  const fakeLlama = http.createServer(upstreamHandler);
  const listen = (server: http.Server) =>
    new Promise<number>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
    );
  const llamaPort = await listen(fakeLlama);
  supervisor.internalPort = llamaPort;
  const brainPort = await listen(brain);
  const call = (stream = true) =>
    new Promise<{ status: number; body: string; socket: net.Socket }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: brainPort,
          path: "/v1/chat/completions",
          method: "POST",
          headers: { accept: stream ? "text/event-stream" : "application/json" },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode!, body, socket: res.socket }));
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(
        JSON.stringify({
          model: "qwen",
          stream,
          messages: [{ role: "user", content: "hi" }],
        }),
      );
    });
  return {
    supervisor,
    brainPort,
    call,
    close: async () => {
      const closeOne = (server: http.Server) =>
        new Promise<void>((r) => {
          server.close();
          server.closeAllConnections();
          server.on("close", () => r());
        });
      await closeOne(brain);
      await closeOne(fakeLlama);
    },
  };
}

const SSE_OK = (res: http.ServerResponse) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
};

test("a client departure mid-stream releases the slot so the queue moves on", async () => {
  // The reported failure: the first request's stream never ends on the Brain
  // side, and every request after it piles up in the queue until a reboot.
  const h = await completionHarness((req, res) => {
    req.resume();
    SSE_OK(res);
  });
  try {
    // Start the first request without waiting for it to end - we are going to
    // abandon it mid-stream, which is exactly what the desktop client does.
    const firstSocket = await new Promise<net.Socket>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: h.brainPort, path: "/v1/chat/completions", method: "POST" },
        (res) => {
          res.resume();
          resolve(res.socket);
        },
      );
      req.on("error", reject);
      req.end(
        JSON.stringify({
          model: "qwen",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      );
    });
    // Give the stream a beat to be in flight, then the client gives up.
    await new Promise((r) => setTimeout(r, 50));
    firstSocket.destroy();

    // The next request from the same session must still be served, not queued
    // behind the abandoned one.
    const second = await h.call();
    assert.equal(second.status, 200);
    assert.match(second.body, /ok/);
  } finally {
    await h.close();
  }
});

test("an upstream socket hang-up rejects only the dead request and frees the slot", async () => {
  let hits = 0;
  const h = await completionHarness((req, res) => {
    hits += 1;
    if (hits === 1) {
      req.resume();
      req.socket.destroy(); // llama-server dies before answering
      return;
    }
    SSE_OK(res);
  });
  try {
    const first = h.call().catch((error: Error) => ({ error }));
    const second = await h.call();
    assert.equal(second.status, 200, "the follow-up request runs without a reboot");
    const dead = await first;
    if ("error" in dead) {
      assert.ok(true, "the dead request surfaced an error, not a hang");
    } else {
      // The 502 is the honest result: the upstream socket died before it could
      // answer, and the client that is still there learns exactly why.
      assert.equal(dead.status, 502);
      assert.match(dead.body, /socket hang up/, "the failure names the upstream error");
    }
  } finally {
    await h.close();
  }
});

test("eraseSlot sends action and id_slot in the query string, not the body", async () => {
  // Regression: llama-server's POST /slots handler reads `action` and
  // `id_slot` via req.get_param(), which is built only from query + path
  // params - never from the JSON body. A body-only request reaches
  // std::stoi("") and answers 400 "Invalid slot ID", so the erase silently
  // no-ops and the KV bleed survives. Pin the exact wire shape.
  const seen: { path: string; body: string }[] = [];
  const llama = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 1, id_slot: 2, n_erased: 42 }));
    });
  });
  await new Promise<void>((resolve) => {
    llama.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = llama.address() as { port: number };

  try {
    await createSlotEraser("127.0.0.1", port)(2);
  } finally {
    llama.closeAllConnections();
    await new Promise<void>((resolve) => llama.close(() => resolve()));
  }

  assert.equal(seen.length, 1, "exactly one erase request was sent");
  const [hit] = seen;
  // The engine parses these from the query string.
  assert.match(hit.path, /^\/slots\?/, "the route is POST /slots");
  const query = new URL(`http://127.0.0.1${hit.path}`).searchParams;
  assert.equal(query.get("action"), "erase", "action travels in the query string");
  assert.equal(query.get("id_slot"), "2", "id_slot travels in the query string");
  // The body must stay empty: the handler ignores it, and a body here is the
  // exact shape that previously made the engine throw on stoi("").
  assert.equal(hit.body, "", "no JSON body - the engine never reads it for this route");
});

test("the standard prompt_cache_key reaches the scheduler as the session identity", async () => {
  const { Scheduler } = await import("./scheduler.js");
  const model = { id: "qwen", displayName: "Qwen" } as unknown as Model;
  const supervisor = new EventEmitter() as unknown as Supervisor & EventEmitter;
  supervisor.state = "ready";
  supervisor.model = model;
  supervisor.profile = { parallelSlots: 1 } as Profile;
  supervisor.host = "127.0.0.1";
  supervisor.internalPort = 0;
  const scheduler = new Scheduler({ supervisor, loadModel: async () => {} });
  let capturedSession: string | null = null;
  // Observe the job exactly as the router submits it.
  const originalSubmit = scheduler.submit.bind(scheduler);
  scheduler.submit = (
    m: Model,
    run: () => Promise<unknown>,
    opts: {
      kind?: string;
      exclusive?: boolean;
      onStart?: (() => void) | null;
      session?: string | null;
    } = {},
  ) => {
    capturedSession = opts.session ?? null;
    return originalSubmit(m, run, opts);
  };
  const router = createRouter({
    supervisor,
    telemetry: new Telemetry(),
    getCatalog: () => [model],
    scheduler,
  });
  const fakeLlama = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
  const brain = http.createServer((req, res) => router(req, res));
  const listen = (server: http.Server) =>
    new Promise<number>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
    );
  const llamaPort = await listen(fakeLlama);
  supervisor.internalPort = llamaPort;
  const brainPort = await listen(brain);

  try {
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: brainPort, path: "/v1/chat/completions", method: "POST" },
        (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode! }));
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(
        JSON.stringify({
          model: "qwen",
          stream: true,
          prompt_cache_key: "chat-session-123",
          messages: [{ role: "user", content: "hi" }],
        }),
      );
    });
    assert.equal(result.status, 200);
    // The router extracted the standard prompt_cache_key and passed it to the
    // scheduler as this job's session identity - no new wire field involved.
    assert.equal(capturedSession, "chat-session-123");
    assert.equal(scheduler.stats().queued, 0, "the job ran and drained the queue");
  } finally {
    const closeOne = (server: http.Server) =>
      new Promise<void>((r) => {
        server.close();
        server.closeAllConnections();
        server.on("close", () => r());
      });
    await closeOne(brain);
    await closeOne(fakeLlama);
  }
});

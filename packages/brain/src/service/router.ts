import http from "node:http";

import { chunkHasContent, chunkHasReasoning, readActivity, ReasoningTracker } from "./activity.js";
import { Scheduler, type ModelScheduler } from "./scheduler.js";
import type { Supervisor } from "./supervisor.js";
import { slots as sampleSlots } from "../sysmon.js";
import { makeVramFitPredicate, selectCodingModel } from "./model-selector.js";
import { query as queryGpu } from "../gpu.js";
import { rankModels, type RankedModel } from "../ops/results.js";
import type { GpuInfo, Model, ModelMetadata } from "../types.js";
import type { Profile } from "../config/schema.js";
import { HOST_API_VERSION, type HostApi } from "./host-api.js";
import type { BrainStatusPublisher, BrainStatusSnapshot } from "./status-events.js";
import {
  errorBody,
  errorMessage,
  HOP_BY_HOP,
  readJsonBody,
  sendError,
  sendJson,
} from "./http-util.js";

/**
 * Fronts the supervised llama-server on a stable port.
 *
 * Three jobs beyond plain proxying:
 *  1. While a model is loading or swapping, answer with a clear 503 instead of
 *     a connection refused, so clients can retry rather than error out.
 *  2. Watch completions for the failure this whole project exists to prevent:
 *     a response whose tokens went entirely into reasoning, leaving no content.
 *  3. Serve `/v1/models` (and LM Studio's `/api/v0/models`) ourselves instead of
 *     passing it through. Raw llama-server reports only the loaded model, with
 *     its *full file path* as the id and none of the metadata LM Studio clients
 *     read (context length, quant, arch, state). We instead list the whole
 *     catalog (via the injected `getCatalog`), mark the running one 'loaded',
 *     and give each a friendly name plus the context fields clients size against.
 */

const MAX_ANALYSIS_BYTES = 2 * 1024 * 1024;
// Completion bodies are buffered so the scheduler can read `model` and replay
// them after a possible model switch. Long-context prompts are large but bounded.
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
// llama.cpp accepts both its versioned OpenAI paths and the unversioned
// aliases. They are the same completion surface to Brain: both must enter the
// scheduler so generic reasoning_effort is translated before a chat template
// can render it.
const COMPLETION_RE = /\/(?:v1\/)?(messages|chat\/completions)(?:[/?]|$)/;

type Verdict = "ok" | "reasoning-only" | "truncated" | "failed";

/** Optional durable operational-log sink for completion lifecycle events. */
export interface Logger {
  info?(message: string): void;
  warn(message: string): void;
}

/** A source of the catalog: a getter, a snapshot array, or nothing. */
export type GetCatalog = (() => Model[]) | Model[] | null;

interface TelemetryTotals {
  requests: number;
  ok: number;
  reasoningOnly: number;
  truncated: number;
  failed: number;
}

/** One recorded completion outcome; fields vary by streaming vs. buffered. */
export interface TelemetryRecord {
  verdict: string;
  at?: string;
  path?: string;
  ms?: number;
  streamed?: boolean;
  finishReason?: string | null;
  contentChars?: number;
  reasoningChars?: number;
  outputTokens?: number | null;
  toolCalls?: number;
  error?: string;
}

/** The verdict of classifying a completion body. */
export interface Analysis {
  finishReason: string | null;
  contentChars: number;
  reasoningChars: number;
  outputTokens: number | null;
  toolCalls: number;
  verdict: Verdict;
}

export class Telemetry {
  keep: number;
  records: TelemetryRecord[];
  totals: TelemetryTotals;

  constructor(keep = 50) {
    this.keep = keep;
    this.records = [];
    this.totals = { requests: 0, ok: 0, reasoningOnly: 0, truncated: 0, failed: 0 };
  }

  record(entry: TelemetryRecord): void {
    this.totals.requests += 1;
    if (entry.verdict === "reasoning-only") this.totals.reasoningOnly += 1;
    else if (entry.verdict === "truncated") this.totals.truncated += 1;
    else if (entry.verdict === "failed") this.totals.failed += 1;
    else this.totals.ok += 1;

    this.records.push(entry);
    if (this.records.length > this.keep) this.records.shift();
  }

  /**
   * Advice derived from the recent window (`records`), not lifetime `totals`.
   * A ratio over the lifetime total barely moves once a service has served any
   * real volume, so a handful of clean responses after a bad patch could never
   * clear it. The sliding window lets a few good requests visibly clear the
   * advice, and `reset()` gives a restarted model a clean slate instead of
   * carrying blame from before the fix was applied.
   */
  get warning(): string | null {
    const total = this.records.length;
    if (total < 3) return null;
    const reasoningOnly = this.records.filter((r) => r.verdict === "reasoning-only").length;
    if (reasoningOnly / total > 0.3) {
      return `${reasoningOnly}/${total} recent responses spent all tokens on reasoning and returned no content - lower the reasoning budget`;
    }
    const truncated = this.records.filter((r) => r.verdict === "truncated").length;
    if (truncated / total > 0.3) {
      return `${truncated}/${total} recent responses hit the token limit - raise the client's max_tokens`;
    }
    return null;
  }

  /** Clear the recent window so the warning starts fresh - called when the model (re)starts. */
  reset(): void {
    this.records = [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function strlen(value: unknown): number {
  return String(value || "").length;
}

function readTokens(usage: unknown, key: string): number | null {
  if (!isRecord(usage)) return null;
  const value = usage[key];
  return typeof value === "number" ? value : null;
}

/** Classify a completion body (Anthropic or OpenAI shaped). */
export function analyse(bodyText: string): Analysis | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }

  let finishReason: string | null = null;
  let contentChars = 0;
  let reasoningChars = 0;
  let outputTokens: number | null = null;
  let toolCalls = 0;

  if (isRecord(parsed) && Array.isArray(parsed.content)) {
    // Anthropic /v1/messages
    finishReason = asStringOrNull(parsed.stop_reason);
    outputTokens = readTokens(parsed.usage, "output_tokens");
    for (const block of parsed.content as unknown[]) {
      if (!isRecord(block)) continue;
      if (block.type === "text") contentChars += strlen(block.text);
      else if (block.type === "thinking") reasoningChars += strlen(block.thinking);
      else if (block.type === "tool_use") toolCalls += 1;
    }
  } else if (isRecord(parsed) && Array.isArray(parsed.choices)) {
    // OpenAI /v1/chat/completions
    const first: unknown = (parsed.choices as unknown[])[0];
    const choice: Record<string, unknown> = isRecord(first) ? first : {};
    finishReason = asStringOrNull(choice.finish_reason);
    outputTokens = readTokens(parsed.usage, "completion_tokens");
    const msg: Record<string, unknown> = isRecord(choice.message) ? choice.message : {};
    contentChars = strlen(msg.content);
    reasoningChars = strlen(msg.reasoning_content);
    toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0;
  } else {
    return null;
  }

  let verdict: Verdict = "ok";
  if (contentChars === 0 && toolCalls === 0 && reasoningChars > 0) verdict = "reasoning-only";
  else if (finishReason === "length" || finishReason === "max_tokens") verdict = "truncated";

  return { finishReason, contentChars, reasoningChars, outputTokens, toolCalls, verdict };
}

type ModelState = "loaded" | "loading" | "not-loaded";

interface DescribeOptions {
  state?: ModelState;
  profile?: Profile | null;
  createdAt?: Date | null;
}

/** An LM Studio-style model description, an OpenAI model object enriched. */
export interface ModelEntry {
  id: string;
  /** Brain's editable human-facing name; `id` remains the stable model key. */
  name: string;
  family?: string;
  object: "model";
  created: number;
  owned_by: string;
  type: "vlm" | "llm";
  publisher: string | null;
  arch: string | null;
  compatibility_type: "gguf";
  quantization: string | null;
  state: ModelState;
  max_context_length: number | null;
  /** Whether the model exposes a chat-template reasoning channel. */
  reasoning: boolean;
  /** Optional per-model values accepted by the OpenAI-compatible endpoint. */
  reasoning_efforts?: string[];
  /** Optional model-native default among `reasoning_efforts`. */
  reasoning_effort_default?: string;
  loaded_context_length?: number;
}

/**
 * Describe one catalog model the way LM Studio's API does. Returns an
 * OpenAI-style model object enriched with LM Studio's fields (arch,
 * quantization, state, context lengths) so clients can display the real name
 * and know the context window. `state` is 'loaded' | 'loading' | 'not-loaded';
 * `loaded_context_length` is only meaningful for the model actually running.
 */
export function describeModel(model: Model, options?: DescribeOptions): ModelEntry;
export function describeModel(model: Model | null, options?: DescribeOptions): ModelEntry | null;
export function describeModel(
  model: Model | null,
  options: DescribeOptions = {},
): ModelEntry | null {
  if (!model) return null;
  const { state = "not-loaded", profile = null, createdAt = null } = options;
  const md: ModelMetadata = model.metadata || {};

  const entry: ModelEntry = {
    // Keep the stable model key separate from Brain's editable display name.
    // OpenAI-compatible clients send `id`; Otto uses `name` for presentation.
    id: model.id,
    name: model.displayName,
    ...(model.family ? { family: model.family } : {}),
    object: "model",
    created: Math.floor((createdAt ? createdAt.getTime() : Date.now()) / 1000),
    owned_by: model.publisher || "local",
    // LM Studio enrichment.
    type: model.mmprojPath ? "vlm" : "llm",
    publisher: model.publisher || null,
    arch: md.arch || null,
    compatibility_type: "gguf",
    quantization: model.quant || null,
    state,
    // The GGUF header remains the native limit, but an actively loaded YaRN
    // profile intentionally extends the server's usable maximum. Publish that
    // effective ceiling so OpenAI-compatible clients do not reject a context
    // that this very llama-server instance has been configured to accept.
    max_context_length:
      typeof md.contextLength === "number"
        ? md.contextLength * (profile?.contextMultiplier ?? 1)
        : null,
    // GGUF template detection is deliberately conservative. A false result
    // means "not detected", not proof that a catalog-marked reasoner is not
    // one, so preserve the catalog's positive capability metadata.
    reasoning: Boolean(md.reasoning || model.thinking),
  };
  // Prefer explicit GGUF metadata when a runtime supplies it, but preserve
  // catalog knowledge for models whose chat template does not encode the
  // accepted request levels (GPT-OSS is one such model).
  const reasoningEfforts = md["reasoning_efforts"] ?? model.reasoningEfforts;
  if (
    Array.isArray(reasoningEfforts) &&
    reasoningEfforts.every((value): value is string => typeof value === "string")
  ) {
    entry.reasoning_efforts = reasoningEfforts;
  }
  const reasoningEffortDefault = md["reasoning_effort_default"] ?? model.reasoningEffortDefault;
  if (typeof reasoningEffortDefault === "string") {
    entry.reasoning_effort_default = reasoningEffortDefault;
  }
  if (state === "loaded" && profile && profile.contextSize) {
    // llama-server splits -c across --parallel slots, so the window a single
    // request actually gets is the total divided by the concurrency.
    const slots = Math.max(1, profile.parallelSlots || 1);
    entry.loaded_context_length = Math.floor(profile.contextSize / slots);
  }
  return entry;
}

function resolveCatalog(getCatalog: GetCatalog): Model[] {
  try {
    return (typeof getCatalog === "function" ? getCatalog() : getCatalog) || [];
  } catch {
    return [];
  }
}

/**
 * Build the LM Studio-style catalog: every model found on disk, with the one
 * the supervisor is running marked 'loaded'. Falls back to just the running
 * model when no catalog provider is wired in.
 */
export function buildModelList(
  supervisor: Supervisor,
  getCatalog: GetCatalog,
  scheduler: ModelScheduler<Supervisor> | null = null,
): ModelEntry[] {
  const supervisors =
    scheduler && typeof scheduler.supervisors === "function"
      ? scheduler.supervisors()
      : [supervisor];
  const residentFor = (modelId: string): Supervisor | null =>
    supervisors.find(
      (candidate) => candidate.model?.id === modelId && candidate.state !== "stopped",
    ) ?? null;
  const stateOf = (model: Model): ModelState => {
    const resident = residentFor(model.id);
    if (!resident) return "not-loaded";
    if (resident.state === "ready") return "loaded";
    if (resident.state === "starting") return "loading";
    return "not-loaded";
  };

  let catalog = resolveCatalog(getCatalog);
  // Guarantee the running model appears even if the snapshot predates it.
  for (const resident of supervisors) {
    if (resident.model && !catalog.some((model) => model.id === resident.model?.id)) {
      catalog.unshift(resident.model);
    }
  }

  return catalog.map((model) => {
    const resident = residentFor(model.id);
    return describeModel(model, {
      state: stateOf(model),
      profile: resident?.profile ?? null,
      createdAt: resident?.startedAt ?? null,
    });
  });
}

/** Handle the model-discovery endpoints ourselves; returns true if it did. */
function handleModelsRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  supervisor: Supervisor,
  getCatalog: GetCatalog,
  scheduler: ModelScheduler<Supervisor> | null = null,
): boolean {
  if (req.method !== "GET") return false;
  const url = (req.url || "").split("?")[0];
  const isList = url === "/v1/models" || url === "/api/v0/models";
  const single = url.startsWith("/v1/models/")
    ? decodeURIComponent(url.slice("/v1/models/".length))
    : null;
  if (!isList && single === null) return false;

  const list = buildModelList(supervisor, getCatalog, scheduler);
  let payload: unknown;
  if (single !== null) {
    const entry = list.find((e) => e.id === single);
    if (!entry) {
      const body = errorBody(404, `model "${single}" was not found`);
      res.writeHead(404, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
      return true;
    }
    payload = entry;
  } else {
    payload = { object: "list", data: list };
  }

  const body = JSON.stringify(payload);
  res.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
  return true;
}

/**
 * The reasoning tracker is module-scoped rather than per-router because both
 * proxy paths need it and `proxyBuffered` is a free function. One service
 * process hosts exactly one router, so there is nothing to collide with; the
 * bench command builds its own throwaway router and simply never reads it.
 */
const reasoningTracker = new ReasoningTracker();

interface ProxyBufferedOptions {
  agent: http.Agent;
  model: Model;
  supervisor: Supervisor;
  telemetry: Telemetry;
  logger?: Logger | null;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  body: Buffer;
  /** Live mid-thought tracking for `/__host/status`. See `activity.ts`. */
  reasoning?: ReasoningTracker | null;
  /**
   * The engine slot the scheduler admitted this request to, or null when none
   * could be named. Chosen by the scheduler from the very sample that gated
   * the job's admission (see `Scheduler.onSlotFree`), so it is distinct from
   * every other in-flight request's pin - a second `/slots` sample here would
   * race the sibling job and let both pin the same slot. Injected into the
   * outbound body as `id_slot` and recorded on the reasoning tracker so the
   * status snapshot can join the request's stage to the slot it occupies.
   */
  slot: number | null;
}

/**
 * Map an OpenAI-compatible effort request onto a model's own chat-template
 * arguments. llama.cpp does not know every model's dialect: Qwen3.8 calls the
 * controls `enable_thinking` and `reasoning_effort`, for example. Only catalog
 * entries that declare these names receive a translated request. An arbitrary
 * GGUF template must never see Otto's generic `reasoning_effort` field: its
 * accepted values are template-specific, and an incompatible value makes
 * llama.cpp fail the whole completion with a Jinja exception.
 */
export function applyModelReasoningTemplate(body: Buffer, model: Model): Buffer {
  const template = model.reasoningTemplate;
  const advertised = model.reasoningEfforts;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (!isRecord(parsed) || typeof parsed.reasoning_effort !== "string") return body;

  const { reasoning_effort: _reasoningEffort, ...withoutReasoningEffort } = parsed;
  // The Brain owns this generic field. An uncurated model can expose a
  // reasoning channel without declaring how to control it, so preserve the
  // template default rather than forwarding a value that can crash rendering.
  if (!template || !Array.isArray(advertised)) {
    return Buffer.from(JSON.stringify(withoutReasoningEffort), "utf8");
  }

  const requested = parsed.reasoning_effort.toLowerCase();
  const knownEfforts = new Set(advertised.map((value) => value.toLowerCase()));
  const isDisabled = requested === "off" || requested === "none";
  const isEnabled = requested === "on" || knownEfforts.has(requested);
  // Old chats can retain a formerly valid generic level that this model does
  // not support. Do not let that stale state turn into a server error.
  if (!isDisabled && !isEnabled) {
    return Buffer.from(JSON.stringify(withoutReasoningEffort), "utf8");
  }

  const suppliedKwargs = parsed.chat_template_kwargs;
  if (suppliedKwargs !== undefined && !isRecord(suppliedKwargs)) return body;
  const templateKwargs: Record<string, unknown> = { ...suppliedKwargs };
  templateKwargs[template.enableThinkingArgument] = !isDisabled;
  if (requested !== "on" && knownEfforts.has(requested)) {
    templateKwargs[template.effortArgument] = requested;
  } else {
    // The generic On selection means the model's native default, not a stale
    // explicit effort that happened to be supplied by a previous client. It
    // stays generic even for a model that advertises "on" as its only level:
    // that answer says the template has a toggle and no named ladder, so
    // forwarding the word itself is the invalid value this guard exists to stop.
    delete templateKwargs[template.effortArgument];
  }

  return Buffer.from(
    JSON.stringify({ ...withoutReasoningEffort, chat_template_kwargs: templateKwargs }),
    "utf8",
  );
}

/**
 * Pin the request to one llama-server slot by adding the engine's own
 * `id_slot` field to the request body (host API v3).
 *
 * Why pin instead of guess: the OpenAI-compatible stream chunks never carry the
 * slot id, so without a pin the router can only correlate a request to a slot
 * by elimination, and with several concurrent requests that guess is exactly
 * the lie the Overview panel used to tell. llama-server honors the pin on every
 * completion endpoint: if the named slot is free the task lands there, and if
 * it is busy the engine DEFERS the task internally - it never reassigns the
 * task elsewhere and never fails the request - so the slot this router names is
 * always the slot the request ends up on (possibly after waiting on it).
 *
 * `null` returns the body untouched: no pin, and therefore no join data for
 * this request, which is the same degraded state as an older brain. A body this
 * cannot parse is forwarded exactly as-is - an unfamiliar request must reach
 * llama-server and get llama-server's own answer, not a 400 invented here.
 */
export function pinSlot(body: Buffer, slotId: number | null): Buffer {
  if (slotId === null) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (!isRecord(parsed)) return body;
  parsed.id_slot = slotId;
  return Buffer.from(JSON.stringify(parsed), "utf8");
}

/**
 * Wipe one llama-server slot's retained KV state, and RESOLVE only once the
 * engine has acknowledged the wipe.
 *
 * This is the engine-side half of the scheduler's OWNERSHIP fix. The engine
 * never clears a released slot's prompt, so a slot handed to a different chat
 * would keep the previous chat's KV and bleed its topics into the new chat's
 * thinking. The router erases the slot the moment the scheduler hands it off;
 * the engine's task queue runs in arrival order, so resolving on the
 * acknowledgment is what guarantees the clean state sits in the queue ahead of
 * the completion the scheduler posts right after.
 *
 * The route is `POST /slots?action=erase&id_slot=N` - llama.cpp's own slot
 * action. It answers 200 `{id, id_slot, n_erased}` on success and a
 * `NOT_SUPPORTED` error when the server was not launched with a slot-save path;
 * either way this resolves (never rejects), because an erase that cannot be
 * performed degrades to the old behavior rather than failing the completion.
 *
 * NOTE: `action` and `id_slot` MUST travel in the query string, not the JSON
 * body. llama-server's `POST /slots` handler reads both via `req.get_param()`,
 * which is built only from query + path params (b10441 tools/server/server-http.cpp,
 * `server_http_req::params` = "path_params + query_params"; the body is a
 * separate field the handler never parses for this route). A body-only request
 * reaches `std::stoi("")` and answers 400 "Invalid slot ID" - the erase then
 * silently no-ops and the bleed survives. The body must stay empty for the
 * same reason `handle_slots_erase` ignores it entirely.
 */
export function eraseSlot(host: string, port: number, slotId: number): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host,
        port,
        path: `/slots?action=erase&id_slot=${slotId}`,
        method: "POST",
        timeout: 3000,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve());
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve());
    req.end();
  });
}

/**
 * The eraser the scheduler needs, bound to one engine endpoint. Extracted so
 * the router (which builds its own scheduler) and the service (which builds a
 * shared one and passes it in) hand the scheduler the SAME transport rather
 * than each spelling the request.
 */
export function createSlotEraser(host: string, port: number): (slotId: number) => Promise<void> {
  return (slotId) => eraseSlot(host, port, slotId);
}

/**
 * Forward a buffered completion body to the resident llama-server and stream the
 * reply back, teeing non-streaming bodies for classification. Resolves once the
 * client response is fully concluded (it owns the response in every outcome,
 * including upstream errors), so the scheduler can move to the next turn.
 *
 * The slot this request is pinned to arrives as `options.slot`, named by the
 * scheduler at the moment of admission (see `Scheduler.onSlotFree`). That is
 * the only race-free place to choose it: by then the model is resident (slot
 * ids do not survive a model switch), the admission sample has just counted
 * the slot free, and every sibling admitted in the same pass has been named a
 * DISTINCT id. `null` means the engine could not be sampled or reported no
 * per-slot rows - the request then runs unpinned with no join data, exactly
 * the degraded state of an older brain.
 */
function proxyBuffered({
  agent,
  model,
  supervisor,
  telemetry,
  logger,
  req,
  res,
  body,
  reasoning = null,
  slot,
}: ProxyBufferedOptions): Promise<void> {
  const slotId = slot ?? null;
  return new Promise((resolve) => {
    let settled = false;
    // Opened before anything can fail, so every exit below has a lease to
    // release. Releasing is terminal and idempotent, which is what makes it
    // safe to call `done()` from all six paths that can end this request
    // without any of them having to know whether another got there first.
    const lease = reasoning?.begin() ?? null;
    const done = (): void => {
      // Always release the stage, including on the error and abort paths: a
      // stream that dies mid-thought would otherwise pin the rail on
      // "thinking" until the service restarts.
      lease?.end();
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    // Injected here, not at queue time: the scheduler may switch models between
    // buffering and dispatch, and the addendum belongs to whichever model ends
    // up resident, which is the one `supervisor.profile` now describes.
    const withSystemAddendum = injectSystemAddendum(
      body,
      supervisor.profile?.chatSystemAddendum ?? null,
      completionShape(req.url),
    );
    const outbound = pinSlot(applyModelReasoningTemplate(withSystemAddendum, model), slotId);

    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
    }
    headers.host = `${supervisor.host}:${supervisor.internalPort}`;
    headers["content-length"] = Buffer.byteLength(outbound);

    const started = Date.now();
    logger?.info?.(
      `dispatching ${req.method ?? "POST"} ${req.url ?? "/v1/chat/completions"} to ${model.displayName}`,
    );
    const upstream = http.request(
      {
        host: supervisor.host,
        port: supervisor.internalPort,
        path: req.url,
        method: req.method,
        headers,
        agent,
      },
      (upstreamRes) => {
        const outHeaders: http.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (!HOP_BY_HOP.has(name.toLowerCase())) outHeaders[name] = value;
        }
        res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
        const isStream = String(upstreamRes.headers["content-type"] || "").includes("event-stream");
        const upstreamResponseFailed = (error: Error): void => {
          // The release runs even when the queue has already settled. On an
          // interrupt the client's socket close settles first, and this is the
          // event that says the upstream stream is finally over.
          if (settled) {
            lease?.end();
            return;
          }
          const message = `llama-server response ended unexpectedly: ${error.message}`;
          telemetry.record({
            at: new Date().toISOString(),
            path: req.url,
            verdict: "failed",
            error: message,
          });
          logger?.warn?.(message);
          // Headers may already be on the wire for an SSE response. Destroying
          // it is the only honest result, but `done()` still releases the queue.
          if (!res.writableEnded && !res.destroyed) res.destroy(error);
          done();
        };
        upstreamRes.once("aborted", () =>
          upstreamResponseFailed(new Error("upstream response aborted")),
        );
        upstreamRes.once("error", upstreamResponseFailed);

        if (isStream) {
          let sawContent = false;
          let sawReasoning = false;
          upstreamRes.on("data", (chunk: Buffer) => {
            const text = String(chunk);
            lease?.observe(text);
            if (chunkHasContent(text)) sawContent = true;
            if (chunkHasReasoning(text)) sawReasoning = true;
          });
          upstreamRes.on("end", () => {
            telemetry.record({
              at: new Date().toISOString(),
              path: req.url,
              ms: Date.now() - started,
              streamed: true,
              verdict: !sawContent && sawReasoning ? "reasoning-only" : "ok",
            });
            logger?.info?.(
              `completed streamed ${req.method ?? "POST"} ${req.url ?? "/v1/chat/completions"} for ${model.displayName}`,
            );
            done();
          });
          upstreamRes.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        upstreamRes.on("data", (chunk: Buffer) => {
          if (size < MAX_ANALYSIS_BYTES) {
            chunks.push(chunk);
            size += chunk.length;
          }
          if (!res.writableEnded && !res.destroyed) res.write(chunk);
        });
        upstreamRes.on("end", () => {
          if (!res.writableEnded && !res.destroyed) res.end();
          const analysis = analyse(Buffer.concat(chunks).toString("utf8"));
          const entry: TelemetryRecord = {
            at: new Date().toISOString(),
            path: req.url,
            ms: Date.now() - started,
            streamed: false,
            ...(analysis ?? { verdict: "ok" }),
          };
          telemetry.record(entry);
          logger?.info?.(
            `completed ${req.method ?? "POST"} ${req.url ?? "/v1/chat/completions"} for ${model.displayName} in ${entry.ms}ms (${entry.verdict})`,
          );
          if (entry.verdict === "reasoning-only") {
            logger?.warn?.(
              `reasoning-only response: ${entry.outputTokens} tokens, ${entry.reasoningChars} reasoning chars, 0 content`,
            );
          }
          done();
        });
      },
    );

    res.on("close", () => {
      if (!res.writableFinished && !upstream.destroyed) upstream.destroy();
      // The client is gone - interrupt, chat switch, socket death. Destroying
      // the upstream request does not reliably fire "aborted"/"error" on the
      // already-open response stream, so this is the authoritative release:
      // without it a departed client's job never resolves and pins its model's
      // slot forever, wedging the whole queue behind it (needs a reboot).
      done();
    });
    res.on("error", () => {
      if (!upstream.destroyed) upstream.destroy();
    });
    upstream.on("error", (error: Error) => {
      telemetry.record({
        at: new Date().toISOString(),
        path: req.url,
        verdict: "failed",
        error: error.message,
      });
      logger?.warn(`request to ${model.displayName} failed: ${error.message}`);
      // The client may already be gone; writing a 502 into a dead socket
      // throws and would kill this handler before done() releases the slot.
      if (!res.writableEnded && !res.destroyed) {
        sendError(res, 502, `Upstream llama-server error: ${error.message}`);
      }
      done();
    });

    // The slot association is set once, here at dispatch, so `observe` stays
    // free of any per-chunk slot work - and so the reaper has a row to check
    // this request against if its release is ever missed.
    if (slotId !== null) lease?.setSlot(slotId);
    upstream.end(outbound);
  });
}

/** Which shape a completion path uses to carry its system turn. */
export type CompletionShape = "anthropic" | "openai";

export function completionShape(url: string | null | undefined): CompletionShape {
  return /\/(?:v1\/)?messages(?:[/?]|$)/.test(url ?? "") ? "anthropic" : "openai";
}

/** One text block, as both API shapes spell it inside a structured content array. */
function textBlock(text: string): Record<string, unknown> {
  return { type: "text", text };
}

/**
 * Append the active hosting profile's system-prompt addendum to a buffered
 * completion body.
 *
 * Appending rather than prepending or replacing is the whole point: the agent's
 * own system prompt still leads, and the profile's instructions are read last.
 * A body this cannot understand is forwarded untouched - a malformed or
 * unfamiliar request must still reach llama-server and get llama-server's own
 * error, not a 400 invented here.
 *
 * Cost is one extra parse/serialize per request, paid only by models whose
 * profile actually sets an addendum.
 */
export function injectSystemAddendum(
  body: Buffer,
  addendum: string | null,
  shape: CompletionShape,
): Buffer {
  if (!addendum) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (!isRecord(parsed)) return body;

  if (shape === "anthropic") {
    // Anthropic carries the system turn beside `messages`, never inside it.
    const system = parsed.system;
    if (system === undefined || system === null || system === "") parsed.system = addendum;
    else if (typeof system === "string") parsed.system = `${system}\n\n${addendum}`;
    else if (Array.isArray(system)) parsed.system = [...system, textBlock(addendum)];
    else return body;
    return Buffer.from(JSON.stringify(parsed), "utf8");
  }

  const messages = parsed.messages;
  if (!Array.isArray(messages)) return body;
  // `developer` is the newer OpenAI spelling of the same turn; either one is
  // the message this addendum belongs on.
  const index = messages.findIndex(
    (message) => isRecord(message) && (message.role === "system" || message.role === "developer"),
  );
  if (index === -1) {
    parsed.messages = [{ role: "system", content: addendum }, ...messages];
    return Buffer.from(JSON.stringify(parsed), "utf8");
  }
  const existing = messages[index] as Record<string, unknown>;
  const content = existing.content;
  let merged: unknown;
  if (content === undefined || content === null || content === "") merged = addendum;
  else if (typeof content === "string") merged = `${content}\n\n${addendum}`;
  else if (Array.isArray(content)) merged = [...content, textBlock(addendum)];
  else return body;
  parsed.messages = messages.map((message, at) =>
    at === index ? { ...existing, content: merged } : message,
  );
  return Buffer.from(JSON.stringify(parsed), "utf8");
}

// Whether a completion may run: either a resolved model, or a status+message to
// return. Lets the lock deny a switch with a distinct 409 rather than a 404.
export type ModelGateResult =
  | { ok: true; model: Model }
  | { ok: false; status: number; message: string };

/**
 * Pure model-admission decision, factored out of the router so it is unit
 * testable. `pinned` is the single model a locked host serves; `resolved` is the
 * normal catalog resolution used when the lock is off. With the lock on, a
 * request naming a model other than the pin is refused (409) rather than queuing
 * a switch; an unnamed request rides the pin.
 */
export function decideModelGate(params: {
  lockModel: boolean;
  requestedName: string | null;
  pinned: Model | null;
  pinnedModels?: Model[];
  resolved: Model | null;
}): ModelGateResult {
  const {
    lockModel,
    requestedName,
    pinned,
    pinnedModels = pinned ? [pinned] : [],
    resolved,
  } = params;
  if (lockModel) {
    if (pinnedModels.length === 0) {
      return { ok: false, status: 503, message: "no models are selected on this locked host" };
    }
    const selected = requestedName
      ? pinnedModels.find(
          (model) => model.id === requestedName || model.displayName === requestedName,
        )
      : pinnedModels[0];
    if (!selected) {
      return {
        ok: false,
        status: 409,
        message: `model switching is disabled on this host; served models: ${pinnedModels
          .map((model) => `"${model.displayName}"`)
          .join(", ")}`,
      };
    }
    return { ok: true, model: selected };
  }
  if (!resolved) {
    return {
      ok: false,
      status: requestedName ? 404 : 503,
      message: requestedName
        ? `model "${requestedName}" was not found in the catalog`
        : "no model is available to serve",
    };
  }
  return { ok: true, model: resolved };
}

interface ScheduleCompletionOptions {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  agent: http.Agent;
  telemetry: Telemetry;
  logger?: Logger | null;
  scheduler: ModelScheduler<Supervisor>;
  modelGate: (name: string | null) => ModelGateResult;
}

/** Buffer a completion request, resolve its target model, and queue it. */
function scheduleCompletion({
  req,
  res,
  agent,
  telemetry,
  logger,
  scheduler,
  modelGate,
}: ScheduleCompletionOptions): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooBig = false;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) tooBig = true;
    else chunks.push(chunk);
  });
  req.on("error", () => {
    /* client vanished before we could queue it */
  });
  req.on("end", () => {
    if (tooBig) {
      sendError(res, 413, "request body too large");
      return;
    }
    const body = Buffer.concat(chunks);

    let modelName: string | null = null;
    let session: string | null = null;
    try {
      const parsed: unknown = JSON.parse(body.toString("utf8"));
      if (isRecord(parsed)) {
        modelName = typeof parsed.model === "string" ? parsed.model : null;
        // The standard prompt_cache_key is the chat's stable identity: Otto's
        // provider sends its session id there, and a third-party client that
        // uses it for prompt caching sends one too. Brain reads it for
        // session-affine scheduling; the OpenAI-compatible contract is
        // untouched either way.
        session =
          typeof parsed.prompt_cache_key === "string" && parsed.prompt_cache_key.length > 0
            ? parsed.prompt_cache_key
            : null;
      }
    } catch {
      /* leave null */
    }

    const gate = modelGate(modelName);
    if (!gate.ok) {
      logger?.warn(`refused ${req.method ?? "POST"} ${req.url ?? "completion"}: ${gate.message}`);
      sendError(res, gate.status, gate.message);
      return;
    }
    const model = gate.model;
    // The slot is named by the scheduler at admission time (one distinct id per
    // job, drawn from the pass's own free-slot sample). It is not sampled here
    // at queue time - that could name a slot of an engine about to be
    // relaunched - and not at dispatch time either, where a sibling admitted in
    // the same pass could see the same slot free and pin it too.
    let slot: number | null = null;
    // A queued request outlives its client. The reader can interrupt, close the
    // chat, or lose the socket while the job still waits behind another model's
    // turn, and without this the job is admitted anyway: a full generation for
    // nobody, on a slot the live chats are queued for, wired to a response that
    // closed before the proxy could listen to it. One flag, read by the
    // scheduler before it pins anything, keeps the request from ever reaching
    // the engine. (`close` also fires on a healthy finish, by which point the
    // job has long since been dispatched and the flag is never read again.)
    let abandoned = false;
    res.on("close", () => {
      abandoned = true;
    });
    const queued = scheduler.submit(
      model,
      (resident) =>
        proxyBuffered({
          agent,
          model,
          supervisor: resident,
          telemetry,
          logger,
          req,
          res,
          body,
          reasoning: reasoningTracker,
          slot,
        }),
      { session, onSlotFree: (id) => (slot = id), abandoned: () => abandoned },
    );
    logger?.info?.(
      `queued ${req.method ?? "POST"} ${req.url ?? "completion"} for ${model.displayName}; queue depth ${scheduler.stats().queued}`,
    );
    queued.catch((error: unknown) => {
      // The client may be the reason this failed, and writing into a socket it
      // already closed throws where nothing is left to catch it.
      if (res.writableEnded || res.destroyed) return;
      sendError(res, 502, `could not serve ${model.displayName}: ${errorMessage(error)}`);
    });
  });
}

// The bench ranking is read from disk (one JSON per run). A completion request
// must not pay that IO, and rankings only change when a bench run finishes
// (rare), so the router caches the ranking and re-reads it at most once per
// window - the cheap time-based trigger.
const RANKING_TTL_MS = 60_000;

export interface RouterOptions {
  supervisor: Supervisor;
  telemetry: Telemetry;
  logger?: Logger | null;
  getCatalog?: GetCatalog;
  loadModel?: ((model: Model) => Promise<void>) | null;
  // Injectable for testing; both default to the real disk/GPU sources so the
  // service layer needs no extra wiring.
  loadRanking?: () => RankedModel[];
  queryGpuInfo?: () => Promise<GpuInfo | null>;
  /** The brain package version, reported on `/__host/status` for the host UI. */
  version?: string | null;
  /** Effective config with secrets redacted - served on `/__host/config`. */
  getConfig?: (() => unknown) | null;
  /** Benchmark rankings/variance/latest - served on `/__host/evals`. */
  getEvals?: (() => unknown) | null;
  /** Live: pin the host to one model (refuse completions naming a different one). */
  getLockModel?: () => boolean;
  /** Live: the configured default model, the pin target before one is resident. */
  getDefaultModel?: () => string | null;
  /** Live: the complete model set served while locking is enabled. */
  getLockedModels?: () => string[];
  /**
   * Apply an editable config patch (write config.json, live-switch the model,
   * update the lock), for POST /__host/config. Absent = the write endpoint is
   * not offered. Returns the new effective config (secrets redacted).
   */
  applyConfigPatch?: ((patch: unknown) => Promise<unknown>) | null;
  /**
   * Live: whether remote clients may WRITE config (POST /__host/config). Off by
   * default, so a shared brain can be used but not reconfigured over the network
   * until its owner opts in. Read/use are unaffected.
   */
  getAllowConfigWrite?: () => boolean;
  /**
   * The management API (`host-api.ts`): model inventory, per-model profiles, the
   * VRAM budget, load/unload, delete, and logs. Absent means those routes are not
   * offered, which is exactly what `/__host/capabilities` then reports, so an
   * older brain degrades to "that tab is unavailable" rather than a 404 storm.
   */
  hostApi?: HostApi | null;
  /**
   * Live system telemetry (CPU, RAM and GPU), folded into `/__host/status`
   * ONLY when the caller asks with `?resources=1`. The daemon's liveness probe
   * polls status frequently and must not pay an `nvidia-smi` spawn for it. Slot
   * activity is already part of the cheap status; the
   * Brain page's Overview tab opts in.
   */
  getResources?: (() => Promise<unknown>) | null;
  /**
   * The live status source served at `GET /__host/events`. The router installs
   * its snapshot builder here and notifies it whenever something authoritative
   * moves, so the same assembly answers both the pull and the push and the two
   * can never disagree. Absent means this brain does not advertise events.
   */
  statusEvents?: BrainStatusPublisher | null;
  /** A service shares this scheduler with host-owned model operations. */
  scheduler?: ModelScheduler<Supervisor> | null;
}

export function createRouter({
  supervisor,
  telemetry,
  logger,
  getCatalog = null,
  loadModel = null,
  loadRanking = () => rankModels(),
  queryGpuInfo = queryGpu,
  version = null,
  getConfig = null,
  getEvals = null,
  getLockModel = () => false,
  getDefaultModel = () => null,
  getLockedModels = () => [],
  applyConfigPatch = null,
  getAllowConfigWrite = () => false,
  hostApi = null,
  getResources = null,
  statusEvents = null,
  scheduler: suppliedScheduler = null,
}: RouterOptions): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  // llama-server may close an idle response socket while this scheduler holds
  // the next request in queue. A reused keep-alive socket then fails as
  // ECONNRESET ("socket hang up") before the queued request reaches inference.
  // Inference time dwarfs localhost connection setup, so isolate each request
  // instead of letting a second client inherit a stale upstream connection.
  const agent = new http.Agent({ keepAlive: false, maxSockets: 32 });
  // Erase an engine slot's KV when it is handed to a different chat. The
  // endpoint is the engine's own, on the private port - never on the public
  // one - so a remote client cannot wipe a chat's cache out from under it.
  const eraseSlot = createSlotEraser(supervisor.host, supervisor.internalPort);
  const scheduler =
    suppliedScheduler ??
    (loadModel
      ? new Scheduler({
          supervisor,
          loadModel,
          logger: (m) => logger?.warn?.(m),
          onChange: statusEvents ? () => statusEvents.notify() : null,
          eraseSlot,
        })
      : null);

  // A (re)start means whatever produced the current warning no longer applies -
  // either a different model is now resident, or the same one just picked up an
  // edited profile (e.g. a lowered reasoning budget). Either way the recent
  // window is stale, so start it clean rather than let old records blame a
  // config that is no longer running. The scheduler's slot owners go the same
  // way: the engine's slots do not survive the relaunch, so a stale owner entry
  // would make the next admission erase a FRESH slot or mistake a keyless job
  // for one it owns. The model-switch case is cleared by the scheduler itself;
  // this catches the relaunch that keeps the same model resident.
  supervisor.on("state", ({ state }: { state: string }) => {
    if (state === "starting") {
      telemetry.reset();
      scheduler?.forgetSlots();
      // The tracker's pins name the same vanished slots, and a pin that
      // outlives the process it named is not evidence - it can collide with a
      // new request's slot id and shield a dead request from the reaper.
      reasoningTracker.forgetSlots();
    }
  });

  // GPU total VRAM is static hardware, so it is queried once at startup and
  // cached. Absent (no nvidia-smi) or not-yet-resolved leaves the fit predicate
  // undefined, and the selector skips the VRAM filter - mirroring serve.ts.
  let fitPredicate: ((model: Model) => boolean) | undefined;
  void (async () => {
    try {
      fitPredicate = makeVramFitPredicate(await queryGpuInfo());
    } catch {
      /* GPU info absent → skip the fit filter */
    }
  })();

  // TTL-cached bench ranking (see RANKING_TTL_MS above).
  let rankingCache: RankedModel[] = [];
  let rankingAt = 0;
  const getRanking = (): RankedModel[] => {
    const now = Date.now();
    if (now - rankingAt < RANKING_TTL_MS && rankingAt !== 0) return rankingCache;
    try {
      rankingCache = loadRanking();
    } catch {
      /* keep the last good ranking (or the empty default) on a read error */
    }
    rankingAt = now;
    return rankingCache;
  };

  const resolveModel = (name: string | null): Model | null => {
    const catalog = resolveCatalog(getCatalog);
    if (name) {
      const hit = catalog.find((m) => m.displayName === name || m.id === name);
      if (hit) return hit;
      if (
        supervisor.model &&
        (supervisor.model.displayName === name || supervisor.model.id === name)
      ) {
        return supervisor.model;
      }
      return null;
    }
    // No model named: pick the best-ranked coding model that fits the VRAM
    // budget, instead of blindly serving whatever is loaded. The existing
    // default (loaded model, else catalog[0]) is the fallback when no candidate
    // survives, and the loaded model is a tiebreak so equal-scored picks do not
    // trigger a needless swap.
    const fallback = supervisor.model || catalog[0] || null;
    return selectCodingModel({
      models: catalog,
      ranking: getRanking(),
      fits: fitPredicate,
      preferLoadedId: supervisor.model?.id ?? null,
      fallback,
    });
  };

  // The single model this host will serve when switching is locked: the
  // resident model if one is up, else the configured default resolved through
  // the catalog. Null means nothing is loadable yet.
  const pinnedModels = (): Model[] => {
    const configured = getLockedModels();
    const names = configured.length > 0 ? configured : [getDefaultModel()].filter(Boolean);
    const selected = names
      .map((name) => resolveModel(name ?? null))
      .filter((model): model is Model => model !== null);
    if (selected.length > 0) return selected;
    const residents =
      scheduler && typeof scheduler.supervisors === "function"
        ? scheduler.supervisors()
        : [supervisor];
    return residents
      .map((candidate) => candidate.model)
      .filter((model): model is Model => model !== null);
  };

  // Decide whether a completion for `name` may run. The lock/default are read
  // live so a POST /__host/config change takes effect without a restart. Only
  // resolve the branch the lock actually uses.
  const modelGate = (name: string | null): ModelGateResult => {
    const lock = getLockModel();
    return decideModelGate({
      lockModel: lock,
      requestedName: name,
      pinned: null,
      pinnedModels: lock ? pinnedModels() : [],
      resolved: lock ? null : resolveModel(name),
    });
  };

  /**
   * The cheap host status: everything `/__host/status` answers except the
   * opt-in `resources` block.
   *
   * One assembly feeds both the pull (`/__host/status`) and the push
   * (`/__host/events`). Keeping them as one function is the point: a field that
   * only the polled answer carried would be a field the rail silently lost the
   * moment a daemon stopped polling.
   */
  const buildCheapStatus = async (): Promise<BrainStatusSnapshot> => {
    const schedulerStats = scheduler ? scheduler.stats() : null;
    const residentSupervisors =
      scheduler && typeof scheduler.supervisors === "function"
        ? scheduler.supervisors()
        : [supervisor];
    const residents = residentSupervisors.filter(
      (candidate) => candidate.model !== null && candidate.state !== "stopped",
    );
    // Slots come from a loopback GET on the resident llama-server. That is
    // cheap enough to pay on every sample - unlike GPU sampling, which spawns
    // `nvidia-smi` and stays opt-in. Skipped entirely unless a model is
    // resident, since there is nothing listening otherwise.
    const slots =
      supervisor.state === "ready"
        ? await sampleSlots({ host: supervisor.host, port: supervisor.internalPort }).catch(
            () => null,
          )
        : null;
    // Both truths are in hand exactly here, and nowhere else: `slots` is what
    // llama-server says is running, `inference` is what the proxy believes. A
    // missed release used to survive until the service restarted, because
    // `reasoning` outranks every engine signal on the rail. Reconciling the two
    // makes any such leak self-heal within a few samples, and `reconcile` is
    // built so it can only ever clear a request the engine contradicts (see
    // its own contract).
    const reaped = reasoningTracker.reconcile({
      busySlots: slots?.threads ? new Set(slots.threads.map((thread) => thread.slot)) : null,
      busyCount: slots ? slots.busy : null,
    });
    for (const request of reaped) {
      logger?.warn?.(
        `released inference stage ${request.id} (${request.stage}` +
          `${request.slotId === null ? "" : `, slot ${request.slotId}`}) after ` +
          `${Math.round(request.ageMs / 1000)}s the engine reported it idle - ` +
          `a completion did not report its end`,
      );
    }
    return {
      version,
      // Additive, and separate from `version`: the package version says which
      // build this is, this says which generation of the management contract it
      // speaks. A daemon reads this and `capabilities` rather than pinning a
      // package version.
      apiVersion: HOST_API_VERSION,
      ...supervisor.status(),
      residents: residents.map((resident) => resident.status()),
      telemetry: { ...telemetry.totals, warning: telemetry.warning },
      scheduler: schedulerStats,
      recent: telemetry.records.slice(-10),
      logLineCount: supervisor.logLines.length,
      // Carried inline rather than fetched from /__host/capabilities: the
      // daemon reads status constantly, and a separately cached copy would go
      // stale the moment the owner toggles allowRemoteConfig.
      capabilities: hostApi ? hostApi.capabilities() : null,
      // The three signals the Brain rail's icon is derived from. All are cheap
      // enough for the liveness path: `activity` is one stat of a file that is
      // usually absent, `reasoning` is in-process state, and `queued` is
      // already computed above.
      activity: readActivity(),
      reasoning: reasoningTracker.active,
      // Exact aggregate request stages from the proxy lifecycle. Unlike slot
      // phase sampling, this distinguishes silent prompt processing, reasoning
      // deltas and user-visible content even when several requests overlap.
      inference: reasoningTracker.snapshot,
      queued: schedulerStats ? schedulerStats.queued : 0,
      slots,
    };
  };

  // Publish rather than be polled. The publisher decides what counts as a
  // change (see status-events.ts); everything here just says "look again".
  if (statusEvents) {
    statusEvents.setSource(buildCheapStatus);
    supervisor.on("state", () => statusEvents.notify());
    supervisor.on("crashed", () => statusEvents.notify());
    reasoningTracker.onChange(() => statusEvents.notify());
  }

  return function handler(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Host-management read surface (`/__host/*`): the single API both the TUI and
    // Otto's GUI consume, so the two never drift. Status is live; config and
    // evals are point-in-time reads the daemon proxies to its settings UI.
    const path = (req.url || "").split("?")[0];

    // `/health` is the SERVICE's liveness, not the model's, and it is answered
    // here rather than proxied to llama-server. This host is multi-model and
    // starts unloaded whenever no default is configured ("Automatic"), so the
    // proxy path below would answer 503 for a perfectly healthy service with an
    // empty slot - which is exactly what the daemon's startup probe and `otto
    // brain status` read as "the service failed to start". Model readiness is
    // reported by `/__host/status` (and its event stream), which is where a
    // caller that actually needs it must look.
    if (path === "/health") {
      sendJson(res, {
        status: "ok",
        state: supervisor.state,
        model: supervisor.model?.displayName ?? null,
      });
      return;
    }

    if (path === "/__host/status") {
      // Resources cost an `nvidia-smi` spawn, so they are opt-in: the daemon
      // reads this route far more often than any UI does, and must not pay for
      // a panel it is not rendering.
      const wantsResources = /[?&]resources=1(&|$)/.test(req.url || "");
      if (!wantsResources || !getResources) {
        void buildCheapStatus().then((base) => sendJson(res, base));
        return;
      }
      Promise.all([buildCheapStatus(), getResources().catch(() => null)])
        .then(([base, resources]) => sendJson(res, { ...base, resources }))
        .catch((error: unknown) =>
          sendError(res, 500, `could not build the host status: ${errorMessage(error)}`),
        );
      return;
    }
    // Config write: apply an editable patch (model/lock live, the rest persisted).
    // Must precede the GET read below, which matches the same URL for any method.
    // Refused unless the owner opted into remote configuration.
    if (req.method === "POST" && path === "/__host/config") {
      if (!applyConfigPatch || !getAllowConfigWrite()) {
        sendError(res, 403, "remote configuration is disabled on this brain");
        return;
      }
      readJsonBody(req, MAX_REQUEST_BYTES, (result) => {
        if (!result.ok) {
          sendError(res, 400, result.error);
          return;
        }
        logger?.info?.("received host configuration update");
        applyConfigPatch(result.body)
          .then((cfg) => {
            logger?.info?.("applied host configuration update");
            return sendJson(res, cfg);
          })
          .catch((err) => sendError(res, 500, `could not apply config: ${errorMessage(err)}`));
      });
      return;
    }
    if (path === "/__host/config" && getConfig) {
      sendJson(res, getConfig());
      return;
    }
    if (path === "/__host/evals" && getEvals) {
      sendJson(res, getEvals());
      return;
    }

    // The management API: inventory, profiles, budget, load/unload, delete, logs.
    // It claims only the routes it implements and returns false otherwise, so an
    // unknown /__host/* path still falls through to the 503/proxy path below
    // rather than being swallowed here.
    if (hostApi && hostApi.handle(req, res)) return;

    // Answer model discovery ourselves so ids are real names (not paths), the
    // whole catalog is listed, and each carries LM Studio's context fields.
    if (handleModelsRoute(req, res, supervisor, getCatalog, scheduler)) return;

    // With a scheduler wired in, completion requests are queued and served in
    // turns - including loading/switching to the model they ask for - instead
    // of failing when it is not the resident one.
    if (scheduler && COMPLETION_RE.test(req.url || "")) {
      scheduleCompletion({
        req,
        res,
        agent,
        telemetry,
        logger,
        scheduler,
        modelGate,
      });
      return;
    }

    if (supervisor.state !== "ready") {
      const detail =
        supervisor.state === "starting"
          ? `The model is still loading (${supervisor.model?.displayName ?? "unknown"}). Retry shortly.`
          : `No model is currently loaded (state: ${supervisor.state}).${supervisor.lastError ? ` Last error: ${supervisor.lastError}` : ""}`;
      const body = errorBody(503, detail);
      res.writeHead(503, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "retry-after": "5",
      });
      res.end(body);
      return;
    }

    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
    }
    headers.host = `${supervisor.host}:${supervisor.internalPort}`;

    const started = Date.now();
    const upstream = http.request(
      {
        host: supervisor.host,
        port: supervisor.internalPort,
        path: req.url,
        method: req.method,
        headers,
        agent,
      },
      (upstreamRes) => {
        const outHeaders: http.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (!HOP_BY_HOP.has(name.toLowerCase())) outHeaders[name] = value;
        }
        res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);

        const isCompletion = COMPLETION_RE.test(req.url || "");
        const isStream = String(upstreamRes.headers["content-type"] || "").includes("event-stream");

        if (!isCompletion || isStream) {
          // Streaming: pass through untouched, but note whether any content
          // delta ever arrived so a reasoning-only stream is still visible.
          let sawContent = false;
          let sawReasoning = false;
          if (isCompletion) {
            const lease = reasoningTracker.begin();
            // Released on close, not just on end: an aborted stream would
            // otherwise pin `/__host/status` on "thinking" forever.
            const releaseReasoning = () => lease.end();
            upstreamRes.on("data", (chunk: Buffer) => {
              const text = String(chunk);
              lease.observe(text);
              if (chunkHasContent(text)) sawContent = true;
              if (chunkHasReasoning(text)) sawReasoning = true;
            });
            upstreamRes.on("close", releaseReasoning);
            upstreamRes.on("error", releaseReasoning);
            upstreamRes.on("end", () => {
              releaseReasoning();
              telemetry.record({
                at: new Date().toISOString(),
                path: req.url,
                ms: Date.now() - started,
                streamed: true,
                verdict: !sawContent && sawReasoning ? "reasoning-only" : "ok",
              });
            });
          }
          upstreamRes.pipe(res);
          return;
        }

        // Non-streaming completion: tee the body so we can classify it.
        const chunks: Buffer[] = [];
        let size = 0;
        upstreamRes.on("data", (chunk: Buffer) => {
          if (size < MAX_ANALYSIS_BYTES) {
            chunks.push(chunk);
            size += chunk.length;
          }
          if (!res.writableEnded && !res.destroyed) res.write(chunk);
        });
        upstreamRes.on("end", () => {
          if (!res.writableEnded && !res.destroyed) res.end();
          const analysis = analyse(Buffer.concat(chunks).toString("utf8"));
          const entry: TelemetryRecord = {
            at: new Date().toISOString(),
            path: req.url,
            ms: Date.now() - started,
            streamed: false,
            ...(analysis ?? { verdict: "ok" }),
          };
          telemetry.record(entry);
          if (entry.verdict === "reasoning-only") {
            logger?.warn(
              `reasoning-only response: ${entry.outputTokens} tokens, ${entry.reasoningChars} reasoning chars, 0 content`,
            );
          }
        });
      },
    );

    res.on("close", () => {
      if (!res.writableFinished && !upstream.destroyed) upstream.destroy();
    });

    // A broken client socket makes the response stream emit 'error'. Without a
    // listener Node rethrows it as uncaught and takes the whole host down, so
    // absorb it and tear the upstream request down.
    res.on("error", () => {
      if (!upstream.destroyed) upstream.destroy();
    });

    upstream.on("error", (error: Error) => {
      telemetry.record({
        at: new Date().toISOString(),
        path: req.url,
        verdict: "failed",
        error: error.message,
      });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const body = errorBody(502, `Upstream llama-server error: ${error.message}`);
      res.writeHead(502, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    });

    req.pipe(upstream);
  };
}

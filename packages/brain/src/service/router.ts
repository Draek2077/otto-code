import http from "node:http";

import { Scheduler } from "./scheduler.js";
import type { Supervisor } from "./supervisor.js";
import { makeVramFitPredicate, selectCodingModel } from "./model-selector.js";
import { query as queryGpu } from "../gpu.js";
import { rankModels, type RankedModel } from "../ops/results.js";
import type { GpuInfo, Model, ModelMetadata } from "../types.js";
import type { Profile } from "../config/schema.js";

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

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const MAX_ANALYSIS_BYTES = 2 * 1024 * 1024;
// Completion bodies are buffered so the scheduler can read `model` and replay
// them after a possible model switch. Long-context prompts are large but bounded.
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const COMPLETION_RE = /\/v1\/(messages|chat\/completions)/;

type Verdict = "ok" | "reasoning-only" | "truncated" | "failed";

/** A logger sink; only `warn` is used by the router. */
export interface Logger {
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

  /** Advice derived from observed behaviour, not guesswork. */
  get warning(): string | null {
    const { requests, reasoningOnly, truncated } = this.totals;
    if (requests < 3) return null;
    if (reasoningOnly / requests > 0.3) {
      return `${reasoningOnly}/${requests} responses spent all tokens on reasoning and returned no content - lower the reasoning budget`;
    }
    if (truncated / requests > 0.3) {
      return `${truncated}/${requests} responses hit the token limit - raise the client's max_tokens`;
    }
    return null;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function errorBody(status: number, message: string): string {
  return JSON.stringify({
    type: "error",
    error: { type: status === 503 ? "overloaded_error" : "api_error", message },
  });
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
    // Standard OpenAI fields — id is the friendly name, never the file path.
    id: model.displayName,
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
    max_context_length: md.contextLength ?? null,
  };
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
export function buildModelList(supervisor: Supervisor, getCatalog: GetCatalog): ModelEntry[] {
  const loadedId = supervisor.model ? supervisor.model.id : null;
  const stateOf = (model: Model): ModelState => {
    if (!loadedId || model.id !== loadedId) return "not-loaded";
    if (supervisor.state === "ready") return "loaded";
    if (supervisor.state === "starting") return "loading";
    return "not-loaded";
  };

  let catalog = resolveCatalog(getCatalog);
  // Guarantee the running model appears even if the snapshot predates it.
  if (supervisor.model && !catalog.some((m) => m.id === loadedId)) {
    catalog = [supervisor.model, ...catalog];
  }

  return catalog.map((model) =>
    describeModel(model, {
      state: stateOf(model),
      profile: model.id === loadedId ? supervisor.profile : null,
      createdAt: model.id === loadedId ? supervisor.startedAt : null,
    }),
  );
}

/** Handle the model-discovery endpoints ourselves; returns true if it did. */
function handleModelsRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  supervisor: Supervisor,
  getCatalog: GetCatalog,
): boolean {
  if (req.method !== "GET") return false;
  const url = (req.url || "").split("?")[0];
  const isList = url === "/v1/models" || url === "/api/v0/models";
  const single = url.startsWith("/v1/models/")
    ? decodeURIComponent(url.slice("/v1/models/".length))
    : null;
  if (!isList && single === null) return false;

  const list = buildModelList(supervisor, getCatalog);
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

function sendError(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.destroy();
    return;
  }
  const body = errorBody(status, message);
  const headers: http.OutgoingHttpHeaders = {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  };
  if (status === 503) headers["retry-after"] = "5";
  res.writeHead(status, headers);
  res.end(body);
}

interface ProxyBufferedOptions {
  agent: http.Agent;
  supervisor: Supervisor;
  telemetry: Telemetry;
  logger?: Logger | null;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  body: Buffer;
}

/**
 * Forward a buffered completion body to the resident llama-server and stream the
 * reply back, teeing non-streaming bodies for classification. Resolves once the
 * client response is fully concluded (it owns the response in every outcome,
 * including upstream errors), so the scheduler can move to the next turn.
 */
function proxyBuffered({
  agent,
  supervisor,
  telemetry,
  logger,
  req,
  res,
  body,
}: ProxyBufferedOptions): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
    }
    headers.host = `${supervisor.host}:${supervisor.internalPort}`;
    headers["content-length"] = Buffer.byteLength(body);

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
        const isStream = String(upstreamRes.headers["content-type"] || "").includes("event-stream");

        if (isStream) {
          let sawContent = false;
          let sawReasoning = false;
          upstreamRes.on("data", (chunk: Buffer) => {
            const text = String(chunk);
            if (text.includes('"text_delta"') || /"content"\s*:\s*"[^"]/.test(text))
              sawContent = true;
            if (text.includes("thinking") || text.includes("reasoning")) sawReasoning = true;
          });
          upstreamRes.on("end", () => {
            telemetry.record({
              at: new Date().toISOString(),
              path: req.url,
              ms: Date.now() - started,
              streamed: true,
              verdict: !sawContent && sawReasoning ? "reasoning-only" : "ok",
            });
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
      sendError(res, 502, `Upstream llama-server error: ${error.message}`);
      done();
    });

    upstream.end(body);
  });
}

interface ScheduleCompletionOptions {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  agent: http.Agent;
  supervisor: Supervisor;
  telemetry: Telemetry;
  logger?: Logger | null;
  scheduler: Scheduler;
  resolveModel: (name: string | null) => Model | null;
}

/** Buffer a completion request, resolve its target model, and queue it. */
function scheduleCompletion({
  req,
  res,
  agent,
  supervisor,
  telemetry,
  logger,
  scheduler,
  resolveModel,
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
    try {
      const parsed: unknown = JSON.parse(body.toString("utf8"));
      modelName = isRecord(parsed) && typeof parsed.model === "string" ? parsed.model : null;
    } catch {
      /* leave null */
    }

    const model = resolveModel(modelName);
    if (!model) {
      sendError(
        res,
        modelName ? 404 : 503,
        modelName
          ? `model "${modelName}" was not found in the catalog`
          : "no model is available to serve",
      );
      return;
    }

    scheduler
      .submit(model, () => proxyBuffered({ agent, supervisor, telemetry, logger, req, res, body }))
      .catch((error: unknown) =>
        sendError(res, 502, `could not serve ${model.displayName}: ${errorMessage(error)}`),
      );
  });
}

// The bench ranking is read from disk (one JSON per run). A completion request
// must not pay that IO, and rankings only change when a bench run finishes
// (rare), so the router caches the ranking and re-reads it at most once per
// window — the cheap time-based trigger.
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
}

export function createRouter({
  supervisor,
  telemetry,
  logger,
  getCatalog = null,
  loadModel = null,
  loadRanking = () => rankModels(),
  queryGpuInfo = queryGpu,
}: RouterOptions): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
  const scheduler = loadModel
    ? new Scheduler({ supervisor, loadModel, logger: (m) => logger?.warn?.(m) })
    : null;

  // GPU total VRAM is static hardware, so it is queried once at startup and
  // cached. Absent (no nvidia-smi) or not-yet-resolved leaves the fit predicate
  // undefined, and the selector skips the VRAM filter — mirroring serve.ts.
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

  return function handler(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url === "/__host/status") {
      const body = JSON.stringify(
        {
          ...supervisor.status(),
          telemetry: { ...telemetry.totals, warning: telemetry.warning },
          scheduler: scheduler ? scheduler.stats() : null,
          recent: telemetry.records.slice(-10),
        },
        null,
        2,
      );
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    // Answer model discovery ourselves so ids are real names (not paths), the
    // whole catalog is listed, and each carries LM Studio's context fields.
    if (handleModelsRoute(req, res, supervisor, getCatalog)) return;

    // With a scheduler wired in, completion requests are queued and served in
    // turns — including loading/switching to the model they ask for — instead
    // of failing when it is not the resident one.
    if (scheduler && COMPLETION_RE.test(req.url || "")) {
      scheduleCompletion({
        req,
        res,
        agent,
        supervisor,
        telemetry,
        logger,
        scheduler,
        resolveModel,
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

        const isCompletion = /\/v1\/(messages|chat\/completions)/.test(req.url || "");
        const isStream = String(upstreamRes.headers["content-type"] || "").includes("event-stream");

        if (!isCompletion || isStream) {
          // Streaming: pass through untouched, but note whether any content
          // delta ever arrived so a reasoning-only stream is still visible.
          let sawContent = false;
          let sawReasoning = false;
          if (isCompletion) {
            upstreamRes.on("data", (chunk: Buffer) => {
              const text = String(chunk);
              if (text.includes('"text_delta"') || /"content"\s*:\s*"[^"]/.test(text))
                sawContent = true;
              if (text.includes("thinking") || text.includes("reasoning")) sawReasoning = true;
            });
            upstreamRes.on("end", () => {
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

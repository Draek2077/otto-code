import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Logger } from "pino";
import { z } from "zod";

import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";

const DEFAULT_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;
const APP_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 2_000;
const APP_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS = 1_000;
const STDERR_BUFFER_LIMIT = 8192;
// V8 cannot build strings much past 2^29 characters, and appending past that throws an uncaught
// RangeError inside the stdout "data" handler, killing the daemon worker. A resumed thread with
// weeks of history can exceed it in a single JSON-RPC line, so stop well short of the limit.
const DEFAULT_MAX_STDOUT_LINE_LENGTH = 256 * 1024 * 1024;
const LOGGED_LINE_PREVIEW_LENGTH = 500;

interface JsonRpcRequest {
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { message?: string; code?: string | number; data?: unknown };
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class CodexAppServerRpcError extends Error {
  constructor(
    message: string,
    readonly code: string | number | undefined,
    readonly data: unknown,
  ) {
    super(message);
    this.name = "CodexAppServerRpcError";
  }
}

type RequestHandler = (params: unknown, requestId: number) => unknown;
type NotificationHandler = (method: string, params: unknown) => void;
type UnexpectedTerminationHandler = (error: Error) => void;

export interface CodexThreadForkParams {
  threadId: string;
  beforeTurnId?: string | null;
  path?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  approvalPolicy?: unknown;
  approvalsReviewer?: unknown;
  sandbox?: unknown;
  permissions?: string | null;
  config?: Record<string, unknown> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean;
  threadSource?: unknown;
  excludeTurns?: boolean;
  persistExtendedHistory?: boolean;
}

const CodexThreadForkResponseSchema = z
  .object({
    thread: z
      .object({
        id: z.string(),
        sessionId: z.string().optional(),
        forkedFromId: z.string().nullable().optional(),
        turns: z.array(z.unknown()).optional(),
      })
      .passthrough(),
    model: z.string(),
    modelProvider: z.string(),
    serviceTier: z.string().nullable(),
    cwd: z.string(),
    runtimeWorkspaceRoots: z.array(z.string()).optional().default([]),
    instructionSources: z.array(z.string()).optional().default([]),
    approvalPolicy: z.unknown(),
    approvalsReviewer: z.unknown(),
    sandbox: z.unknown(),
    activePermissionProfile: z.unknown().optional(),
    reasoningEffort: z.string().nullable().optional(),
  })
  .passthrough();

export type CodexThreadForkResponse = z.infer<typeof CodexThreadForkResponseSchema>;

export function parseCodexThreadForkResponse(response: unknown): CodexThreadForkResponse {
  return CodexThreadForkResponseSchema.parse(response);
}

export interface CodexThreadRollbackParams {
  threadId: string;
  numTurns: number;
}

const CodexThreadRollbackResponseSchema = z
  .object({
    thread: z
      .object({
        id: z.string(),
        sessionId: z.string().optional(),
        forkedFromId: z.string().nullable().optional(),
        turns: z.array(z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type CodexThreadRollbackResponse = z.infer<typeof CodexThreadRollbackResponseSchema>;

export function parseCodexThreadRollbackResponse(response: unknown): CodexThreadRollbackResponse {
  return CodexThreadRollbackResponseSchema.parse(response);
}

export interface CodexAppServerTraceContext {
  agentId?: string;
  sessionId?: string;
  turnId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
  if (!isRecord(msg)) return false;
  return typeof msg.id === "number";
}

function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  if (!isRecord(msg)) return false;
  return typeof msg.id === "number" && typeof msg.method === "string";
}

function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
  if (!isRecord(msg)) return false;
  return typeof msg.method === "string" && msg.id === undefined;
}

function readProviderSessionId(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  return typeof params.threadId === "string" ? params.threadId : undefined;
}

function readProviderTurnId(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  if (typeof params.turnId === "string") {
    return params.turnId;
  }
  const turn = params.turn;
  return isRecord(turn) && typeof turn.id === "string" ? turn.id : undefined;
}

/** Logs a line by length and preview, since a full line can be hundreds of megabytes. */
function describeLine(line: string): { lineLength: number; linePreview: string } {
  return { lineLength: line.length, linePreview: line.slice(0, LOGGED_LINE_PREVIEW_LENGTH) };
}

/**
 * Splits stdout into lines on "\n" only. `node:readline` additionally treats U+2028 and U+2029
 * as line terminators, but Codex emits those characters raw inside JSON strings, so readline
 * would cut a single JSON-RPC message into pieces that fail to parse.
 *
 * A line longer than `maxLineLength` is discarded instead of buffered; `onOversizedLine` is
 * called once when it crosses the limit.
 */
function createNewlineLineReader(
  input: NodeJS.ReadableStream,
  onLine: (line: string) => void,
  maxLineLength: number,
  onOversizedLine: (lineLength: number) => void,
): { close(): void } {
  const decoder = new StringDecoder("utf8");
  // Text after the last "\n", kept as parts and joined once its line ends, so a large line
  // arriving in many chunks is scanned and copied once instead of once per chunk.
  let unterminated: string[] = [];
  let unterminatedLength = 0;
  let discarding = false;
  const append = (part: string): void => {
    if (discarding) return;
    unterminatedLength += part.length;
    if (unterminatedLength > maxLineLength) {
      unterminated = [];
      discarding = true;
      onOversizedLine(unterminatedLength);
      return;
    }
    unterminated.push(part);
  };
  const onData = (chunk: Buffer | string): void => {
    const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
    let lineStart = 0;
    let index = text.indexOf("\n");
    while (index !== -1) {
      append(text.slice(lineStart, index));
      if (!discarding) {
        const line = unterminated.join("");
        onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
      }
      unterminated = [];
      unterminatedLength = 0;
      discarding = false;
      lineStart = index + 1;
      index = text.indexOf("\n", lineStart);
    }
    if (lineStart < text.length) {
      append(text.slice(lineStart));
    }
  };
  input.on("data", onData);
  return { close: () => void input.off("data", onData) };
}

export class CodexAppServerClient {
  private readonly stdoutLineReader: { close(): void };
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private notificationHandler: NotificationHandler | null = null;
  private unexpectedTerminationHandler: UnexpectedTerminationHandler | null = null;
  private nextId = 1;
  private disposed = false;
  private stderrBuffer = "";

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly logger: Logger,
    private readonly getTraceContext: () => CodexAppServerTraceContext = () => ({}),
    options: { maxStdoutLineLength?: number } = {},
  ) {
    const maxStdoutLineLength = options.maxStdoutLineLength ?? DEFAULT_MAX_STDOUT_LINE_LENGTH;
    this.stdoutLineReader = createNewlineLineReader(
      child.stdout,
      (line) => {
        void this.handleLine(line).catch((error) => {
          this.logger.warn(
            { error, ...describeLine(line) },
            "Failed to handle Codex app-server stdout line",
          );
        });
      },
      maxStdoutLineLength,
      (lineLength) => this.handleOversizedStdoutLine(lineLength, maxStdoutLineLength),
    );

    child.stderr.on("data", (chunk) => {
      this.stderrBuffer += chunk.toString();
      if (this.stderrBuffer.length > STDERR_BUFFER_LIMIT) {
        this.stderrBuffer = this.stderrBuffer.slice(-STDERR_BUFFER_LIMIT);
      }
    });

    child.on("error", (err) => {
      this.logger.error({ err }, "Codex app-server child process error");
      this.handleUnexpectedTermination(err);
    });

    child.on("exit", (code, signal) => {
      const message =
        code === 0 && !signal
          ? "Codex app-server exited"
          : `Codex app-server exited with code ${code ?? "null"} and signal ${signal ?? "null"}`;
      const error = new Error(`${message}\n${this.stderrBuffer}`.trim());
      this.handleUnexpectedTermination(error);
    });
  }

  setUnexpectedTerminationHandler(handler: UnexpectedTerminationHandler): void {
    this.unexpectedTerminationHandler = handler;
  }

  setNotificationHandler(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  setRequestHandler(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  request(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("Codex app-server client is closed"));
    }
    const id = this.nextId++;
    const payload: JsonRpcRequest = { id, method, params };
    const serialized = JSON.stringify(payload);
    this.child.stdin.write(`${serialized}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async forkThread(params: CodexThreadForkParams): Promise<CodexThreadForkResponse> {
    return parseCodexThreadForkResponse(await this.request("thread/fork", params));
  }

  async rollbackThread(params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse> {
    return parseCodexThreadRollbackResponse(await this.request("thread/rollback", params));
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed) {
      return;
    }
    const payload: JsonRpcNotification = { method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.unexpectedTerminationHandler = null;
    this.stdoutLineReader.close();
    this.rejectPending(new Error("Codex app-server client is closed"));
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    const result = await terminateWithTreeKill(this.child, {
      gracefulTimeoutMs: APP_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
      forceTimeoutMs: APP_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS,
      onForceSignal: () => {
        this.logger.warn(
          { timeoutMs: APP_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS },
          "Codex app-server did not exit after SIGTERM; sending SIGKILL",
        );
      },
    });
    if (result === "kill-timeout") {
      throw new Error("Codex app-server did not report exit after SIGKILL");
    }
  }

  private handleUnexpectedTermination(error: Error): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stdoutLineReader.close();
    this.rejectPending(error);
    const handler = this.unexpectedTerminationHandler;
    this.unexpectedTerminationHandler = null;
    if (!handler) {
      return;
    }
    try {
      handler(error);
    } catch (handlerError) {
      this.logger.warn({ err: handlerError }, "Codex app-server termination handler threw");
    }
  }

  /**
   * The message cannot be read, so whichever request it answered would never settle. Treat the
   * app-server as failed: reject everything pending and stop the process, leaving the daemon up.
   */
  private handleOversizedStdoutLine(lineLength: number, maxStdoutLineLength: number): void {
    const traceContext = this.getTraceContext();
    this.logger.error(
      { agentId: traceContext.agentId, lineLength, maxStdoutLineLength },
      "Codex app-server stdout line exceeded the size limit; closing the app-server",
    );
    this.handleUnexpectedTermination(
      new Error(
        `Codex app-server sent a message larger than ${maxStdoutLineLength} characters ` +
          "(the thread history is likely too large to resume)",
      ),
    );
    void this.dispose().catch((error) => {
      this.logger.warn({ error }, "Failed to stop Codex app-server after an oversized message");
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private writeJsonRpcResponse(response: JsonRpcResponse): void {
    if (this.disposed || this.child.stdin.destroyed || !this.child.stdin.writable) {
      return;
    }
    try {
      this.child.stdin.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      this.logger.debug({ error }, "Failed to write Codex app-server JSON-RPC response");
    }
  }

  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      this.logger.warn(
        { error, ...describeLine(line) },
        "Ignoring non-JSON Codex app-server stdout line",
      );
      return;
    }

    if (!isRecord(raw)) {
      this.logger.warn(describeLine(line), "Parsed JSON is not an object");
      return;
    }

    if (isJsonRpcResponse(raw)) {
      const id = raw.id;
      if (raw.result !== undefined || raw.error) {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        if (raw.error) {
          pending.reject(
            new CodexAppServerRpcError(
              raw.error.message ?? "Unknown error",
              raw.error.code,
              raw.error.data,
            ),
          );
        } else {
          pending.resolve(raw.result);
        }
        return;
      }

      if (isJsonRpcRequest(raw)) {
        const request = raw;
        this.traceRawEvent(request);
        const handler = this.requestHandlers.get(request.method);
        try {
          const result = handler ? await handler(request.params, request.id) : {};
          this.writeJsonRpcResponse({ id: request.id, result });
        } catch (error) {
          this.writeJsonRpcResponse({
            id: request.id,
            error: { message: error instanceof Error ? error.message : String(error) },
          });
        }
        return;
      }
    }

    if (isJsonRpcNotification(raw)) {
      this.traceRawEvent(raw);
      this.notificationHandler?.(raw.method, raw.params);
    }
  }

  private traceRawEvent(raw: JsonRpcRequest | JsonRpcNotification): void {
    const traceContext = this.getTraceContext();
    this.logger.trace(
      {
        provider: "codex",
        agentId: traceContext.agentId,
        sessionId: traceContext.sessionId ?? readProviderSessionId(raw.params),
        turnId: traceContext.turnId ?? readProviderTurnId(raw.params),
        method: raw.method,
        params: raw.params,
        rawEvent: raw,
      },
      "provider.codex.raw_event",
    );
  }
}

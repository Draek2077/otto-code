import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";
import { z } from "zod";
import {
  sharedDotnetProcessRegistry,
  type TrackedDotnetProcess,
} from "../../dotnet-process-registry.js";
import { SUPPORTED_PROTOCOL_VERSION, type DotnetRuntimeInfo } from "./bootstrap.js";

/**
 * One sidecar process: spawn, handshake, newline-delimited JSON framing, per-request timeouts,
 * and an honest report when it dies.
 *
 * Everything crossing this boundary is re-validated. The process is ours, but it is still a
 * foreign runtime writing JSON, and a shape mismatch that reaches the store would surface as an
 * unreadable tree three layers away from its cause.
 */

const HandshakeSchema = z.object({
  ready: z.literal(true),
  protocolVersion: z.number().int(),
  sdkVersion: z.string(),
  msbuildPath: z.string(),
});

const ResponseSchema = z.object({
  id: z.string().nullable().optional(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

export type ProbeHandshake = z.infer<typeof HandshakeSchema>;

export class ProbeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeUnavailableError";
  }
}

/**
 * The sidecar answered, and its answer was "no". Distinct from the process dying: one project
 * that fails to evaluate is a per-node error carrying MSBuild's own message, and must not be
 * mistaken for a crash the pool should back off from.
 */
export class ProbeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeRequestError";
  }
}

export interface DotnetProbeOptions {
  runtime: DotnetRuntimeInfo;
  logger: Logger;
  /** Working directory for the process — the workspace, so relative diagnostics read sensibly. */
  cwd: string;
  handshakeTimeoutMs: number;
  requestTimeoutMs: number;
  onExit?: () => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class DotnetProbe {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly logger: Logger;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<string, Pending>();
  private buffer = "";
  private nextId = 1;
  private exited = false;
  private handshake: ProbeHandshake | null = null;
  /** Settled by the first line the process writes, which must be the handshake. */
  private handshakeWaiter: ((error: Error | null) => void) | null = null;
  /** Set by `start` immediately after construction; owns the registry slot and the kill. */
  private tracked: TrackedDotnetProcess | null = null;

  private constructor(child: ChildProcessWithoutNullStreams, options: DotnetProbeOptions) {
    this.child = child;
    this.logger = options.logger;
    this.requestTimeoutMs = options.requestTimeoutMs;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.ingest(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // The sidecar writes nothing to stderr in normal operation, so anything here is worth
      // seeing — it is where "no SDK" and an unhandled MSBuild fault come out.
      this.logger.debug({ output: chunk.trim() }, "dotnet probe stderr");
    });
    child.on("exit", (code, signal) => {
      this.exited = true;
      this.rejectAll(
        new ProbeUnavailableError(`Solution sidecar exited (code ${code}, signal ${signal})`),
      );
      options.onExit?.();
    });
    child.on("error", (error) => {
      this.exited = true;
      this.rejectAll(new ProbeUnavailableError(`Solution sidecar failed: ${error.message}`));
      options.onExit?.();
    });
  }

  /**
   * Spawn and wait for the handshake. The handshake is not decoration: it is where the process
   * reports that it found an SDK, and refusing a payload whose protocol version we do not know
   * is what keeps a stale `dist/` from producing garbled trees rather than a clear failure.
   */
  static async start(options: DotnetProbeOptions): Promise<DotnetProbe> {
    // Through the registry, never `spawn` directly: it is what enforces the machine-wide
    // .NET process cap and what guarantees this process is swept on shutdown even if the
    // pool loses track of it. `MSBUILD_ENV` is applied there, for every caller at once.
    const tracked = sharedDotnetProcessRegistry(options.logger).spawnTracked({
      command: options.runtime.dotnetCommand,
      args: [options.runtime.entryPath],
      options: {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          // MSBuild colours and progress would corrupt the NDJSON stream if anything ever
          // wrote them to stdout, and neither is readable by a machine anyway.
          NO_COLOR: "1",
        },
      },
      kind: "solution-sidecar",
      label: options.cwd,
    });

    const probe = new DotnetProbe(tracked.child as ChildProcessWithoutNullStreams, options);
    probe.tracked = tracked;
    try {
      await probe.awaitHandshake(options.handshakeTimeoutMs);
    } catch (error) {
      // A sidecar that never reports ready still holds a slot and a live process tree.
      tracked.release();
      throw error;
    }
    return probe;
  }

  get sdkVersion(): string | null {
    return this.handshake?.sdkVersion ?? null;
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  async request<T>(
    method: string,
    params: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (this.exited) {
      throw new ProbeUnavailableError("Solution sidecar is not running");
    }

    const id = String(this.nextId++);
    const raw = await new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new ProbeUnavailableError(`Solution sidecar timed out on ${method}`));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ProbeUnavailableError(
        `Solution sidecar returned an unreadable ${method} payload: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  stop(): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.child.stdin.end();
    // Release, not kill: the registry owns the tree kill and the slot, so going around it
    // would free the process without freeing the capacity it was holding.
    this.tracked?.release();
    this.rejectAll(new ProbeUnavailableError("Solution sidecar stopped"));
  }

  private awaitHandshake(timeoutMs: number): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.stop();
        rejectPromise(new ProbeUnavailableError("Solution sidecar did not report ready"));
      }, timeoutMs);
      timer.unref?.();

      this.handshakeWaiter = (error) => {
        clearTimeout(timer);
        this.handshakeWaiter = null;
        if (error === null) {
          resolvePromise();
        } else {
          this.stop();
          rejectPromise(error);
        }
      };
    });
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (line.length > 0) {
        this.handleLine(line);
      }
    }
  }

  private handleLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.logger.warn({ line: line.slice(0, 200) }, "dotnet probe wrote a non-JSON line");
      return;
    }

    if (this.handshake === null) {
      const parsed = HandshakeSchema.safeParse(value);
      if (!parsed.success) {
        this.handshakeWaiter?.(new ProbeUnavailableError("Solution sidecar sent no handshake"));
        return;
      }
      if (parsed.data.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
        this.handshakeWaiter?.(
          new ProbeUnavailableError(
            `Solution sidecar speaks protocol ${parsed.data.protocolVersion}, this daemon speaks ${SUPPORTED_PROTOCOL_VERSION}. Rebuild it with \`npm run build:dotnet-probe\`.`,
          ),
        );
        return;
      }
      this.handshake = parsed.data;
      this.logger.info({ sdkVersion: parsed.data.sdkVersion }, "solution sidecar ready");
      this.handshakeWaiter?.(null);
      return;
    }

    const parsed = ResponseSchema.safeParse(value);
    if (!parsed.success || typeof parsed.data.id !== "string") {
      this.logger.warn("dotnet probe wrote a response with no request id");
      return;
    }
    const waiting = this.pending.get(parsed.data.id);
    if (waiting === undefined) {
      return;
    }
    this.pending.delete(parsed.data.id);
    clearTimeout(waiting.timer);
    if (parsed.data.ok) {
      waiting.resolve(parsed.data.result);
    } else {
      waiting.reject(
        new ProbeRequestError(parsed.data.error?.message ?? "Solution sidecar failed"),
      );
    }
  }

  private rejectAll(error: Error): void {
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
    this.handshakeWaiter?.(error);
  }
}

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnProcess, terminateProcess } from "@getpaseo/plugin/server";
import type { ProviderMcpServerConfig } from "@getpaseo/plugin/server/provider";
import { z } from "zod";
import { requireOk, sseEvents } from "./http.js";

const packetSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().optional(),
  result: z.json().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** Bidirectional MCP transports. Ownership starts at spawn/connect, before initialization. */
export class DuplexMcpClient {
  private readonly controller = new AbortController();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private child?: ChildProcessWithoutNullStreams;
  private exited?: Promise<void>;
  private receive?: Promise<void>;
  private messageUrl?: URL;
  private protocolVersion?: string;
  private failed?: Error;
  private closing?: Promise<void>;
  private endpointReady?: { resolve(): void; reject(error: Error): void };

  constructor(
    private readonly config: ProviderMcpServerConfig,
    private readonly timeoutMs: number,
    private readonly context: { cwd: string; env: Readonly<Record<string, string>> },
  ) {}

  private fail(error: unknown): void {
    this.failed ??= error instanceof Error ? error : new Error(String(error));
    this.endpointReady?.reject(this.failed);
    for (const request of this.pending.values()) request.reject(this.failed);
    this.pending.clear();
  }

  private async accept(value: unknown): Promise<void> {
    const parsed = packetSchema.safeParse(value);
    if (!parsed.success) throw new Error("Invalid MCP message.");
    const packet = parsed.data;
    if (packet.method && packet.id !== undefined) {
      await this.write(
        {
          jsonrpc: "2.0",
          id: packet.id,
          ...(packet.method === "ping"
            ? { result: {} }
            : { error: { code: -32601, message: "Unsupported server request." } }),
        },
        this.controller.signal,
      );
      return;
    }
    if (typeof packet.id !== "number") return;
    const request = this.pending.get(packet.id);
    if (!request) return;
    this.pending.delete(packet.id);
    if (packet.error)
      request.reject(new Error(`MCP ${packet.error.code}: ${packet.error.message}`));
    else if (Object.hasOwn(packet, "result")) request.resolve(packet.result);
    else request.reject(new Error("MCP returned a reply without a result."));
  }

  private startStdio(): void {
    if (this.config.type !== "stdio") throw new Error("Expected stdio MCP configuration.");
    const child = (this.child = spawnProcess(this.config.command, this.config.args ?? [], {
      cwd: this.context.cwd,
      env: { ...this.context.env, ...this.config.env },
      stdio: "pipe",
    }));
    this.exited = new Promise((resolve) =>
      child.once("close", () => {
        this.fail(new Error("The MCP process closed."));
        resolve();
      }),
    );
    child.on("error", () => this.fail(new Error("The MCP process could not start.")));
    child.stdin.on("error", () => this.fail(new Error("The MCP input stream closed.")));
    // Drain diagnostics without exposing a server's arbitrary output or credentials.
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk: string) => {
      if (this.failed) return;
      try {
        buffer += chunk;
        while (buffer.includes("\n")) {
          const end = buffer.indexOf("\n");
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (Buffer.byteLength(line) > 2 * 1024 * 1024)
            throw new Error("MCP message exceeds 2 MiB.");
          let packet: unknown;
          try {
            packet = JSON.parse(line);
          } catch {
            throw new Error("Invalid MCP message.");
          }
          void this.accept(packet).catch((error) => this.fail(error));
        }
        if (Buffer.byteLength(buffer) > 2 * 1024 * 1024)
          throw new Error("MCP message exceeds 2 MiB.");
      } catch (error) {
        this.fail(error);
      }
    });
    child.stdout.on("end", () => this.fail(new Error("The MCP output stream closed.")));
  }

  private async receiveSse(): Promise<void> {
    if (this.config.type === "stdio") throw new Error("Expected SSE MCP configuration.");
    const url = new URL(this.config.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("MCP requires an HTTP(S) endpoint without embedded credentials.");
    const headers = new Headers(this.config.headers);
    headers.set("accept", "text/event-stream");
    const response = await fetch(url, {
      headers,
      redirect: "error",
      signal: this.controller.signal,
    });
    await requireOk(response, "MCP SSE endpoint");
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      await response.body?.cancel();
      throw new Error("MCP SSE requires an event stream.");
    }
    for await (const event of sseEvents(response)) {
      if (event.event === "endpoint") {
        if (this.messageUrl) throw new Error("MCP SSE changed its message endpoint.");
        const messageUrl = new URL(event.data, url);
        if (
          messageUrl.origin !== url.origin ||
          messageUrl.username ||
          messageUrl.password ||
          messageUrl.hash
        )
          throw new Error("MCP SSE message endpoint must use the same origin.");
        this.messageUrl = messageUrl;
        this.endpointReady?.resolve();
      } else if (event.event === "message") {
        let packet: unknown;
        try {
          packet = JSON.parse(event.data);
        } catch {
          throw new Error("Invalid MCP message.");
        }
        await this.accept(packet);
      }
    }
    throw new Error("The MCP receive stream closed.");
  }

  private async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.config.type === "stdio") {
      this.startStdio();
      return;
    }
    const abort = () => this.controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        this.endpointReady = { resolve, reject };
        this.receive = this.receiveSse().catch((error) => this.fail(error));
      });
    } finally {
      signal.removeEventListener("abort", abort);
      this.endpointReady = undefined;
    }
  }

  private async write(packet: unknown, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.failed) throw this.failed;
    if (this.controller.signal.aborted) throw new Error("The MCP connection is closed.");
    const body = JSON.stringify(packet);
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error("MCP message exceeds 2 MiB.");
    if (this.child) {
      await new Promise<void>((resolve, reject) => {
        this.child!.stdin.write(`${body}\n`, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      return;
    }
    if (this.config.type === "stdio" || !this.messageUrl)
      throw new Error("MCP SSE has no message endpoint.");
    const headers = new Headers(this.config.headers);
    headers.set("content-type", "application/json");
    if (this.protocolVersion) headers.set("mcp-protocol-version", this.protocolVersion);
    const response = await fetch(this.messageUrl, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.any([signal, this.controller.signal]),
    });
    await requireOk(response, "MCP SSE message");
    await response.body?.cancel();
  }

  async request(method: string, params: unknown, callerSignal: AbortSignal): Promise<unknown> {
    const signal = AbortSignal.any([
      callerSignal,
      this.controller.signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);
    signal.throwIfAborted();
    if (this.failed) throw this.failed;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const clear = () => {
        this.pending.delete(id);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        clear();
        reject(signal.reason);
        if (!this.controller.signal.aborted)
          void this.write(
            {
              jsonrpc: "2.0",
              method: "notifications/cancelled",
              params: { requestId: id, reason: "Request canceled or timed out." },
            },
            AbortSignal.timeout(1000),
          ).catch(() => undefined);
      };
      this.pending.set(id, {
        resolve: (value) => {
          clear();
          resolve(value);
        },
        reject: (error) => {
          clear();
          reject(error);
        },
      });
      signal.addEventListener("abort", abort, { once: true });
      void this.write({ jsonrpc: "2.0", id, method, params }, signal).catch((error) =>
        this.pending.get(id)?.reject(error),
      );
    });
  }

  async initialize(signal: AbortSignal): Promise<string | undefined> {
    await this.start(AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]));
    const info = z
      .object({
        protocolVersion: z.enum(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]),
        instructions: z.string().max(65536).optional(),
      })
      .parse(
        await this.request(
          "initialize",
          {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "otto-openai-compatible", version: "1.0.0" },
          },
          signal,
        ),
      );
    this.protocolVersion = info.protocolVersion;
    await this.write(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
    );
    return info.instructions;
  }

  close(): Promise<void> {
    return (this.closing ??= this.shutdown());
  }

  private async shutdown(): Promise<void> {
    this.controller.abort();
    this.fail(new Error("The MCP connection is closed."));
    if (this.child) {
      this.child.stdin.end();
      await this.waitForExit(250);
      if (this.child.exitCode === null && this.child.signalCode === null)
        await terminateProcess(this.child);
      if (!(await this.waitForExit(5000)))
        throw new Error("The MCP process did not exit after termination.");
    }
    await this.receive;
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.exited!.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

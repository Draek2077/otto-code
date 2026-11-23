import { createHash } from "node:crypto";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadMcpTools } from "@getpaseo/plugin/server/otto-openai";
import { z } from "zod";
import type { ConnectorTool, ConnectorTransport } from "@getpaseo/plugin/otto/connectors";
import type { PaseoToolResult } from "../../../server/agent/tools/types.js";
import { ConnectorError } from "./configuration.js";
import { ConnectorStore } from "./store.js";
import {
  connectorPrivateValues as privateValues,
  redactConnectorText as redact,
  redactConnectorJson as sanitized,
} from "./redaction.js";

type Loaded = Awaited<ReturnType<typeof loadMcpTools>>;
type Opened = Awaited<ReturnType<ConnectorStore["open"]>>;
export interface ConnectorRuntimePorts {
  store: Pick<ConnectorStore, "open">;
  authorize(
    opened: Opened,
    signal: AbortSignal,
  ): Promise<{ server: ConnectorTransport; revision: string }>;
  load?: typeof loadMcpTools;
  now?: () => number;
  warn?(message: string): void;
}
interface Connection {
  identity: string;
  loaded: Loaded;
  tools: ConnectorTool[];
  names: Map<string, Loaded["tools"][number]>;
  lastUsed: number;
  active: number;
  pending: Promise<unknown>;
  secrets: string[];
  retired?: boolean;
}
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** One host-owned client pool for every provider. Reuses Otto's canonical MCP
 * harness, including bounded stdio/SSE/HTTP framing and Windows process cleanup.
 * No transport credentials are put in a provider launch config.
 */
export class ConnectorRuntime {
  private readonly cache = new Map<string, Connection>();
  private readonly connecting = new Map<string, Promise<Connection>>();
  private closed = false;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  constructor(private readonly ports: ConnectorRuntimePorts) {
    this.now = ports.now ?? Date.now;
  }

  private async connect(opened: Opened, cwd: string, signal: AbortSignal): Promise<Connection> {
    signal.throwIfAborted();
    if (this.closed) throw new ConnectorError("unavailable", "Connector tools are shutting down.");
    if (opened.bundle.builtin)
      throw new ConnectorError("validation", "This native connector must use its host API driver.");
    const authorized = await this.ports.authorize(opened, signal);
    signal.throwIfAborted();
    const key = JSON.stringify([opened.entry.id, authorized.server.type === "stdio" ? cwd : ""]);
    const identity = fingerprint([opened.entry.generation, authorized.revision]);
    const existing = this.cache.get(key);
    if (existing && !existing.retired && existing.identity === identity) {
      existing.lastUsed = this.now();
      return existing;
    }
    const underway = this.connecting.get(key);
    if (underway) {
      await underway;
      return this.connect(await this.ports.store.open(opened.entry.id), cwd, signal);
    }
    await this.sweep();
    if (!existing && this.cache.size + this.connecting.size >= 32)
      throw new ConnectorError(
        "unavailable",
        "Too many connector clients are active on this host. Close an idle workspace and try again.",
      );
    const task = this.create(key, identity, opened, authorized.server, cwd, signal);
    this.connecting.set(key, task);
    try {
      return await task;
    } finally {
      if (this.connecting.get(key) === task) this.connecting.delete(key);
    }
  }

  private async create(
    key: string,
    identity: string,
    opened: Opened,
    server: ConnectorTransport,
    cwd: string,
    signal: AbortSignal,
  ): Promise<Connection> {
    const previous = this.cache.get(key);
    if (previous) {
      if (previous.active)
        throw new ConnectorError(
          "unavailable",
          "This connector's authorization changed during an operation. Wait for it to finish, then retry explicitly.",
        );
      this.cache.delete(key);
      await previous.loaded.close();
    }
    await this.sweep();
    const admitted = await this.ports.store.open(opened.entry.id);
    if (this.closed || admitted.entry.generation !== opened.entry.generation)
      throw new ConnectorError(
        "conflict",
        "The connector changed before initialization. Refresh its settings.",
      );
    const loaded = await (this.ports.load ?? loadMcpTools)({ connector: server }, 30000, signal, {
      cwd,
      env: getDefaultEnvironment(),
    });
    const secrets = privateValues(server);
    try {
      const current = await this.ports.store.open(opened.entry.id);
      if (this.closed || current.entry.generation !== opened.entry.generation)
        throw new ConnectorError(
          "conflict",
          "This connector changed while connecting. Reload before trying again.",
        );
      const names = new Map<string, Loaded["tools"][number]>();
      const tools = loaded.tools.map((tool): ConnectorTool => {
        const name = tool.preapproval?.tool;
        if (!name || names.has(name))
          throw new ConnectorError(
            "vendor",
            "The connector returned missing or duplicate tool names.",
          );
        if (redact(name, secrets) !== name)
          throw new ConnectorError(
            "vendor",
            "The connector returned a credential inside a tool name. It was not admitted.",
          );
        names.set(name, tool);
        const parameters = z
          .record(z.string(), z.json())
          .parse(tool.definition.function.parameters);
        const safe = sanitized(parameters, secrets);
        if (JSON.stringify(safe) !== JSON.stringify(parameters))
          throw new ConnectorError(
            "vendor",
            "The connector's tool schema included a configured credential. It was not admitted.",
          );
        return {
          name,
          description: redact(tool.definition.function.description ?? "", secrets).slice(0, 16384),
          inputSchema: parameters,
          readOnly: tool.access === "read",
        };
      });
      if (tools.length === 0)
        throw new ConnectorError(
          "vendor",
          "The connector did not expose any tools. Check its account access and configuration.",
        );
      const connection: Connection = {
        identity,
        loaded,
        names,
        tools,
        lastUsed: this.now(),
        active: 0,
        pending: Promise.resolve(),
        secrets,
      };
      this.cache.set(key, connection);
      if (!this.idleTimer) {
        this.idleTimer = setInterval(() => {
          void this.sweep().catch(() =>
            this.ports.warn?.("An idle connector client could not be closed."),
          );
        }, 60000);
        this.idleTimer.unref();
      }
      return connection;
    } catch (error) {
      await loaded.close();
      throw error;
    }
  }

  async inspect(
    id: string,
    cwd: string,
    signal: AbortSignal,
    refresh = false,
  ): Promise<ConnectorTool[]> {
    if (refresh) await this.invalidate(id);
    const opened = await this.ports.store.open(id);
    const connection = await this.connect(opened, cwd, signal);
    return structuredClone(connection.tools);
  }

  async call(input: {
    id: string;
    cwd: string;
    name: string;
    schemaFingerprint: string;
    arguments: unknown;
    signal?: AbortSignal;
  }): Promise<PaseoToolResult> {
    const signal = input.signal ?? new AbortController().signal;
    const opened = await this.ports.store.open(input.id);
    this.requireEnabled(opened, input.name);
    const connection = await this.connect(opened, input.cwd, signal);
    const actual = connection.tools.find((tool) => tool.name === input.name);
    const tool = connection.names.get(input.name);
    if (!tool || !actual || connectorToolFingerprint(actual) !== input.schemaFingerprint)
      throw new ConnectorError(
        "conflict",
        "This connector's tools changed. Refresh the chat's tool catalog.",
      );
    connection.active++;
    let dispatched = false;
    const run = connection.pending
      .catch(() => undefined)
      .then(async () => {
        signal.throwIfAborted();
        const current = await this.ports.store.open(input.id);
        this.requireEnabled(current, input.name);
        if (current.entry.generation !== opened.entry.generation)
          throw new ConnectorError(
            "conflict",
            "This connector changed before execution. Refresh its tool catalog.",
          );
        const argumentsValue = z.record(z.string(), z.json()).parse(input.arguments);
        dispatched = true;
        const output = await tool.execute(argumentsValue, signal);
        const content: PaseoToolResult["content"] = [
          {
            type: "text",
            text: redact(typeof output === "string" ? output : output.text, connection.secrets),
          },
        ];
        if (typeof output !== "string") {
          for (const image of output.images) {
            if (redact(image.data, connection.secrets) !== image.data)
              throw new ConnectorError(
                "vendor",
                "The connector returned configured credential material in binary content. It was not forwarded.",
              );
            content.push(image);
          }
        }
        return { content };
      });
    connection.pending = run;
    try {
      return await run;
    } catch (error) {
      if (signal.aborted) throw new DOMException("Connector request canceled.", "AbortError");
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError(
        "vendor",
        redact(
          error instanceof Error ? error.message : "The connector operation failed.",
          connection.secrets,
        ).slice(0, 1800) +
          (dispatched && !actual.readOnly
            ? " The operation may have succeeded. Verify its result before repeating it."
            : ""),
      );
    } finally {
      connection.active--;
      connection.lastUsed = this.now();
      if (connection.retired)
        await this.sweep().catch(() =>
          this.ports.warn?.("A retired connector client could not be closed."),
        );
    }
  }

  private requireEnabled(opened: Opened, name: string) {
    if (!opened.entry.enabled || opened.entry.disabledTools.includes(name))
      throw new ConnectorError(
        "unavailable",
        "This connector or tool is disabled. Refresh the chat's tool catalog.",
      );
  }

  private async sweep() {
    for (const [key, connection] of this.cache) {
      if (!connection.active && (connection.retired || this.now() - connection.lastUsed > 300000)) {
        this.cache.delete(key);
        await connection.loaded.close();
      }
    }
    if (!this.cache.size && this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
  /** Stop idle clients immediately; a dispatched operation keeps its client
   * until settlement and is never canceled or replayed by a settings edit. */
  async invalidate(id: string): Promise<void> {
    for (const [key, connection] of this.cache) {
      if (JSON.parse(key)[0] === id) connection.retired = true;
    }
    await this.sweep();
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    const connections = [...this.cache.values()];
    this.cache.clear();
    await Promise.allSettled(connections.map((connection) => connection.loaded.close()));
    await Promise.allSettled(this.connecting.values());
  }
}
export function connectorToolFingerprint(tool: ConnectorTool): string {
  return fingerprint([tool.name, tool.inputSchema, tool.readOnly]);
}

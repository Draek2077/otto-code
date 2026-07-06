import type { Logger } from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { McpServerConfig } from "../agent-sdk-types.js";
import type { ManagedProcessRegistry } from "../../managed-processes/managed-processes.js";
import { createExternalProcessEnv } from "../../otto-env.js";
import { terminateWithTreeKill } from "../../../utils/tree-kill.js";
import { capToolOutput } from "./openai-compat-tools.js";

/**
 * MCP client host for the OpenAI-compatible provider. The daemon owns that
 * provider's tool loop (there is no agent binary to host an MCP client), so
 * this manager connects to the configured MCP servers, snapshots their tools,
 * and routes tool calls — one manager per agent session.
 *
 * Security posture:
 * - stdio servers spawn with a scrubbed environment (Otto control vars
 *   stripped) plus only the explicit per-server overlay, cwd = agent cwd, and
 *   no shell. They are tree-killed on close and registered in the
 *   managed-process registry so daemon-restart reaping covers leaks.
 * - Configured header and env values are secrets: they are redacted from all
 *   error text this module returns, and never logged.
 * - A server that fails to connect is skipped and recorded as a failure —
 *   never fatal to the session.
 * - Tool names are namespaced `mcp_{server}_{tool}` so a server cannot shadow
 *   the builtin coding tools or Otto's injected catalog.
 */

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 10_000;
const CALL_TOOL_TIMEOUT_MS = 120_000;
const STDIO_KILL_GRACE_MS = 500;
/** OpenAI function names must match ^[a-zA-Z0-9_-]{1,64}$. */
const MAX_FUNCTION_NAME_CHARS = 64;
const REDACTED = "***";

export interface McpToolBinding {
  /** Namespaced, sanitized name exposed to the model. */
  modelName: string;
  serverName: string;
  toolName: string;
  description: string;
  parameters: Record<string, unknown>;
  /**
   * The server's self-declared readOnlyHint annotation. Untrusted — only
   * consulted in acceptEdits mode when the provider opts into
   * mcpToolPermissions: "trust-read-only".
   */
  readOnlyHint: boolean;
}

export interface McpPromptBinding {
  /** Namespaced, sanitized slash-command name. */
  commandName: string;
  serverName: string;
  promptName: string;
  description?: string;
  argumentNames: string[];
}

export interface McpServerFailure {
  name: string;
  error: string;
}

export interface McpToolCallOutcome {
  output: string;
  isError: boolean;
}

interface ConnectedServer {
  name: string;
  client: Client;
  stdioPid: number | null;
  managedRecordId: string | null;
}

function sanitizeNamePart(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/gu, "_");
}

/** Build `mcp_{server}_{tool}` capped at the OpenAI limit, deduped with a numeric suffix. */
function buildNamespacedName(prefix: string, used: Set<string>): string {
  let candidate = prefix.slice(0, MAX_FUNCTION_NAME_CHARS);
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = `_${suffix}`;
    candidate = `${prefix.slice(0, MAX_FUNCTION_NAME_CHARS - tail.length)}${tail}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function flattenContentText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const record = part as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n");
}

export interface OpenAICompatMcpManagerOptions {
  servers: Record<string, McpServerConfig>;
  providerId: string;
  cwd: string;
  logger?: Logger;
  managedProcesses?: ManagedProcessRegistry | null;
  connectTimeoutMs?: number;
}

export class OpenAICompatMcpManager {
  private readonly servers: Record<string, McpServerConfig>;
  private readonly providerId: string;
  private readonly cwd: string;
  private readonly logger?: Logger;
  private readonly managedProcesses: ManagedProcessRegistry | null;
  private readonly connectTimeoutMs: number;
  /** Every configured header/env value, replaced with *** in outgoing text. */
  private readonly secrets: string[];

  private connectPromise: Promise<void> | null = null;
  private connected: ConnectedServer[] = [];
  private toolBindings = new Map<string, McpToolBinding>();
  private connectionFailures: McpServerFailure[] = [];
  private closed = false;

  constructor(options: OpenAICompatMcpManagerOptions) {
    this.servers = options.servers;
    this.providerId = options.providerId;
    this.cwd = options.cwd;
    this.logger = options.logger;
    this.managedProcesses = options.managedProcesses ?? null;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.secrets = collectSecrets(options.servers);
  }

  get hasServers(): boolean {
    return Object.keys(this.servers).length > 0;
  }

  /** Failures recorded by the last connect pass; empty before the first connect. */
  get failures(): readonly McpServerFailure[] {
    return this.connectionFailures;
  }

  /**
   * Connect to every configured server and snapshot its tools. Memoized so
   * idle sessions never spawn processes and repeated turns reuse connections.
   * Per-server failures are collected, never thrown.
   */
  ensureConnected(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    this.connectPromise ??= this.connectAll();
    return this.connectPromise;
  }

  private async connectAll(): Promise<void> {
    const usedNames = new Set<string>();
    for (const [name, config] of Object.entries(this.servers)) {
      try {
        const server = await this.connectServer(name, config);
        this.connected.push(server);
        await this.snapshotTools(server, usedNames);
      } catch (error) {
        const message = this.redact(error instanceof Error ? error.message : String(error));
        this.connectionFailures.push({ name, error: message });
        this.logger?.warn(
          { provider: this.providerId, mcpServer: name, error: message },
          "MCP server connection failed",
        );
      }
    }
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<ConnectedServer> {
    const client = new Client({ name: "otto-openai-compat", version: "1.0.0" });
    if (config.type === "stdio") {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        cwd: this.cwd,
        env: createExternalProcessEnv(process.env, config.env ?? {}),
        stderr: "pipe",
      });
      transport.stderr?.on("data", (chunk: Buffer) => {
        this.logger?.debug(
          { provider: this.providerId, mcpServer: name },
          `MCP server stderr: ${this.redact(chunk.toString("utf8")).slice(0, 500)}`,
        );
      });
      try {
        await client.connect(transport, { timeout: this.connectTimeoutMs });
      } catch (error) {
        // The SDK spawned the process before the handshake failed — reap it.
        const pid = transport.pid;
        if (typeof pid === "number") {
          void killPidTree(pid);
        }
        throw error;
      }
      const pid = transport.pid;
      let managedRecordId: string | null = null;
      if (typeof pid === "number" && this.managedProcesses) {
        try {
          const record = await this.managedProcesses.record({
            owner: { provider: this.providerId, kind: "mcp-server" },
            pid,
            command: config.command,
            args: config.args ?? [],
            metadata: { server: name },
          });
          managedRecordId = record.id;
        } catch (error) {
          this.logger?.warn(
            { err: error, provider: this.providerId, mcpServer: name },
            "Failed to register MCP server process",
          );
        }
      }
      return { name, client, stdioPid: pid ?? null, managedRecordId };
    }

    const url = new URL(config.url);
    const requestInit: RequestInit | undefined = config.headers
      ? { headers: config.headers }
      : undefined;
    const transport =
      config.type === "http"
        ? new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined)
        : new SSEClientTransport(url, requestInit ? { requestInit } : undefined);
    await client.connect(transport, { timeout: this.connectTimeoutMs });
    return { name, client, stdioPid: null, managedRecordId: null };
  }

  private async snapshotTools(server: ConnectedServer, usedNames: Set<string>): Promise<void> {
    const listing = await server.client.listTools(undefined, { timeout: LIST_TIMEOUT_MS });
    for (const tool of listing.tools) {
      const prefix = `mcp_${sanitizeNamePart(server.name)}_${sanitizeNamePart(tool.name)}`;
      const modelName = buildNamespacedName(prefix, usedNames);
      this.toolBindings.set(modelName, {
        modelName,
        serverName: server.name,
        toolName: tool.name,
        description: tool.description ?? "",
        parameters: (tool.inputSchema as Record<string, unknown> | undefined) ?? {
          type: "object",
          properties: {},
        },
        readOnlyHint: tool.annotations?.readOnlyHint === true,
      });
    }
  }

  /** Pids of spawned stdio servers (diagnostics and lifecycle tests). */
  getStdioPids(): number[] {
    return this.connected.flatMap((server) => (server.stdioPid !== null ? [server.stdioPid] : []));
  }

  /** Tool bindings snapshotted at connect; empty before the first connect. */
  getToolBindings(): McpToolBinding[] {
    return [...this.toolBindings.values()];
  }

  resolveTool(modelName: string): McpToolBinding | undefined {
    return this.toolBindings.get(modelName);
  }

  async callTool(
    binding: McpToolBinding,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal },
  ): Promise<McpToolCallOutcome> {
    const server = this.connected.find((candidate) => candidate.name === binding.serverName);
    if (!server) {
      return {
        output: `Error: MCP server '${binding.serverName}' is not connected`,
        isError: true,
      };
    }
    try {
      const result = await server.client.callTool(
        { name: binding.toolName, arguments: args },
        undefined,
        { timeout: CALL_TOOL_TIMEOUT_MS, ...(options.signal ? { signal: options.signal } : {}) },
      );
      const text = flattenContentText(result.content);
      const fallback = result.isError ? "Tool failed" : "Done.";
      return {
        output: capToolOutput(this.redact(text || fallback)),
        isError: result.isError === true,
      };
    } catch (error) {
      const message = this.redact(error instanceof Error ? error.message : String(error));
      return { output: `Error: ${message}`, isError: true };
    }
  }

  /** Prompts listed on demand (for slash commands); per-server failures are skipped. */
  async listPrompts(): Promise<McpPromptBinding[]> {
    await this.ensureConnected();
    const bindings: McpPromptBinding[] = [];
    const usedNames = new Set<string>();
    for (const server of this.connected) {
      try {
        const listing = await server.client.listPrompts(undefined, { timeout: LIST_TIMEOUT_MS });
        for (const prompt of listing.prompts) {
          const prefix = `mcp_${sanitizeNamePart(server.name)}_${sanitizeNamePart(prompt.name)}`;
          bindings.push({
            commandName: buildNamespacedName(prefix, usedNames),
            serverName: server.name,
            promptName: prompt.name,
            ...(prompt.description ? { description: prompt.description } : {}),
            argumentNames: (prompt.arguments ?? []).map((argument) => argument.name),
          });
        }
      } catch (error) {
        // Servers without prompt support reply with "method not found" — normal.
        this.logger?.debug(
          { provider: this.providerId, mcpServer: server.name, err: error },
          "MCP prompts listing unavailable",
        );
      }
    }
    return bindings;
  }

  /** Resolve a prompt to the text fed to the model in place of the typed /command. */
  async getPrompt(binding: McpPromptBinding, argumentValue: string | null): Promise<string> {
    const server = this.connected.find((candidate) => candidate.name === binding.serverName);
    if (!server) {
      throw new Error(`MCP server '${binding.serverName}' is not connected`);
    }
    const firstArgument = binding.argumentNames[0];
    const result = await server.client.getPrompt(
      {
        name: binding.promptName,
        ...(firstArgument && argumentValue
          ? { arguments: { [firstArgument]: argumentValue } }
          : {}),
      },
      { timeout: LIST_TIMEOUT_MS },
    );
    const text = result.messages
      .map((message) => {
        const content = message.content as Record<string, unknown> | undefined;
        return content?.type === "text" && typeof content.text === "string" ? content.text : "";
      })
      .filter(Boolean)
      .join("\n\n");
    if (!text) {
      throw new Error(`MCP prompt '${binding.promptName}' returned no text content`);
    }
    return this.redact(text);
  }

  /** Idempotent: close clients, tree-kill stdio children, unregister processes. */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const servers = this.connected;
    this.connected = [];
    this.toolBindings = new Map();
    for (const server of servers) {
      await server.client.close().catch(() => undefined);
      if (server.stdioPid !== null) {
        await killPidTree(server.stdioPid);
      }
      if (server.managedRecordId && this.managedProcesses) {
        await this.managedProcesses.remove(server.managedRecordId).catch(() => undefined);
      }
    }
  }

  /** Replace configured header/env secret values in outgoing text with ***. */
  redact(text: string): string {
    let result = text;
    for (const secret of this.secrets) {
      result = result.split(secret).join(REDACTED);
    }
    return result;
  }
}

function collectSecrets(servers: Record<string, McpServerConfig>): string[] {
  const secrets: string[] = [];
  for (const config of Object.values(servers)) {
    const values =
      config.type === "stdio"
        ? Object.values(config.env ?? {})
        : Object.values(config.headers ?? {});
    for (const value of values) {
      // Very short values would redact common substrings; headers/env values
      // that short are not meaningful secrets.
      if (value.length >= 4) {
        secrets.push(value);
      }
    }
  }
  return secrets;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * SDK close() only signals the direct child; npx-style wrappers leave orphaned
 * grandchildren. Tree-kill by pid: without an exit-event handle the graceful
 * wait always runs its course, so skip dead pids and keep the grace short.
 */
async function killPidTree(pid: number): Promise<void> {
  if (!isPidAlive(pid)) {
    return;
  }
  await terminateWithTreeKill(
    {
      pid,
      kill: (signal) => {
        try {
          process.kill(pid, signal);
          return true;
        } catch {
          return false;
        }
      },
    },
    { gracefulTimeoutMs: STDIO_KILL_GRACE_MS },
  );
}

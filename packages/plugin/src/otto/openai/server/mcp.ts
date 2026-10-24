import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProviderMcpServerConfig } from "../../../server/provider.js";
import { readBody, requireOk, serverEvents } from "./http.js";
import { boundedResult, type AgentTool, type ToolOutput } from "./tools.js";
import { DuplexMcpClient } from "./mcp-duplex.js";

interface McpClient {
  request(method: string, params: unknown, signal: AbortSignal): Promise<unknown>;
  initialize(signal: AbortSignal): Promise<string | undefined>;
  close(): Promise<void>;
}

const packetSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  method: z.string().optional(),
  result: z.json().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const toolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.json()),
  annotations: z.object({ readOnlyHint: z.boolean().optional() }).optional(),
});

class HttpMcpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private version: string | null = null;
  constructor(
    private readonly url: string,
    private readonly configuredHeaders: Record<string, string> | undefined,
    private readonly timeoutMs: number,
  ) {
    const endpoint = new URL(url);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      throw new Error("MCP requires an HTTP(S) endpoint without embedded credentials.");
  }
  private headers(): Headers {
    const headers = new Headers(this.configuredHeaders);
    headers.set("content-type", "application/json");
    headers.set("accept", "application/json, text/event-stream");
    if (this.sessionId) headers.set("mcp-session-id", this.sessionId);
    if (this.version) headers.set("mcp-protocol-version", this.version);
    return headers;
  }
  private post(body: unknown, signal: AbortSignal): Promise<Response> {
    return fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
    });
  }
  private async reply(
    value: unknown,
    requestId: number,
    signal: AbortSignal,
  ): Promise<{ value: unknown } | null> {
    for (const raw of Array.isArray(value) ? value : [value]) {
      const packet = packetSchema.parse(raw);
      if (packet.method && packet.id !== undefined) {
        const result =
          packet.method === "ping"
            ? { result: {} }
            : {
                error: {
                  code: -32601,
                  message: "This client does not support server-initiated requests.",
                },
              };
        const response = await this.post({ jsonrpc: "2.0", id: packet.id, ...result }, signal);
        await requireOk(response, "MCP response");
        await response.body?.cancel();
        continue;
      }
      if (packet.id !== requestId) continue;
      if (packet.error) throw new Error(`MCP ${packet.error.code}: ${packet.error.message}`);
      if (!Object.hasOwn(packet, "result"))
        throw new Error("MCP returned a reply without a result.");
      return { value: packet.result };
    }
    return null;
  }
  async request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, params }, signal);
    await requireOk(response, "MCP endpoint");
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      for await (const event of serverEvents(response)) {
        const result = await this.reply(JSON.parse(event), id, signal);
        if (result) return result.value;
      }
    } else {
      const result = await this.reply(JSON.parse(await readBody(response)), id, signal);
      if (result) return result.value;
    }
    throw new Error("The MCP stream ended without the requested reply.");
  }
  async initialize(signal: AbortSignal): Promise<string | undefined> {
    const info = z
      .object({
        protocolVersion: z.enum(["2025-03-26", "2025-06-18", "2025-11-25"]),
        instructions: z.string().max(65536).optional(),
      })
      .parse(
        await this.request(
          "initialize",
          {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "otto-openai-compatible", version: "1.0.0" },
          },
          signal,
        ),
      );
    this.version = info.protocolVersion;
    const response = await this.post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      signal,
    );
    await requireOk(response, "MCP initialization");
    await response.body?.cancel();
    return info.instructions;
  }
  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const response = await fetch(this.url, {
        method: "DELETE",
        headers: this.headers(),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
    } catch {
      /* Session termination is optional; the owning connection is already closed. */
    }
  }
}

async function listTools(
  client: McpClient,
  signal: AbortSignal,
): Promise<Array<z.infer<typeof toolSchema>>> {
  const tools: Array<z.infer<typeof toolSchema>> = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = z
      .object({ tools: z.array(toolSchema), nextCursor: z.string().optional() })
      .parse(await client.request("tools/list", cursor ? { cursor } : {}, signal));
    tools.push(...page.tools);
    if (tools.length > 1024)
      throw new Error(
        "This MCP catalog exceeds 1024 tools. Limit the configured tool scope before connecting.",
      );
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("The MCP server repeated a catalog cursor.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return tools;
}

function modelResult(raw: unknown): string | ToolOutput {
  const result = z
    .object({
      content: z.array(z.record(z.string(), z.json())).optional(),
      structuredContent: z.json().optional(),
      isError: z.boolean().optional(),
    })
    .parse(raw);
  const text = (result.content ?? [])
    .map((part) => {
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "image") return `[MCP image: ${String(part.mimeType)}]`;
      return `[MCP returned ${String(part.type)} content.]`;
    })
    .join("\n");
  const content = boundedResult(text || JSON.stringify(result.structuredContent ?? {}));
  if (result.isError) throw new Error(content);
  const images = (result.content ?? [])
    .filter((part) => part.type === "image")
    .map((part) =>
      z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }).parse(part),
    );
  return images.length ? { text: content, images } : content;
}

export async function loadMcpTools(
  config: Readonly<Record<string, ProviderMcpServerConfig>>,
  timeoutMs: number,
  signal: AbortSignal,
  context: { cwd: string; env: Readonly<Record<string, string>> },
) {
  const clients: McpClient[] = [];
  const tools: AgentTool[] = [];
  const instructions: string[] = [];
  const close = async () => {
    await Promise.all(clients.map((client) => client.close()));
  };
  try {
    for (const [server, connection] of Object.entries(config)) {
      const client =
        connection.type === "http"
          ? new HttpMcpClient(connection.url, connection.headers, timeoutMs)
          : new DuplexMcpClient(connection, timeoutMs, context);
      clients.push(client);
      const instruction = await client.initialize(signal);
      if (instruction) instructions.push(`[${server}]\n${instruction}`);
      for (const tool of await listTools(client, signal)) {
        const name = `mcp_${createHash("sha256").update(`${server}\0${tool.name}`).digest("hex").slice(0, 24)}`;
        if (tools.some((existing) => existing.definition.function.name === name))
          throw new Error(`Duplicate MCP tool: ${server}/${tool.name}`);
        tools.push({
          access: tool.annotations?.readOnlyHint ? "read" : "unknown",
          definition: {
            type: "function",
            function: {
              name,
              description: `[${server}] ${tool.name}: ${tool.description ?? ""}`,
              parameters: tool.inputSchema,
            },
          },
          preapproval: { server, tool: tool.name },
          detail(input) {
            return {
              type: "unknown",
              input: z.record(z.string(), z.json()).parse(input),
              output: null,
            };
          },
          async execute(input, callSignal) {
            return modelResult(
              await client.request("tools/call", { name: tool.name, arguments: input }, callSignal),
            );
          },
        });
      }
    }
    return { tools, instructions, close };
  } catch (error) {
    await close();
    throw error;
  }
}

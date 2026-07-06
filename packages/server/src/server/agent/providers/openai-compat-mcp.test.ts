import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { OpenAICompatMcpManager } from "./openai-compat-mcp.js";

const httpServers: Server[] = [];
const managers: OpenAICompatMcpManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  await Promise.all(
    httpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function respondWithInProcessMcpServer(
  configure: (server: McpServer) => void,
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
): Promise<void> {
  const mcpServer = new McpServer({ name: "otto-mcp-test", version: "1.0.0" });
  configure(mcpServer);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void mcpServer.close();
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
}

function failMcpResponse(res: ServerResponse): void {
  if (!res.headersSent) {
    res.writeHead(500);
  }
  res.end();
}

/**
 * In-process stateless HTTP MCP server (fresh McpServer + transport per
 * request, mirroring the daemon's own /mcp/agents hosting). Real dependency —
 * exercises the manager's actual StreamableHTTPClientTransport path.
 */
async function startHttpMcpServer(
  configure: (server: McpServer) => void,
): Promise<{ url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      respondWithInProcessMcpServer(configure, req, res, body).catch(() => failMcpResponse(res));
    });
  });
  httpServers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp` };
}

function trackManager(manager: OpenAICompatMcpManager): OpenAICompatMcpManager {
  managers.push(manager);
  return manager;
}

function configureEchoTools(server: McpServer): void {
  server.tool("echo", { text: z.string() }, async ({ text }) => ({
    content: [{ type: "text", text: `E:${text}` }],
  }));
  server.registerTool(
    "lookup",
    {
      description: "Read-only lookup",
      inputSchema: { key: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ key }) => ({ content: [{ type: "text", text: `V:${key}` }] }),
  );
}

function configureBigTool(server: McpServer): void {
  server.tool("big", {}, async () => ({
    content: [{ type: "text", text: "x".repeat(40_000) }],
  }));
}

function configureDuplicateNames(server: McpServer): void {
  server.tool("do it", {}, async () => ({ content: [{ type: "text", text: "a" }] }));
  server.tool("do_it", {}, async () => ({ content: [{ type: "text", text: "b" }] }));
}

function configureLeakTool(server: McpServer): void {
  server.tool("leak", {}, async () => ({
    content: [{ type: "text", text: "token is supersecretvalue, don't tell" }],
  }));
}

function configureReviewPrompt(server: McpServer): void {
  server.registerPrompt(
    "review",
    {
      description: "Review something",
      argsSchema: { target: z.string() },
    },
    async ({ target }) => ({
      messages: [{ role: "user", content: { type: "text", text: `Please review ${target}.` } }],
    }),
  );
}

describe("OpenAICompatMcpManager over HTTP", () => {
  test("connects, namespaces tools, and dispatches calls", async () => {
    const endpoint = await startHttpMcpServer(configureEchoTools);
    const manager = trackManager(
      new OpenAICompatMcpManager({
        servers: { alpha: { type: "http", url: endpoint.url } },
        providerId: "lmstudio",
        cwd: process.cwd(),
      }),
    );

    await manager.ensureConnected();
    expect(manager.failures).toEqual([]);
    const names = manager.getToolBindings().map((binding) => binding.modelName);
    expect(names.sort()).toEqual(["mcp_alpha_echo", "mcp_alpha_lookup"]);

    const echo = manager.resolveTool("mcp_alpha_echo")!;
    expect(echo.readOnlyHint).toBe(false);
    const lookup = manager.resolveTool("mcp_alpha_lookup")!;
    expect(lookup.readOnlyHint).toBe(true);

    const outcome = await manager.callTool(echo, { text: "hi" }, {});
    expect(outcome).toEqual({ output: "E:hi", isError: false });
  });

  test("caps oversized tool output with a truncation marker", async () => {
    const endpoint = await startHttpMcpServer(configureBigTool);
    const manager = trackManager(
      new OpenAICompatMcpManager({
        servers: { alpha: { type: "http", url: endpoint.url } },
        providerId: "lmstudio",
        cwd: process.cwd(),
      }),
    );

    await manager.ensureConnected();
    const outcome = await manager.callTool(manager.resolveTool("mcp_alpha_big")!, {}, {});
    expect(outcome.output.endsWith("\n[truncated]")).toBe(true);
    expect(outcome.output.length).toBe(30_000 + "\n[truncated]".length);
  });

  test("sanitizes and dedupes namespaced tool names", async () => {
    const endpoint = await startHttpMcpServer(configureDuplicateNames);
    const manager = trackManager(
      new OpenAICompatMcpManager({
        servers: { "my.server": { type: "http", url: endpoint.url } },
        providerId: "lmstudio",
        cwd: process.cwd(),
      }),
    );

    await manager.ensureConnected();
    const names = manager.getToolBindings().map((binding) => binding.modelName);
    expect(names).toEqual(["mcp_my_server_do_it", "mcp_my_server_do_it_2"]);
    for (const name of names) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  test("a failing server is skipped while others connect", async () => {
    const endpoint = await startHttpMcpServer(configureEchoTools);
    const manager = trackManager(
      new OpenAICompatMcpManager({
        servers: {
          bad: { type: "http", url: "http://127.0.0.1:9/mcp" },
          good: { type: "http", url: endpoint.url },
        },
        providerId: "lmstudio",
        cwd: process.cwd(),
        connectTimeoutMs: 2_000,
      }),
    );

    await manager.ensureConnected();
    expect(manager.failures.map((failure) => failure.name)).toEqual(["bad"]);
    expect(manager.getToolBindings().map((binding) => binding.modelName)).toContain(
      "mcp_good_echo",
    );
  });

  test("redacts configured header values from tool output", async () => {
    const endpoint = await startHttpMcpServer(configureLeakTool);
    const manager = trackManager(
      new OpenAICompatMcpManager({
        servers: {
          alpha: {
            type: "http",
            url: endpoint.url,
            headers: { Authorization: "supersecretvalue" },
          },
        },
        providerId: "lmstudio",
        cwd: process.cwd(),
      }),
    );

    await manager.ensureConnected();
    const outcome = await manager.callTool(manager.resolveTool("mcp_alpha_leak")!, {}, {});
    expect(outcome.output).toBe("token is ***, don't tell");
  });

  test("lists prompts and resolves them with the first declared argument", async () => {
    const endpoint = await startHttpMcpServer(configureReviewPrompt);
    const manager = trackManager(
      new OpenAICompatMcpManager({
        servers: { alpha: { type: "http", url: endpoint.url } },
        providerId: "lmstudio",
        cwd: process.cwd(),
      }),
    );

    const prompts = await manager.listPrompts();
    expect(prompts).toEqual([
      {
        commandName: "mcp_alpha_review",
        serverName: "alpha",
        promptName: "review",
        description: "Review something",
        argumentNames: ["target"],
      },
    ]);

    const text = await manager.getPrompt(prompts[0]!, "the diff");
    expect(text).toBe("Please review the diff.");
  });
});

describe("OpenAICompatMcpManager over stdio", () => {
  test("spawns, calls, and tree-kills the server process on close", async () => {
    const scriptPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../scripts/mcp-echo-test-server.mjs",
    );
    const manager = new OpenAICompatMcpManager({
      servers: {
        echo: { type: "stdio", command: process.execPath, args: [scriptPath] },
      },
      providerId: "lmstudio",
      cwd: process.cwd(),
    });

    await manager.ensureConnected();
    expect(manager.failures).toEqual([]);
    const [pid] = manager.getStdioPids();
    expect(pid).toBeGreaterThan(0);
    expect(isPidAlive(pid!)).toBe(true);

    const binding = manager.resolveTool("mcp_echo_otto_roundtrip_text")!;
    const outcome = await manager.callTool(binding, { text: "ping" }, {});
    expect(outcome).toEqual({ output: "ECHO:ping", isError: false });

    await manager.close();
    await expect.poll(() => isPidAlive(pid!), { timeout: 5_000 }).toBe(false);
  });
});

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

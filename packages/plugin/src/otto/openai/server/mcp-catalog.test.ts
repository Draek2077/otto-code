import { afterEach, expect, it, vi } from "vitest";
import { loadMcpTools } from "./mcp.js";

afterEach(() => vi.unstubAllGlobals());

it("bounds accumulated catalog bytes across individually valid pages and closes the session", async () => {
  let pages = 0;
  let closed = 0;
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      closed++;
      return new Response(null, { status: 204 });
    }
    const packet = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (packet.method === "notifications/initialized") return new Response(null, { status: 202 });
    let result: unknown = { protocolVersion: "2025-03-26" };
    if (packet.method === "tools/list") {
      pages++;
      result = {
        tools: [
          {
            name: `page_${pages}`,
            description: "x".repeat(1500000),
            inputSchema: { type: "object" },
          },
        ],
        nextCursor: String(pages),
      };
    }
    return Response.json(
      { jsonrpc: "2.0", id: packet.id, result },
      { headers: { "mcp-session-id": "fixture" } },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    loadMcpTools(
      { fixture: { type: "http", url: "https://fixture.invalid/mcp" } },
      5000,
      AbortSignal.timeout(5000),
      { cwd: process.cwd(), env: {} },
    ),
  ).rejects.toThrow("exceeds 4 MiB");
  expect(pages).toBe(3);
  expect(closed).toBe(1);
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { OttoToolResult } from "../agent/tools/types.js";

export const GOOGLE_MCP_ENDPOINTS: Readonly<Record<string, string>> = {
  gmail: "https://gmailmcp.googleapis.com/mcp/v1",
  "google-drive": "https://drivemcp.googleapis.com/mcp/v1",
  "google-calendar": "https://calendarmcp.googleapis.com/mcp/v1",
};

export interface GoogleMcpTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

/** Vendor catalogs are public: tools/list success is NOT proof of account access.
 * A read-only tools/call is required by the connection admission gate. */
export class GoogleMcpBackend {
  constructor(private readonly options: { serviceId: string; accessToken(): Promise<string> }) {}

  private async use<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const endpoint = GOOGLE_MCP_ENDPOINTS[this.options.serviceId];
    if (!endpoint) throw new Error("Unsupported Google MCP service.");
    const token = await this.options.accessToken();
    const client = new Client({ name: "otto-connectors", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: `Bearer ${token}` }, redirect: "error" },
    });
    try {
      await client.connect(transport, { timeout: 30_000 });
      return await run(client);
    } finally {
      await client.close();
    }
  }

  async listTools(): Promise<GoogleMcpTool[]> {
    return this.use(async (client) => {
      const tools: GoogleMcpTool[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        for (const tool of page.tools)
          tools.push({
            name: tool.name,
            description: tool.description ?? tool.name,
            inputSchema: z.fromJSONSchema(
              tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0],
            ),
          });
        cursor = page.nextCursor;
        if (cursor && (seen.has(cursor) || seen.size >= 100))
          throw new Error("Google returned an invalid catalog continuation.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return tools;
    });
  }

  async call(name: string, input: unknown, signal?: AbortSignal): Promise<OttoToolResult> {
    return this.use(async (client) => {
      const result = await client.callTool(
        { name, arguments: z.record(z.string(), z.unknown()).parse(input) },
        undefined,
        { signal, timeout: 30_000 },
      );
      // Normalize through the MCP result contract. Never flatten an error into success.
      if (JSON.stringify(result).length > 120_000)
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "This result is too large. Narrow the query or request a smaller page.",
            },
          ],
        };
      return {
        isError: result.isError === true,
        content: Array.isArray(result.content)
          ? result.content
          : [{ type: "text", text: JSON.stringify(result.structuredContent) }],
      };
    });
  }

  async verify(): Promise<void> {
    const probes: Record<string, { name: string; input: Record<string, unknown> }> = {
      gmail: { name: "list_labels", input: {} },
      "google-drive": {
        name: "list_recent_files",
        input: { pageSize: 1, excludeContentSnippets: true },
      },
      "google-calendar": { name: "list_calendars", input: { pageSize: 1 } },
    };
    const probe = probes[this.options.serviceId];
    if (!probe) throw new Error("Unsupported Google MCP service.");
    const result = await this.call(probe.name, probe.input);
    if (result.isError)
      throw new Error(
        "Google's hosted MCP service has not granted this account/project access. Its Developer Preview enrollment is separate from enabling the API.",
      );
  }
}

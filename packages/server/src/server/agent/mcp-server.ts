import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { addModelVisibleStructuredContent } from "./tools/otto-tool-serialization.js";
import { createOttoToolCatalog, type OttoToolHostDependencies } from "./tools/otto-tools.js";
import type { OttoToolResult } from "./tools/types.js";

export type AgentMcpServerOptions = OttoToolHostDependencies;

type McpToolContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Hard cap on the model-visible text of an Otto tool result. Previously
 * uncapped, so a large structuredContent dump entered the transcript verbatim
 * and was replayed on every round. Matches the MCP builtin cap (~30K) with a
 * head-heavy head/tail window and a clear truncation marker.
 */

function toMcpToolResult(result: OttoToolResult): CallToolResult {
  const modelVisibleResult = addModelVisibleStructuredContent(result);
  return {
    content: modelVisibleResult.content as CallToolResult["content"],
    ...(modelVisibleResult.structuredContent !== undefined
      ? {
          structuredContent:
            modelVisibleResult.structuredContent as CallToolResult["structuredContent"],
        }
      : {}),
    ...(modelVisibleResult.isError !== undefined ? { isError: modelVisibleResult.isError } : {}),
  };
}

export async function createAgentMcpServer(options: AgentMcpServerOptions): Promise<McpServer> {
  const catalog = await createOttoToolCatalog(options);
  const server = new McpServer({
    name: "agent-mcp",
    version: "2.0.0",
  });

  for (const tool of catalog.tools.values()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown, context?: McpToolContext) =>
        toMcpToolResult(await catalog.executeTool(tool.name, args, { signal: context?.signal })),
    );
  }

  return server;
}

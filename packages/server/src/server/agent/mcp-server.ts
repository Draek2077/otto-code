import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

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
const RESULT_HEAD_CHARS = 26_000;
const RESULT_TAIL_CHARS = 4_000;

function truncateHeadTail(text: string, headChars: number, tailChars: number): string {
  if (text.length <= headChars + tailChars) {
    return text;
  }
  const removed = text.length - headChars - tailChars;
  return `${text.slice(0, headChars)}\n[... ${removed} characters truncated ...]\n${text.slice(
    -tailChars,
  )}`;
}

function formatStructuredContentForModel(structuredContent: unknown): string {
  if (
    !structuredContent ||
    typeof structuredContent !== "object" ||
    Array.isArray(structuredContent)
  ) {
    // Compact JSON: the model reads it fine and 2-space indentation was pure
    // token inflation replayed every round.
    return truncateHeadTail(
      JSON.stringify(structuredContent),
      RESULT_HEAD_CHARS,
      RESULT_TAIL_CHARS,
    );
  }

  const record = structuredContent as Record<string, unknown>;
  const summary: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!Array.isArray(value)) {
      continue;
    }
    summary.push(`${key}_count=${value.length}`);
    const ids = value
      .map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).id
          : null,
      )
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === value.length && ids.length > 0) {
      summary.push(`${key}_ids=${ids.join(",")}`);
    }
  }

  const json = JSON.stringify(structuredContent);
  const combined = summary.length > 0 ? `${summary.join("\n")}\n\n${json}` : json;
  return truncateHeadTail(combined, RESULT_HEAD_CHARS, RESULT_TAIL_CHARS);
}

function addModelVisibleStructuredContent(result: CallToolResult): CallToolResult {
  if (result.structuredContent === undefined || result.content.length > 0) {
    return result;
  }

  return {
    ...result,
    content: [
      {
        type: "text",
        text: formatStructuredContentForModel(result.structuredContent),
      },
    ],
  };
}

function toMcpToolResult(result: OttoToolResult): CallToolResult {
  return addModelVisibleStructuredContent({
    content: result.content as CallToolResult["content"],
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent as CallToolResult["structuredContent"] }
      : {}),
    ...(result.isError !== undefined ? { isError: result.isError } : {}),
  });
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

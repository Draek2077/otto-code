import { describe, expect, test } from "vitest";

import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { internalOttoReadToolNames, withRuntimeOttoMcpServer } from "./runtime-mcp-config.js";

const BASE_CONFIG: AgentSessionConfig = {
  provider: "claude",
  cwd: "/tmp/agent",
};

describe("withRuntimeOttoMcpServer", () => {
  test("read grants belong only to the internal Otto server and obey workspace access", () => {
    const config = withRuntimeOttoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6788/mcp/agents",
      mcpAuthToken: null,
    });
    expect(internalOttoReadToolNames(config)).toContain("list_workspaces");
    expect(internalOttoReadToolNames({ ...config, workspaceAccess: "none" })).not.toContain(
      "list_workspaces",
    );
    expect(internalOttoReadToolNames({ ...config, workspaceAccess: "none" })).toContain(
      "get_chat_status",
    );
    expect(internalOttoReadToolNames({ ...config, toolPolicy: { preapproved: [] } })).toEqual([]);
    expect(
      internalOttoReadToolNames({
        ...BASE_CONFIG,
        mcpServers: {
          otto: { type: "http", url: "https://example.test/mcp" },
          otto_external: { type: "http", url: "https://example.test/mcp/agents" },
        },
      }),
    ).toEqual([]);
  });

  test("injects the otto MCP server with a bearer header when a token is provided", () => {
    const result = withRuntimeOttoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6868/mcp/agents",
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers?.otto).toEqual({
      type: "http",
      url: "http://127.0.0.1:6868/mcp/agents?callerAgentId=agent-1",
      headers: { Authorization: "Bearer cap-token" },
    });
  });

  test("omits the header when no token is available", () => {
    const result = withRuntimeOttoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6868/mcp/agents",
      mcpAuthToken: null,
    });

    expect(result.mcpServers?.otto).toEqual({
      type: "http",
      url: "http://127.0.0.1:6868/mcp/agents?callerAgentId=agent-1",
    });
  });

  test("does not inject when no MCP base URL is configured", () => {
    const result = withRuntimeOttoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers).toBeUndefined();
  });
});

import { describe, expect, test } from "vitest";

import { ottoToolGroupForName, ProviderOverrideSchema } from "./provider-config.js";

describe("ProviderOverrideSchema MCP fields", () => {
  test("parses overrides without the MCP fields (old configs stay valid)", () => {
    const parsed = ProviderOverrideSchema.parse({
      extends: "openai-compatible",
      label: "LM Studio",
      env: { OPENAI_BASE_URL: "http://localhost:1234" },
    });
    expect(parsed.mcpServers).toBeUndefined();
    expect(parsed.mcpToolPermissions).toBeUndefined();
  });

  test("parses stdio, http, and sse MCP server entries", () => {
    const parsed = ProviderOverrideSchema.parse({
      extends: "openai-compatible",
      label: "LM Studio",
      mcpServers: {
        files: { type: "stdio", command: "npx", args: ["-y", "some-mcp"], env: { KEY: "v" } },
        remote: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "t" } },
        stream: { type: "sse", url: "https://example.com/sse" },
      },
      mcpToolPermissions: "trust-read-only",
    });
    expect(parsed.mcpServers?.files).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "some-mcp"],
      env: { KEY: "v" },
    });
    expect(parsed.mcpToolPermissions).toBe("trust-read-only");
  });

  test("rejects unknown mcpToolPermissions values and malformed server entries", () => {
    expect(
      ProviderOverrideSchema.safeParse({
        extends: "openai-compatible",
        label: "LM Studio",
        mcpToolPermissions: "yolo",
      }).success,
    ).toBe(false);
    expect(
      ProviderOverrideSchema.safeParse({
        extends: "openai-compatible",
        label: "LM Studio",
        mcpServers: { files: { type: "stdio" } },
      }).success,
    ).toBe(false);
  });
});

describe("ottoToolGroupForName", () => {
  test("maps artifact tools to the artifacts group, not the agents catch-all", () => {
    expect(ottoToolGroupForName("create_artifact")).toBe("artifacts");
  });

  test("keeps schedule and heartbeat tools in the schedules group", () => {
    expect(ottoToolGroupForName("create_schedule")).toBe("schedules");
    expect(ottoToolGroupForName("create_heartbeat")).toBe("schedules");
    expect(ottoToolGroupForName("list_schedules")).toBe("schedules");
  });

  test("falls back to agents for lifecycle tools", () => {
    expect(ottoToolGroupForName("create_agent")).toBe("agents");
  });
});

import { describe, expect, test } from "vitest";

import { ProviderOverrideSchema } from "./provider-config.js";

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

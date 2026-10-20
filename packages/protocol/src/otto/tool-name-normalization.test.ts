import { describe, expect, it } from "vitest";
import { getPaseoToolLeafName, isPaseoToolName } from "../tool-name-normalization.js";

describe("Otto MCP tool names", () => {
  it("recognizes tools served by the otto MCP server", () => {
    expect(isPaseoToolName("mcp__otto__create_agent")).toBe(true);
    expect(isPaseoToolName("otto.create_agent")).toBe(true);
    expect(getPaseoToolLeafName("mcp__otto__list_agents")).toBe("list_agents");
  });

  it("does not claim tools from other MCP servers", () => {
    expect(isPaseoToolName("mcp__ottoman__create_agent")).toBe(false);
    expect(isPaseoToolName("mcp__github__create_issue")).toBe(false);
  });
});

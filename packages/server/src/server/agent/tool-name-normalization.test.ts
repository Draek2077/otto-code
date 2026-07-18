import { describe, expect, it } from "vitest";

import {
  getMcpToolLeafName,
  getOttoToolLeafName,
  isOttoToolName,
} from "@otto-code/protocol/tool-name-normalization";

describe("isOttoToolName", () => {
  it("detects Claude Code format", () => {
    expect(isOttoToolName("mcp__otto__create_agent")).toBe(true);
    expect(isOttoToolName("mcp__otto__list_agents")).toBe(true);
  });

  it("detects otto_voice variant", () => {
    expect(isOttoToolName("mcp__otto_voice__create_agent")).toBe(true);
    expect(isOttoToolName("otto_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isOttoToolName("mcp__otto_voice__speak")).toBe(false);
    expect(isOttoToolName("mcp__otto__speak")).toBe(false);
    expect(isOttoToolName("otto.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isOttoToolName("otto.create_agent")).toBe(true);
  });

  it("rejects non-otto tools", () => {
    expect(isOttoToolName("Bash")).toBe(false);
    expect(isOttoToolName("Read")).toBe(false);
    expect(isOttoToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getOttoToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getOttoToolLeafName("mcp__otto__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getOttoToolLeafName("otto.create_agent")).toBe("create_agent");
    expect(getOttoToolLeafName("otto.list_agents")).toBe("list_agents");
  });

  it("returns null for non-otto tools", () => {
    expect(getOttoToolLeafName("Bash")).toBeNull();
  });
});

describe("getMcpToolLeafName", () => {
  it("strips the namespace from any MCP server, not just otto", () => {
    expect(getMcpToolLeafName("mcp__otto__spawn_task")).toBe("spawn_task");
    expect(getMcpToolLeafName("mcp__linear__create_issue")).toBe("create_issue");
    expect(getMcpToolLeafName("mcp__otto_voice__create_agent")).toBe("create_agent");
  });

  it("returns null for plain, non-namespaced tool names", () => {
    expect(getMcpToolLeafName("Bash")).toBeNull();
    expect(getMcpToolLeafName("read_file")).toBeNull();
  });

  it("never treats a speak tool as namespaced", () => {
    expect(getMcpToolLeafName("mcp__otto__speak")).toBeNull();
  });
});

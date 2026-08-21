import { describe, expect, it } from "vitest";

import { buildToolCallDisplayModel, getToolDisplayName } from "./tool-call-display.js";

describe("shared tool-call display mapping", () => {
  it("builds summary from canonical detail", () => {
    const display = buildToolCallDisplayModel({
      name: "read_file",
      status: "running",
      error: null,
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
      },
      cwd: "/tmp/repo",
    });

    expect(display).toEqual({
      displayName: "Read",
      summary: "src/index.ts",
    });
  });

  it("does not infer summaries from unknown raw detail", () => {
    const display = buildToolCallDisplayModel({
      name: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: { command: "npm test" },
        output: null,
      },
    });

    expect(display).toEqual({
      displayName: "Exec Command",
    });
  });

  it("uses sub-agent detail for task label and description", () => {
    const display = buildToolCallDisplayModel({
      name: "task",
      status: "running",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        log: "[Read] README.md",
      },
    });

    expect(display).toEqual({
      displayName: "Explore",
      summary: "Inspect repository structure",
    });
  });

  it("builds display model for worktree setup detail", () => {
    const display = buildToolCallDisplayModel({
      name: "otto_worktree_setup",
      status: "running",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath: "/tmp/repo/.otto/worktrees/repo/branch",
        branchName: "feature-branch",
        log: "==> [1/1] Running: npm install\n",
        commands: [
          {
            index: 1,
            command: "npm install",
            cwd: "/tmp/repo/.otto/worktrees/repo/branch",
            log: "==> [1/1] Running: npm install\n",
            status: "running",
            exitCode: null,
          },
        ],
      },
    });

    expect(display).toEqual({
      displayName: "Worktree Setup",
      summary: "feature-branch",
    });
  });

  it("provides errorText for failed calls", () => {
    const display = buildToolCallDisplayModel({
      name: "shell",
      status: "failed",
      error: { message: "boom" },
      detail: {
        type: "unknown",
        input: null,
        output: null,
      },
    });

    expect(display.errorText).toBe('{\n  "message": "boom"\n}');
  });

  it("labels terminal interaction rows without a summary when no command is available", () => {
    const display = buildToolCallDisplayModel({
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        icon: "square_terminal",
      },
    });

    expect(display).toEqual({
      displayName: "Terminal",
    });
  });

  it("uses the command as terminal interaction summary when available", () => {
    const display = buildToolCallDisplayModel({
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        label: "npm run test",
        icon: "square_terminal",
      },
    });

    expect(display).toEqual({
      displayName: "Terminal",
      summary: "npm run test",
    });
  });

  it("humanizes Otto MCP tool names (Claude Code format)", () => {
    const display = buildToolCallDisplayModel({
      name: "mcp__otto__create_chat",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Create Chat");
  });

  it("humanizes Otto MCP tool names (Codex format)", () => {
    const display = buildToolCallDisplayModel({
      name: "otto.create_chat",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Create Chat");
  });

  it("humanizes list_chats Otto tool", () => {
    const display = buildToolCallDisplayModel({
      name: "mcp__otto__list_chats",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("List Chats");
  });

  it("humanizes a non-Otto MCP tool by dropping its namespace", () => {
    const display = buildToolCallDisplayModel({
      name: "mcp__linear__create_issue",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Create Issue");
  });

  it("does not override speak tool display name", () => {
    const display = buildToolCallDisplayModel({
      name: "speak",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Speak");
  });

  describe("getToolDisplayName", () => {
    it("strips the MCP/Otto namespace and title-cases the leaf", () => {
      expect(getToolDisplayName("mcp__otto__suggest_task")).toBe("Suggest Task");
      expect(getToolDisplayName("otto.list_chats")).toBe("List Chats");
      expect(getToolDisplayName("suggest_task")).toBe("Suggest Task");
    });

    it("splits camelCase / PascalCase tool ids into words", () => {
      expect(getToolDisplayName("WebSearch")).toBe("Web Search");
      expect(getToolDisplayName("MultiEdit")).toBe("Multi Edit");
      expect(getToolDisplayName("ExitPlanMode")).toBe("Exit Plan Mode");
    });

    it("prefers curated names for lowercase compound tools the splitter can't segment", () => {
      expect(getToolDisplayName("websearch")).toBe("Web Search");
      expect(getToolDisplayName("todowrite")).toBe("Update Todos");
      expect(getToolDisplayName("ls")).toBe("List Files");
    });

    it("falls back to a readable name for unknown tools", () => {
      expect(getToolDisplayName("some_new_tool")).toBe("Some New Tool");
    });
  });

  it("labels plan detail rows as Plan", () => {
    const display = buildToolCallDisplayModel({
      name: "plan",
      status: "completed",
      error: null,
      detail: {
        type: "plan",
        text: "### Login Screen\n- Build layout",
      },
    });

    expect(display).toEqual({
      displayName: "Plan",
    });
  });
});

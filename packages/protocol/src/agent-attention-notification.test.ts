import { describe, expect, it } from "vitest";
import {
  buildAgentAttentionNotificationPayload,
  findLatestAssistantMessageFromTimeline,
  findLatestPermissionRequest,
} from "./agent-attention-notification.js";

describe("buildAgentAttentionNotificationPayload", () => {
  it("builds finished notifications from markdown assistant text", () => {
    const payload = buildAgentAttentionNotificationPayload({
      reason: "finished",
      serverId: "srv-1",
      agentId: "agent-1",
      assistantMessage: "**Done**. Updated `README.md` and [link](https://example.com).",
    });

    expect(payload).toEqual({
      title: "Agent finished",
      body: "Done. Updated README.md and link.",
      data: {
        serverId: "srv-1",
        agentId: "agent-1",
        reason: "finished",
      },
    });
  });

  it("builds permission notifications from request details", () => {
    const payload = buildAgentAttentionNotificationPayload({
      reason: "permission",
      serverId: "srv-2",
      agentId: "agent-2",
      permissionRequest: {
        id: "perm-1",
        provider: "claude",
        name: "exec",
        kind: "tool",
        title: "**Approve command**",
        description: "Run `git push`",
      },
    });

    expect(payload).toEqual({
      title: "Agent needs permission",
      body: "Approve command - Run git push",
      data: {
        serverId: "srv-2",
        agentId: "agent-2",
        reason: "permission",
      },
    });
  });

  it("summarizes a bare tool permission request without dumping raw JSON", () => {
    const payload = buildAgentAttentionNotificationPayload({
      reason: "permission",
      serverId: "srv-4",
      agentId: "agent-4",
      permissionRequest: {
        id: "perm-2",
        provider: "claude",
        name: "Bash",
        kind: "tool",
        input: {
          command: "git status packages/*/dist 2>/dev/null | head -20",
          description: "Check if dist folders are tracked or have changes",
        },
      },
    });

    expect(payload.title).toBe("Agent needs permission");
    expect(payload.body).toBe("Run command: git status packages/*/dist 2>/dev/null | head -20");
    expect(payload.body).not.toContain("{");
  });

  it("falls back to a friendly tool name when there is no legible input", () => {
    const payload = buildAgentAttentionNotificationPayload({
      reason: "permission",
      serverId: "srv-5",
      agentId: "agent-5",
      permissionRequest: {
        id: "perm-3",
        provider: "claude",
        name: "external_directory",
        kind: "tool",
      },
    });

    expect(payload.body).toBe("Access directory");
  });

  it("uses error-specific defaults when reason is error", () => {
    const payload = buildAgentAttentionNotificationPayload({
      reason: "error",
      serverId: "srv-3",
      agentId: "agent-3",
    });

    expect(payload).toEqual({
      title: "Agent needs attention",
      body: "Encountered an error.",
      data: {
        serverId: "srv-3",
        agentId: "agent-3",
        reason: "error",
      },
    });
  });
});

describe("findLatestAssistantMessageFromTimeline", () => {
  it("joins the latest contiguous assistant chunks", () => {
    expect(
      findLatestAssistantMessageFromTimeline([
        { type: "user_message", text: "start" },
        { type: "assistant_message", text: "Part " },
        { type: "assistant_message", text: "one" },
        { type: "reasoning", text: "thinking..." },
        { type: "assistant_message", text: "Done " },
        { type: "assistant_message", text: "now" },
      ]),
    ).toBe("Done now");
  });
});

describe("findLatestPermissionRequest", () => {
  it("returns the most recently inserted request", () => {
    const pending = new Map([
      ["first", { id: "first", provider: "claude", name: "a", kind: "tool" } as const],
      ["second", { id: "second", provider: "claude", name: "b", kind: "tool" } as const],
    ]);

    expect(findLatestPermissionRequest(pending)?.id).toBe("second");
  });
});

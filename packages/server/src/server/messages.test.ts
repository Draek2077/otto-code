import { describe, expect, test, vi } from "vitest";

import type { AgentStreamEvent } from "./agent/agent-sdk-types.js";
import {
  AgentStreamEventPayloadSchema,
  SessionInboundMessageSchema,
  serializeAgentStreamEvent,
} from "./messages.js";

describe("serializeAgentStreamEvent", () => {
  test("accepts create_agent_request env records", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-env",
      config: {
        provider: "codex",
        cwd: "/tmp",
      },
      env: {
        CHUNK14_PROBE: "expected",
      },
      attachments: [],
    });

    expect(parsed).toMatchObject({
      type: "create_agent_request",
      env: {
        CHUNK14_PROBE: "expected",
      },
    });
  });

  test("rejects non-string create_agent_request env values", () => {
    const parsed = SessionInboundMessageSchema.safeParse({
      type: "create_agent_request",
      requestId: "req-env",
      config: {
        provider: "codex",
        cwd: "/tmp",
      },
      env: {
        CHUNK14_PROBE: 14,
      },
      attachments: [],
    });

    expect(parsed.success).toBe(false);
  });

  test("preserves user_message text as-is", () => {
    const event: AgentStreamEvent = {
      type: "timeline",
      provider: "claude",
      item: {
        type: "user_message",
        text: "<otto-instructions>\nX\n</otto-instructions>\n\nHello",
        messageId: "m1",
      },
    };

    const serialized = serializeAgentStreamEvent(event);
    expect(serialized).not.toBeNull();
    if (!serialized || serialized.type !== "timeline" || serialized.item.type !== "user_message") {
      throw new Error("Expected timeline.user_message event");
    }
    expect(serialized.item.text).toBe(event.item.text);
    expect(serialized.item.messageId).toBe("m1");
  });

  test("passes canonical tool_call payloads through unchanged", () => {
    const event: AgentStreamEvent = {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "call_1",
        name: "shell",
        status: "running",
        detail: {
          type: "shell",
          command: "pwd",
        },
        error: null,
      },
    };

    const serialized = serializeAgentStreamEvent(event);
    expect(serialized).not.toBeNull();
    if (!serialized || serialized.type !== "timeline" || serialized.item.type !== "tool_call") {
      throw new Error("Expected timeline.tool_call event");
    }
    expect(serialized.item.status).toBe("running");
    expect(serialized.item.error).toBeNull();
  });

  test("passes unknown-detail tool_call payloads through unchanged", () => {
    const event: AgentStreamEvent = {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "call_unknown",
        name: "otto_voice.speak",
        status: "completed",
        detail: {
          type: "unknown",
          input: { text: "hello" },
          output: { ok: true },
        },
        error: null,
      },
    };

    const serialized = serializeAgentStreamEvent(event);
    expect(serialized).not.toBeNull();
    if (!serialized || serialized.type !== "timeline" || serialized.item.type !== "tool_call") {
      throw new Error("Expected timeline.tool_call event");
    }
    expect(serialized.item.detail).toEqual({
      type: "unknown",
      input: { text: "hello" },
      output: { ok: true },
    });
  });

  test("drops invalid legacy tool_call items", () => {
    const event = {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "call_legacy",
        name: "shell",
        status: "inProgress",
        detail: {
          type: "unknown",
          input: { command: "pwd" },
          output: null,
        },
      },
    } satisfies unknown;

    const serialized = serializeAgentStreamEvent(event as AgentStreamEvent);
    expect(serialized).toBeNull();
  });

  test("drops internal session config drift events from websocket payloads", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "mode_changed",
        provider: "codex",
        currentModeId: "build",
        availableModes: [{ id: "build", label: "Build" }],
      },
      {
        type: "model_changed",
        provider: "codex",
        runtimeInfo: { provider: "codex", sessionId: "session-1", model: "gpt-5.4" },
      },
      {
        type: "thinking_option_changed",
        provider: "codex",
        thinkingOptionId: "high",
      },
    ];

    expect(events.map((event) => serializeAgentStreamEvent(event))).toEqual([null, null, null]);
  });

  test("parses a given event object once, however many sessions serialize it", () => {
    const event: AgentStreamEvent = {
      type: "timeline",
      provider: "claude",
      item: {
        type: "user_message",
        text: "shared across sessions",
        messageId: "m-memo",
      },
    };
    const safeParse = vi.spyOn(AgentStreamEventPayloadSchema, "safeParse");

    try {
      const first = serializeAgentStreamEvent(event);
      const second = serializeAgentStreamEvent(event);
      const third = serializeAgentStreamEvent(event);

      expect(first).not.toBeNull();
      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(safeParse).toHaveBeenCalledTimes(1);
    } finally {
      safeParse.mockRestore();
    }
  });

  test("parses distinct event objects separately, even when identical in content", () => {
    const build = (): AgentStreamEvent => ({
      type: "timeline",
      provider: "claude",
      item: {
        type: "user_message",
        text: "same content, different object",
        messageId: "m-distinct",
      },
    });
    const safeParse = vi.spyOn(AgentStreamEventPayloadSchema, "safeParse");

    try {
      const first = serializeAgentStreamEvent(build());
      const second = serializeAgentStreamEvent(build());

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(safeParse).toHaveBeenCalledTimes(2);
    } finally {
      safeParse.mockRestore();
    }
  });

  test("memoizes rejected events without re-parsing them", () => {
    const invalid = {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "call_memo_invalid",
        name: "shell",
        status: "inProgress",
        detail: {
          type: "unknown",
          input: { command: "pwd" },
          output: null,
        },
      },
    } as unknown as AgentStreamEvent;
    const safeParse = vi.spyOn(AgentStreamEventPayloadSchema, "safeParse");

    try {
      expect(serializeAgentStreamEvent(invalid)).toBeNull();
      expect(serializeAgentStreamEvent(invalid)).toBeNull();
      expect(safeParse).toHaveBeenCalledTimes(1);
    } finally {
      safeParse.mockRestore();
    }
  });
});

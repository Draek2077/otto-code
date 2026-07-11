import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveStreamTurnTiming } from "./turn-time";
import type { StreamItem } from "@/types/stream";

function user(id: string, timestamp: Date): StreamItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp,
  };
}

function assistant(id: string, timestamp: Date): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp,
  };
}

describe("deriveStreamTurnTiming", () => {
  it("uses the last user message as the running turn start", () => {
    const firstUserAt = new Date("2026-05-15T00:00:00.000Z");
    const secondUserAt = new Date("2026-05-15T00:01:00.000Z");

    const timing = deriveStreamTurnTiming({
      agentStatus: "running",
      tail: [
        user("u1", firstUserAt),
        assistant("a1", new Date("2026-05-15T00:00:05.000Z")),
        user("u2", secondUserAt),
      ],
      head: [assistant("a2", new Date("2026-05-15T00:01:04.000Z"))],
    });

    assert.equal(timing.runningStartedAt, secondUserAt);
    assert.equal(timing.byAssistantId.has("a2"), false);
  });

  it("derives completed turn timing from user and assistant item timestamps", () => {
    const userAt = new Date("2026-05-15T00:00:00.000Z");
    const assistantAt = new Date("2026-05-15T00:00:07.000Z");

    const timing = deriveStreamTurnTiming({
      agentStatus: "idle",
      tail: [
        user("u1", userAt),
        assistant("a1", assistantAt),
        user("u2", new Date("2026-05-15T00:01:00.000Z")),
      ],
      head: [],
    });

    assert.deepEqual(timing.byAssistantId.get("a1"), {
      startedAt: userAt,
      completedAt: assistantAt,
      durationMs: 7000,
    });
  });

  it("maps multiple assistant chunks in one turn to the same timing", () => {
    const userAt = new Date("2026-05-15T00:00:00.000Z");
    const firstAssistantAt = new Date("2026-05-15T00:00:03.000Z");
    const lastAssistantAt = new Date("2026-05-15T00:00:07.000Z");

    const timing = deriveStreamTurnTiming({
      agentStatus: "idle",
      tail: [
        user("u1", userAt),
        assistant("a1", firstAssistantAt),
        assistant("a2", lastAssistantAt),
      ],
      head: [],
    });

    const expected = {
      startedAt: userAt,
      completedAt: lastAssistantAt,
      durationMs: 7000,
    };
    assert.deepEqual(timing.byAssistantId.get("a1"), expected);
    assert.deepEqual(timing.byAssistantId.get("a2"), expected);
  });

  it("carries a turn's stamped usage to every assistant chunk in that turn only", () => {
    const usage = { inputTokens: 100, outputTokens: 200 };
    const stamped: StreamItem = {
      kind: "assistant_message",
      id: "a2",
      text: "a2",
      timestamp: new Date("2026-05-15T00:00:07.000Z"),
      turnUsage: usage,
    };

    const timing = deriveStreamTurnTiming({
      agentStatus: "idle",
      tail: [
        user("u1", new Date("2026-05-15T00:00:00.000Z")),
        assistant("a1", new Date("2026-05-15T00:00:03.000Z")),
        stamped,
        user("u2", new Date("2026-05-15T00:01:00.000Z")),
        assistant("a3", new Date("2026-05-15T00:01:05.000Z")),
      ],
      head: [],
    });

    assert.deepEqual(timing.byAssistantId.get("a1")?.usage, usage);
    assert.deepEqual(timing.byAssistantId.get("a2")?.usage, usage);
    assert.equal(timing.byAssistantId.get("a3")?.usage, undefined);
  });

  it("estimates running-turn tokens from the current turn's streamed text only", () => {
    const streamedText: StreamItem = {
      kind: "assistant_message",
      id: "a2",
      text: "x".repeat(400),
      timestamp: new Date("2026-05-15T00:01:02.000Z"),
    };

    const timing = deriveStreamTurnTiming({
      agentStatus: "running",
      tail: [
        user("u1", new Date("2026-05-15T00:00:00.000Z")),
        assistant("a1", new Date("2026-05-15T00:00:05.000Z")),
        user("u2", new Date("2026-05-15T00:01:00.000Z")),
      ],
      head: [streamedText],
    });

    // 400 chars at ~4 chars/token; the previous turn's text doesn't leak in.
    assert.equal(timing.runningEstimatedTokens, 100);
  });

  it("reports the exact running estimate without rounding to steps", () => {
    const streamedText: StreamItem = {
      kind: "assistant_message",
      id: "a1",
      // 880 chars → 220 tokens, reported exactly.
      text: "x".repeat(880),
      timestamp: new Date("2026-05-15T00:00:02.000Z"),
    };

    const timing = deriveStreamTurnTiming({
      agentStatus: "running",
      tail: [user("u1", new Date("2026-05-15T00:00:00.000Z"))],
      head: [streamedText],
    });

    assert.equal(timing.runningEstimatedTokens, 220);
  });

  it("reports no running token estimate when the agent is idle", () => {
    const timing = deriveStreamTurnTiming({
      agentStatus: "idle",
      tail: [
        user("u1", new Date("2026-05-15T00:00:00.000Z")),
        assistant("a1", new Date("2026-05-15T00:00:05.000Z")),
      ],
      head: [],
    });

    assert.equal(timing.runningEstimatedTokens, null);
  });
});

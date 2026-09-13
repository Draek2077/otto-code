import { describe, expect, it } from "vitest";
import { finishedAssistantSegments } from "@/voice/auto-speech-segments";
import { createUserMessage, type StreamItem } from "@/types/stream";

function assistant(params: {
  id: string;
  text: string;
  groupId?: string;
  blockIndex?: number;
  turnId?: string;
}): StreamItem {
  return {
    kind: "assistant_message",
    id: params.id,
    turnId: params.turnId ?? "turn1",
    text: params.text,
    timestamp: new Date(0),
    ...(params.groupId ? { blockGroupId: params.groupId, blockIndex: params.blockIndex ?? 0 } : {}),
  };
}

function user(id: string, text: string): StreamItem {
  return {
    kind: "user_message",
    id,
    text,
    turnId: id === "u2" ? "turn2" : "turn1",
    timestamp: new Date(0),
  };
}

function tool(id: string): StreamItem {
  return {
    kind: "tool_call",
    turnId: "turn1",
    id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "Read",
        status: "running",
        error: null,
        detail: { type: "read", filePath: "file.ts" },
      },
    },
  };
}

function keys(segments: { key: string }[]): string[] {
  return segments.map((segment) => segment.key);
}

describe("finishedAssistantSegments", () => {
  it("holds back the paragraph the model is still writing", () => {
    const { segments } = finishedAssistantSegments({
      tail: [user("u1", "go")],
      head: [
        assistant({ id: "g1:block:0", text: "first", groupId: "g1", blockIndex: 0 }),
        assistant({ id: "g1:head", text: "second, still gro", groupId: "g1", blockIndex: 1 }),
      ],
      activeTurnId: "turn1",
      turnId: "turn1",
    });

    expect(keys(segments)).toEqual(["g1:0"]);
  });

  it("releases a bubble when the stream moves on to an action", () => {
    const { segments } = finishedAssistantSegments({
      tail: [user("u1", "go"), assistant({ id: "g1:head", text: "I will check.", groupId: "g1" })],
      head: [tool("t1")],
      activeTurnId: "turn1",
      turnId: "turn1",
    });

    expect(keys(segments)).toEqual(["g1:0"]);
  });

  it("releases the last paragraph when the turn ends", () => {
    const items = [
      user("u1", "go"),
      assistant({ id: "g1:block:0", text: "first", groupId: "g1", blockIndex: 0 }),
      assistant({ id: "g1:block:1", text: "second", groupId: "g1", blockIndex: 1 }),
    ];
    const { segments } = finishedAssistantSegments({
      tail: items,
      head: [],
      activeTurnId: null,
      turnId: "turn1",
    });

    expect(keys(segments)).toEqual(["g1:0", "g1:1"]);
  });

  it("keys on (group, block) so the head→tail flush is not a new segment", () => {
    // The same paragraph before and after finalization: the id is rewritten,
    // the key is not. A caller diffing on the key sees one segment, not two.
    const live = finishedAssistantSegments({
      tail: [user("u1", "go")],
      head: [
        assistant({ id: "g1:head", text: "done", groupId: "g1", blockIndex: 0 }),
        assistant({ id: "g1:head:next", text: "writing", groupId: "g1", blockIndex: 1 }),
      ],
      activeTurnId: "turn1",
      turnId: "turn1",
    });
    const flushed = finishedAssistantSegments({
      tail: [
        user("u1", "go"),
        assistant({ id: "g1:block:0", text: "done", groupId: "g1", blockIndex: 0 }),
      ],
      head: [],
      activeTurnId: null,
      turnId: "turn1",
    });

    expect(keys(live.segments)).toEqual(["g1:0"]);
    expect(keys(flushed.segments)).toEqual(["g1:0"]);
  });

  it("does not un-finish the previous reply when a new turn is sent", () => {
    // Opening another identified turn cannot make this reply unfinished.
    const finished = finishedAssistantSegments({
      tail: [
        user("u1", "go"),
        assistant({ id: "g1:block:0", text: "answer", groupId: "g1", blockIndex: 0 }),
      ],
      head: [],
      activeTurnId: null,
      turnId: "turn1",
    });
    expect(finished.turnKey).toBe("turn1");

    const sending = finishedAssistantSegments({
      tail: [
        user("u1", "go"),
        assistant({ id: "g1:block:0", text: "answer", groupId: "g1", blockIndex: 0 }),
      ],
      head: [],
      activeTurnId: "turn2",
      turnId: finished.turnKey,
    });
    expect(keys(sending.segments)).toEqual(["g1:0"]);
  });

  it("scopes to the current turn and names it", () => {
    // Earlier turns are not "just finished" however they arrived in the buffer.
    const { turnKey, segments } = finishedAssistantSegments({
      tail: [
        user("u1", "first ask"),
        assistant({ id: "g1:block:0", text: "old answer", groupId: "g1", blockIndex: 0 }),
        user("u2", "second ask"),
        assistant({
          id: "g2:block:0",
          text: "new answer",
          groupId: "g2",
          blockIndex: 0,
          turnId: "turn2",
        }),
      ],
      head: [],
      activeTurnId: null,
      turnId: "turn2",
    });

    expect(turnKey).toBe("turn2");
    expect(keys(segments)).toEqual(["g2:0"]);
  });

  it("ignores assistant items with no block identity", () => {
    const { segments } = finishedAssistantSegments({
      tail: [assistant({ id: "loose", text: "no group" })],
      head: [],
      activeTurnId: null,
      turnId: "turn1",
    });

    expect(segments).toEqual([]);
  });

  it("does not infer a turn from untagged history or a user-row identity", () => {
    const message = assistant({ id: "history", text: "old", groupId: "g1" });
    delete message.turnId;
    expect(
      finishedAssistantSegments({
        tail: [user("u1", "old prompt"), message],
        head: [],
        turnId: "turn1",
        activeTurnId: null,
      }).segments,
    ).toEqual([]);
    expect(
      finishedAssistantSegments({
        tail: [message],
        head: [],
        turnId: null,
        activeTurnId: null,
      }).segments,
    ).toEqual([]);
  });

  it("ignores pending steering and unrelated turns when identifying growing prose", () => {
    // Local submissions have client identity, but no daemon turn identity until acknowledged.
    const steering = createUserMessage({
      clientMessageId: "steer",
      text: "continue",
      timestamp: new Date(0),
    });
    const { segments } = finishedAssistantSegments({
      tail: [user("u1", "go"), assistant({ id: "g1:head", text: "writing", groupId: "g1" })],
      head: [steering, { ...tool("other-tool"), turnId: "other-turn" }],
      turnId: "turn1",
      activeTurnId: "turn1",
    });
    expect(segments).toEqual([]);
  });

  it("keeps one turn across canonical steering user rows", () => {
    const { turnKey, segments } = finishedAssistantSegments({
      tail: [
        user("u1", "go"),
        assistant({ id: "g1:head", text: "first", groupId: "g1" }),
        user("steer", "continue"),
      ],
      head: [assistant({ id: "g2:head", text: "writing", groupId: "g2" })],
      turnId: "turn1",
      activeTurnId: "turn1",
    });
    expect(turnKey).toBe("turn1");
    expect(keys(segments)).toEqual(["g1:0"]);
  });
});

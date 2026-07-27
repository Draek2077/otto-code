import { describe, expect, it } from "vitest";
import { finishedAssistantSegments } from "@/voice/auto-speech-segments";
import type { StreamItem } from "@/types/stream";

function assistant(params: {
  id: string;
  text: string;
  groupId?: string;
  blockIndex?: number;
}): StreamItem {
  return {
    kind: "assistant_message",
    id: params.id,
    text: params.text,
    timestamp: new Date(0),
    ...(params.groupId ? { blockGroupId: params.groupId, blockIndex: params.blockIndex ?? 0 } : {}),
  };
}

function user(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp: new Date(0) };
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
      running: true,
      settledTurnKey: null,
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
      running: false,
      settledTurnKey: null,
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
      running: true,
      settledTurnKey: null,
    });
    const flushed = finishedAssistantSegments({
      tail: [
        user("u1", "go"),
        assistant({ id: "g1:block:0", text: "done", groupId: "g1", blockIndex: 0 }),
      ],
      head: [],
      running: false,
      settledTurnKey: null,
    });

    expect(keys(live.segments)).toEqual(["g1:0"]);
    expect(keys(flushed.segments)).toEqual(["g1:0"]);
  });

  it("does not un-finish the previous reply when a new turn is sent", () => {
    // Sending flips the agent to running a beat before the daemon echoes the
    // user row, so for that beat the turn search lands on the finished reply.
    // Latching its key is what keeps its last paragraph finished.
    const finished = finishedAssistantSegments({
      tail: [
        user("u1", "go"),
        assistant({ id: "g1:block:0", text: "answer", groupId: "g1", blockIndex: 0 }),
      ],
      head: [],
      running: false,
      settledTurnKey: null,
    });
    expect(finished.settledTurnKey).toBe("u1");

    const sending = finishedAssistantSegments({
      tail: [
        user("u1", "go"),
        assistant({ id: "g1:block:0", text: "answer", groupId: "g1", blockIndex: 0 }),
      ],
      head: [],
      running: true,
      settledTurnKey: finished.settledTurnKey,
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
        assistant({ id: "g2:block:0", text: "new answer", groupId: "g2", blockIndex: 0 }),
      ],
      head: [],
      running: false,
      settledTurnKey: null,
    });

    expect(turnKey).toBe("u2");
    expect(keys(segments)).toEqual(["g2:0"]);
  });

  it("ignores assistant items with no block identity", () => {
    const { segments } = finishedAssistantSegments({
      tail: [assistant({ id: "loose", text: "no group" })],
      head: [],
      running: false,
      settledTurnKey: null,
    });

    expect(segments).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { StreamItem, AgentToolCallItem, ThoughtItem } from "@/types/stream";
import { createStreamPresentation } from "@/agent-stream/presentation";
import { createGroupedStreamPresentation, getGroupedHistoryStartId } from "./action-groups";

function tool(
  id: string,
  status: AgentToolCallItem["payload"]["data"]["status"] = "completed",
): AgentToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(100),
    turnId: "turn-1",
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "Read",
        status,
        error: status === "failed" ? "failure" : null,
        detail: { type: "read", filePath: `${id}.ts` },
      },
    },
  };
}
function thought(id: string, status: ThoughtItem["status"] = "ready"): ThoughtItem {
  return {
    kind: "thought",
    id,
    text: "Reasoning",
    timestamp: new Date(100),
    turnId: "turn-1",
    status,
  };
}
function message(id: string): Extract<StreamItem, { kind: "assistant_message" }> {
  return { kind: "assistant_message", id, text: id, timestamp: new Date(200) };
}
function input(tail: StreamItem[], head: StreamItem[] = []) {
  return {
    tail,
    head,
    level: "detailed" as const,
    isTurnActive: true,
    transform: undefined,
    groupConsecutiveActions: true,
  };
}

describe("Otto action grouping through the stream presentation", () => {
  it("uses explicit remote loading only at a compressed history start", () => {
    const present = createGroupedStreamPresentation();
    const grouped = present(input([tool("a"), tool("b")]));
    expect(getGroupedHistoryStartId(grouped.tail, grouped.actionGroupsByHostId, false, true)).toBe(
      grouped.tail[0].id,
    );
    expect(
      getGroupedHistoryStartId(grouped.tail, grouped.actionGroupsByHostId, true, true),
    ).toBeNull();
    expect(
      getGroupedHistoryStartId(grouped.tail, grouped.actionGroupsByHostId, false, false),
    ).toBeNull();
    const ordinary = present(input([message("older"), tool("a"), tool("b")]));
    expect(
      getGroupedHistoryStartId(ordinary.tail, ordinary.actionGroupsByHostId, false, true),
    ).toBeNull();
  });
  it("folds settled tools and reasoning while preserving messages and canonical rows", () => {
    const first = tool("read"),
      second = thought("reason"),
      reply = message("reply");
    const tail = [first, second, reply];
    const present = createGroupedStreamPresentation();
    const result = present(input(tail));
    const group = [...result.actionGroupsByHostId.values()][0];
    expect(result.tail).toHaveLength(2);
    expect(result.tail[1]).toBe(reply);
    expect(group.members).toEqual([first, second]);
    expect(group.counts).toEqual({ read: 1, thought: 1 });
    expect(tail).toEqual([first, second, reply]);
    expect(first.id).toBe("read");
  });

  it("keeps live parallel calls outside the group and its key stable as they settle", () => {
    const live = tool("slow", "running"),
      a = tool("a"),
      b = tool("b");
    const present = createGroupedStreamPresentation();
    const before = present(input([live, a, b]));
    const id = before.tail[0].id;
    expect(before.tail[1]).toBe(live);
    expect(before.actionGroupsByHostId.get(id)?.members).toEqual([a, b]);
    const completed = tool("slow");
    const after = present(input([completed, a, b]));
    expect(after.tail.map((row) => row.id)).toEqual([id]);
    expect(after.actionGroupsByHostId.get(id)?.members).toEqual([completed, a, b]);
  });

  it("leaves lone actions and the streaming head untouched", () => {
    const tail = [tool("only")];
    const head = [thought("live", "loading")];
    const result = createGroupedStreamPresentation()(input(tail, head));
    expect(result.tail).toEqual(tail);
    expect(result.head).toEqual(head);
    expect(result.actionGroupsByHostId.size).toBe(0);
  });

  it.each(["plan", "speak", "plugin", "notification", "compaction", "message", "user"])(
    "does not collapse across %s content",
    (kind) => {
      let boundary: StreamItem = message("boundary");
      if (kind === "plan" || kind === "speak") {
        const call = tool("content");
        if (call.payload.source !== "agent") throw new Error("agent fixture expected");
        boundary = {
          ...call,
          payload: {
            source: "agent",
            data: {
              ...call.payload.data,
              name: kind,
              detail:
                kind === "plan"
                  ? { type: "plan", text: "Plan" }
                  : { type: "unknown", input: "Spoken message", output: null },
            },
          },
        };
      }
      if (kind === "plugin")
        boundary = {
          kind: "plugin",
          id: "plugin",
          pluginId: "test",
          pluginItemId: "card",
          itemKind: "card",
          version: 1,
          data: {},
          timestamp: new Date(100),
        };
      if (kind === "notification")
        boundary = {
          kind,
          id: kind,
          level: "warning",
          sourceType: "notification",
          message: "Notice",
          timestamp: new Date(100),
        };
      if (kind === "compaction")
        boundary = { kind, id: kind, status: "completed", timestamp: new Date(100) };
      if (kind === "user")
        boundary = { kind: "user_message", id: kind, text: "Prompt", timestamp: new Date(100) };
      const tail = [tool("a"), tool("b"), boundary, tool("c"), tool("d")];
      const result = createGroupedStreamPresentation()(input(tail));
      expect(result.tail).toHaveLength(3);
      expect(result.tail[1]).toBe(boundary);
      expect(result.actionGroupsByHostId.size).toBe(2);
    },
  );

  it("does not combine explicit canonical turns", () => {
    const result = createGroupedStreamPresentation()(
      input([
        tool("a"),
        tool("b"),
        { ...tool("c"), turnId: "turn-2" },
        { ...tool("d"), turnId: "turn-2" },
      ]),
    );
    expect(result.tail).toHaveLength(2);
    expect(result.actionGroupsByHostId.size).toBe(2);
  });

  it("keeps failed and canceled tools inspectable and reports failures in the summary", () => {
    const calls = [tool("bad", "failed"), tool("cancel", "canceled"), tool("good")];
    const group = [
      ...createGroupedStreamPresentation()(input(calls)).actionGroupsByHostId.values(),
    ][0];
    expect(group.members).toEqual(calls);
    expect(group.failedCount).toBe(1);
  });

  it("retains an existing summary key when older history extends its run", () => {
    const a = tool("a"),
      b = tool("b");
    const present = createGroupedStreamPresentation();
    const before = present(input([a, b]));
    const after = present(input([tool("older"), a, b]));
    expect(after.tail[0].id).toBe(before.tail[0].id);
    expect(after.actionGroupsByHostId.get(after.tail[0].id)?.members).toHaveLength(3);
  });

  it("retains unchanged group hosts when another run updates", () => {
    const prefix = [tool("a"), tool("b"), message("boundary")];
    const present = createGroupedStreamPresentation();
    const before = present(input([...prefix, tool("live", "running")]));
    const after = present(input([...prefix, tool("live"), tool("next")]));
    expect(after.tail[0]).toBe(before.tail[0]);
    expect(after.actionGroupsByHostId.get(after.tail[0].id)).toBe(
      before.actionGroupsByHostId.get(before.tail[0].id),
    );
  });

  it("keeps distinct host keys if a new content boundary splits a previously grouped run", () => {
    const calls = [tool("a"), tool("b"), tool("c"), tool("d")];
    const present = createGroupedStreamPresentation();
    present(input(calls));
    const result = present(
      input([calls[0], calls[1], message("new-boundary"), calls[2], calls[3]]),
    );
    expect(result.actionGroupsByHostId.size).toBe(2);
    expect(new Set(result.tail.map((item) => item.id)).size).toBe(3);
    expect([...result.actionGroupsByHostId.values()].flatMap((group) => group.members)).toEqual(
      calls,
    );
  });

  it("respects the retained opt-out and leaves Paseo Overview projection intact", () => {
    const tail = [tool("a"), tool("b")];
    const present = createGroupedStreamPresentation();
    expect(
      present({ ...input(tail), groupConsecutiveActions: false }).actionGroupsByHostId.size,
    ).toBe(0);
    const overviewInput = { ...input(tail), level: "overview" as const };
    const expected = createStreamPresentation()(overviewInput);
    const actual = present(overviewInput);
    expect(actual.tail).toEqual(expected.tail);
    expect(actual.groupsByHostId).toEqual(expected.groupsByHostId);
    expect(actual.actionGroupsByHostId.size).toBe(0);
  });

  it("does no history payload work during 200 text deltas over 2,000 rows", () => {
    let reads = 0;
    const tail = Array.from({ length: 500 }, (_, i) => [
      message(`before-${i}`),
      tool(`a-${i}`),
      tool(`b-${i}`),
      message(`after-${i}`),
    ]).flat();
    for (const row of tail)
      if (row.kind === "tool_call") {
        const payload = row.payload;
        Object.defineProperty(row, "payload", {
          get() {
            reads++;
            return payload;
          },
        });
      }
    const present = createGroupedStreamPresentation();
    const first = present(input(tail));
    reads = 0;
    for (let tick = 0; tick < 200; tick++) {
      const next = present(input(tail, [{ ...message("live"), text: "token ".repeat(tick) }]));
      expect(next.tail).toBe(first.tail);
      expect(next.actionGroupsByHostId).toBe(first.actionGroupsByHostId);
    }
    expect(reads).toBe(0);
  });
});

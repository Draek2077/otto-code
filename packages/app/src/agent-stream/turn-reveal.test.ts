import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  clampRevealBudget,
  computeLiveTurnReveal,
  nextRevealLength,
  TurnRevealTicker,
} from "./turn-reveal";

function assistant(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: new Date(0) };
}

function user(id: string, text: string, optimistic?: true): StreamItem {
  return {
    kind: "user_message",
    id,
    text,
    timestamp: new Date(0),
    ...(optimistic ? { optimistic } : {}),
  };
}

function tool(id: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "Read",
        status: "completed",
        error: null,
        detail: { type: "read", filePath: "file.ts" },
      },
    },
  };
}

describe("nextRevealLength", () => {
  it("returns the current length when already caught up", () => {
    assert.equal(nextRevealLength(120, 120), 120);
    assert.equal(nextRevealLength(150, 120), 150);
  });

  it("advances by the minimum step on a small backlog", () => {
    // Backlog of 4: ceil(4 / 8) = 1 is below the floor of 2.
    assert.equal(nextRevealLength(100, 104), 102);
  });

  it("advances proportionally to a moderate backlog", () => {
    // Backlog of 800: reveals 100 per tick.
    assert.equal(nextRevealLength(0, 800), 100);
  });

  it("caps the typing rate on a whole-message burst", () => {
    // Backlog of 4000 would step 500 proportionally; the cap keeps it at a
    // visible typing speed instead of an instant dump.
    assert.equal(nextRevealLength(0, 4000), 128);
  });

  it("skips ahead so the pending backlog never exceeds the bound", () => {
    // 50k pending (background tab): jump to the last 8000 chars, then type.
    const next = nextRevealLength(0, 50_000);
    assert.equal(next, 50_000 - 8000 + 128);
  });

  it("never overshoots the target", () => {
    assert.equal(nextRevealLength(799, 800), 800);
  });

  it("converges from a large burst within a bounded number of ticks", () => {
    let revealed = 0;
    let ticks = 0;
    while (revealed < 8000 && ticks < 200) {
      revealed = nextRevealLength(revealed, 8000);
      ticks += 1;
    }
    assert.equal(revealed, 8000);
    // ~32ms ticks: an 8k burst (the skip-ahead bound) finishes in about 3s —
    // ~62 capped ticks plus the proportional decay tail once under ~1k.
    assert.ok(ticks <= 110, `took ${ticks} ticks`);
  });
});

describe("computeLiveTurnReveal", () => {
  it("returns the empty reveal when the agent is not running", () => {
    const reveal = computeLiveTurnReveal({
      running: false,
      tail: [user("u1", "hi"), assistant("a1", "hello")],
      head: [],
    });
    assert.equal(reveal.spans.size, 0);
    assert.equal(reveal.totalChars, 0);
  });

  it("spans every assistant item after the last real user message", () => {
    const reveal = computeLiveTurnReveal({
      running: true,
      tail: [
        user("u1", "old turn"),
        assistant("old", "previous answer"),
        user("u2", "new turn"),
        assistant("a1", "First para."),
        tool("t1"),
        assistant("a2", "Second para."),
      ],
      head: [assistant("a3", "Live tail")],
    });
    assert.equal(reveal.turnKey, "u2");
    assert.equal(reveal.spans.has("old"), false);
    assert.deepEqual(reveal.spans.get("a1"), { start: 0, length: 11 });
    assert.deepEqual(reveal.spans.get("a2"), { start: 11, length: 12 });
    assert.deepEqual(reveal.spans.get("a3"), { start: 23, length: 9 });
    assert.equal(reveal.totalChars, 32);
  });

  it("does not treat an optimistic user message as a turn boundary", () => {
    const reveal = computeLiveTurnReveal({
      running: true,
      tail: [user("u1", "ask"), assistant("a1", "answering")],
      head: [user("u2", "queued while running", true)],
    });
    assert.equal(reveal.turnKey, "u1");
    assert.equal(reveal.spans.has("a1"), true);
  });

  it("keeps spans invariant across a block promotion reshape", () => {
    // Promotion splits one live item into settled blocks + a live tail; the
    // concatenated text (and so the reveal axis) is unchanged.
    const before = computeLiveTurnReveal({
      running: true,
      tail: [user("u1", "ask")],
      head: [assistant("live", "First para.Second para")],
    });
    const after = computeLiveTurnReveal({
      running: true,
      tail: [user("u1", "ask"), assistant("live:block:0", "First para.")],
      head: [assistant("live:head", "Second para")],
    });
    assert.equal(before.totalChars, after.totalChars);
    assert.deepEqual(after.spans.get("live:head"), { start: 11, length: 11 });
  });
});

describe("clampRevealBudget", () => {
  it("gives zero to items the reveal has not reached", () => {
    assert.equal(clampRevealBudget(5, { start: 10, length: 20 }), 0);
  });

  it("gives a partial budget to the boundary item", () => {
    assert.equal(clampRevealBudget(15, { start: 10, length: 20 }), 5);
  });

  it("caps fully revealed items at their own length", () => {
    assert.equal(clampRevealBudget(99, { start: 10, length: 20 }), 20);
  });
});

describe("TurnRevealTicker", () => {
  it("mounts caught up so history never replays", () => {
    const ticker = new TurnRevealTicker({ turnKey: "u1", target: 5000 });
    assert.equal(ticker.getRevealed(), 5000);
  });

  it("resets to zero on a genuine new turn", () => {
    const ticker = new TurnRevealTicker({ turnKey: "u1", target: 5000 });
    ticker.update({ turnKey: "u2", target: 0, enabled: true });
    assert.equal(ticker.getRevealed(), 0);
    ticker.update({ turnKey: "u2", target: 400, enabled: true });
    ticker.tick();
    assert.ok(ticker.getRevealed() > 0 && ticker.getRevealed() < 400);
  });

  it("snaps caught up when a boundary change carries lots of text (rebuild)", () => {
    const ticker = new TurnRevealTicker({ turnKey: "u1", target: 5000 });
    ticker.update({ turnKey: "rebuilt-u1", target: 4800, enabled: true });
    assert.equal(ticker.getRevealed(), 4800);
  });

  it("snaps to the target when disabled (turn completed)", () => {
    const ticker = new TurnRevealTicker({ turnKey: "u1", target: 0 });
    ticker.update({ turnKey: "u1", target: 900, enabled: true });
    ticker.tick();
    ticker.update({ turnKey: "u1", target: 900, enabled: false });
    assert.equal(ticker.getRevealed(), 900);
  });

  it("clamps when the target shrinks under the position", () => {
    const ticker = new TurnRevealTicker({ turnKey: "u1", target: 100 });
    ticker.update({ turnKey: "u1", target: 60, enabled: true });
    assert.equal(ticker.getRevealed(), 60);
  });

  it("notifies subscribers only when a tick moves the position", () => {
    const ticker = new TurnRevealTicker({ turnKey: "u1", target: 0 });
    let notified = 0;
    ticker.subscribe(() => {
      notified += 1;
    });
    ticker.tick();
    assert.equal(notified, 0);
    ticker.update({ turnKey: "u1", target: 100, enabled: true });
    ticker.tick();
    assert.equal(notified, 1);
  });
});

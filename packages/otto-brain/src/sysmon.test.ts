import { describe, expect, it } from "vitest";

import { SlotActivityTracker, summariseSlots } from "./sysmon.js";

/**
 * The shapes here are the ones llama.cpp has actually shipped: `is_processing`
 * with `n_decoded` on current builds, a numeric `state` on older ones, and
 * `tokens_predicted` on the builds in between. The split has to survive all
 * three, because which one is running is the user's choice of runtime.
 */
describe("summariseSlots", () => {
  it("reports an idle server", () => {
    const info = summariseSlots([
      { id: 0, is_processing: false, n_decoded: 0 },
      { id: 1, is_processing: false, n_decoded: 0 },
    ]);
    expect(info).toMatchObject({ total: 2, busy: 0, idle: 2, prefill: 0, decode: 0 });
  });

  it("counts a slot that is processing but has emitted nothing as prefill", () => {
    const info = summariseSlots([{ id: 0, is_processing: true, n_decoded: 0 }]);
    expect(info).toMatchObject({ busy: 1, prefill: 1, decode: 0 });
  });

  it("counts a slot that has emitted tokens as decode", () => {
    const info = summariseSlots([{ id: 0, is_processing: true, n_decoded: 42 }]);
    expect(info).toMatchObject({ busy: 1, prefill: 0, decode: 1 });
  });

  it("splits a server doing both at once", () => {
    const info = summariseSlots([
      { id: 0, is_processing: true, n_decoded: 0 },
      { id: 1, is_processing: true, n_decoded: 7 },
      { id: 2, is_processing: false, n_decoded: 0 },
    ]);
    expect(info).toMatchObject({ total: 3, busy: 2, idle: 1, prefill: 1, decode: 1 });
  });

  it("reads the older numeric state field", () => {
    const info = summariseSlots([
      { id: 0, state: 1, n_decoded: 0 },
      { id: 1, state: 0, n_decoded: 0 },
    ]);
    expect(info).toMatchObject({ busy: 1, prefill: 1, decode: 0 });
  });

  it("accepts the alternate spellings of the decoded counter", () => {
    expect(summariseSlots([{ is_processing: true, tokens_predicted: 3 }])).toMatchObject({
      decode: 1,
    });
    expect(summariseSlots([{ is_processing: true, n_decoded_tokens: 3 }])).toMatchObject({
      decode: 1,
    });
  });

  it("reads the current nested next_token counter in object and array forms", () => {
    expect(
      summariseSlots([
        { id: 0, is_processing: true, next_token: { n_decoded: 0 } },
        { id: 1, is_processing: true, next_token: [{ n_decoded: 7 }] },
      ]),
    ).toMatchObject({ busy: 2, prefill: 1, decode: 1 });
  });

  it("calls a busy slot with no counter at all decode, not prefill", () => {
    // Claiming prefill here would make the rail show "processing tokens"
    // for the whole of every response on that build.
    expect(summariseSlots([{ is_processing: true }])).toMatchObject({ prefill: 0, decode: 1 });
  });

  it("keeps busy as the sum of the two phases", () => {
    const info = summariseSlots([
      { is_processing: true, n_decoded: 0 },
      { is_processing: true, n_decoded: 1 },
      { is_processing: true, n_decoded: 2 },
    ]);
    expect(info.prefill + info.decode).toBe(info.busy);
  });

  it("still reports context sizes", () => {
    expect(summariseSlots([{ is_processing: false, n_ctx: 4096 }]).contexts).toEqual([4096]);
    expect(summariseSlots([{ is_processing: false, n_past: 512 }]).contexts).toEqual([512]);
    expect(summariseSlots([{ is_processing: false }]).contexts).toEqual([0]);
  });
});

describe("SlotActivityTracker", () => {
  it("keeps concurrent prompt and decode rates separate", () => {
    const tracker = new SlotActivityTracker();
    tracker.sample(
      [
        { is_processing: true, n_past: 100, n_decoded: 0 },
        { is_processing: true, n_past: 120, n_decoded: 5 },
      ],
      1_000,
    );
    const info = tracker.sample(
      [
        { is_processing: true, n_past: 160, n_decoded: 0 },
        { is_processing: true, n_past: 120, n_decoded: 25 },
      ],
      3_000,
    );
    expect(info.threads).toEqual([
      expect.objectContaining({ slot: 0, phase: "prefill", promptTokensPerSecond: 30 }),
      expect.objectContaining({ slot: 1, phase: "decode", tokensPerSecond: 10 }),
    ]);
  });

  it("reports a flat counter as not measuring, not zero tok/s", () => {
    // Prompt tokens land in chunks: a window where the counter has never moved
    // must stay quiet (null, which the UI renders as an empty rate column)
    // instead of flashing 0.
    const tracker = new SlotActivityTracker();
    tracker.sample([{ id: 0, id_task: 1, is_processing: true, n_past: 100, n_decoded: 0 }], 1_000);
    const flat = tracker.sample(
      [{ id: 0, id_task: 1, is_processing: true, n_past: 100, n_decoded: 0 }],
      2_000,
    );
    expect(flat.threads).toEqual([
      expect.objectContaining({ phase: "prefill", promptTokensPerSecond: null }),
    ]);
    // 100 tokens, first seen at 3s but last known absent at 1s: the honest rate
    // is 50/s over the interval they were earned in, not 100/s over the single
    // window they happened to become visible in.
    const moved = tracker.sample(
      [{ id: 0, id_task: 1, is_processing: true, n_past: 200, n_decoded: 0 }],
      3_000,
    );
    expect(moved.threads).toEqual([
      expect.objectContaining({ phase: "prefill", promptTokensPerSecond: 50 }),
    ]);
  });

  it("holds the last measured rate through windows where the counter is flat", () => {
    // The counters advance in chunks and /slots is polled far faster than they
    // move, so most windows are flat. Blanking the rate on those is what made
    // the number blink out and back on the Overview panel.
    const tracker = new SlotActivityTracker();
    tracker.sample([{ id: 0, id_task: 7, is_processing: true, n_decoded: 10 }], 1_000);
    const measured = tracker.sample(
      [{ id: 0, id_task: 7, is_processing: true, n_decoded: 30 }],
      2_000,
    );
    expect(measured.threads?.[0]?.tokensPerSecond).toBe(20);
    const flat = tracker.sample([{ id: 0, id_task: 7, is_processing: true, n_decoded: 30 }], 2_250);
    expect(flat.threads?.[0]?.tokensPerSecond).toBe(20);
  });

  it("does not carry a rate across a new request on the same slot", () => {
    const tracker = new SlotActivityTracker();
    tracker.sample([{ id: 0, id_task: 7, is_processing: true, n_decoded: 10 }], 1_000);
    tracker.sample([{ id: 0, id_task: 7, is_processing: true, n_decoded: 30 }], 2_000);
    // A different id_task is a different request; the previous request's
    // throughput says nothing about it.
    const reused = tracker.sample(
      [{ id: 0, id_task: 8, is_processing: true, n_decoded: 4 }],
      2_250,
    );
    expect(reused.threads?.[0]?.tokensPerSecond).toBeNull();
  });

  it("averages a chunked counter over the interval it actually covered", () => {
    // 100 prompt tokens land as one batch after four flat polls. Measuring that
    // chunk against the last poll alone would claim 400 tok/s; it was earned
    // over the whole second the slot spent on it.
    const tracker = new SlotActivityTracker();
    tracker.sample([{ id: 0, id_task: 3, is_processing: true, n_past: 100, n_decoded: 0 }], 1_000);
    for (const at of [1_250, 1_500, 1_750]) {
      tracker.sample([{ id: 0, id_task: 3, is_processing: true, n_past: 100, n_decoded: 0 }], at);
    }
    const chunk = tracker.sample(
      [{ id: 0, id_task: 3, is_processing: true, n_past: 200, n_decoded: 0 }],
      2_000,
    );
    expect(chunk.threads?.[0]?.promptTokensPerSecond).toBe(100);
  });

  it("names the idle slots so a request can be pinned to one", () => {
    const info = summariseSlots([
      { id: 0, is_processing: true },
      { id: 1, is_processing: false },
      { id: 2, is_processing: false },
    ]);
    expect(info.idle).toBe(2);
    expect(info.idleSlots).toEqual([1, 2]);
  });

  it("names no idle slot when every slot is busy", () => {
    expect(summariseSlots([{ id: 0, is_processing: true }]).idleSlots).toEqual([]);
  });

  it("falls back to row order when a slot carries no id", () => {
    expect(summariseSlots([{ is_processing: true }, { is_processing: false }]).idleSlots).toEqual([
      1,
    ]);
  });

  it("measures current nested decoded counters live", () => {
    const tracker = new SlotActivityTracker();
    tracker.sample(
      [{ id: 4, id_task: 20, is_processing: true, next_token: { n_decoded: 10 } }],
      1_000,
    );
    const info = tracker.sample(
      [{ id: 4, id_task: 20, is_processing: true, next_token: { n_decoded: 30 } }],
      1_500,
    );
    expect(info.threads).toEqual([
      expect.objectContaining({ slot: 4, generatedTokens: 30, tokensPerSecond: 40 }),
    ]);
  });

  it("starts a fresh rate window when llama-server reuses a slot", () => {
    const tracker = new SlotActivityTracker();
    tracker.sample(
      [{ id: 0, id_task: 1, is_processing: true, next_token: { n_decoded: 100 } }],
      1_000,
    );
    const info = tracker.sample(
      [{ id: 0, id_task: 2, is_processing: true, next_token: { n_decoded: 1 } }],
      2_000,
    );
    expect(info.threads).toEqual([
      expect.objectContaining({ slot: 0, generatedTokens: 1, tokensPerSecond: null }),
    ]);
  });

  it("treats a newly assigned task as prefill even when the decoded counter is stale", () => {
    const tracker = new SlotActivityTracker();
    tracker.sample(
      [{ id: 0, id_task: 1, is_processing: true, n_past: 500, n_decoded: 205 }],
      1_000,
    );
    tracker.sample(
      [{ id: 0, id_task: 2, is_processing: true, n_past: 3_500, n_decoded: 205 }],
      2_000,
    );
    const next = tracker.sample(
      [{ id: 0, id_task: 2, is_processing: true, n_past: 7_000, n_decoded: 205 }],
      3_000,
    );
    expect(next.threads).toEqual([
      expect.objectContaining({
        phase: "prefill",
        promptTokens: 7_000,
        generatedTokens: 205,
        promptTokensPerSecond: 3_500,
        tokensPerSecond: null,
      }),
    ]);
  });
});

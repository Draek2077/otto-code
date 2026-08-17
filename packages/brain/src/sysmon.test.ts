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
    // Prompt tokens land in chunks: a window where the counter did not move
    // must stay quiet (null, the UI's "Measuring…") instead of flashing 0.
    const tracker = new SlotActivityTracker();
    tracker.sample([{ id: 0, id_task: 1, is_processing: true, n_past: 100, n_decoded: 0 }], 1_000);
    const flat = tracker.sample(
      [{ id: 0, id_task: 1, is_processing: true, n_past: 100, n_decoded: 0 }],
      2_000,
    );
    expect(flat.threads).toEqual([
      expect.objectContaining({ phase: "prefill", promptTokensPerSecond: null }),
    ]);
    const moved = tracker.sample(
      [{ id: 0, id_task: 1, is_processing: true, n_past: 200, n_decoded: 0 }],
      3_000,
    );
    expect(moved.threads).toEqual([
      expect.objectContaining({ phase: "prefill", promptTokensPerSecond: 100 }),
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

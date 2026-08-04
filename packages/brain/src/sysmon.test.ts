import { describe, expect, it } from "vitest";

import { summariseSlots } from "./sysmon.js";

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

  it("calls a busy slot with no counter at all decode, not prefill", () => {
    // Claiming prefill here would make the rail show "processing incoming
    // tokens" for the whole of every response on that build.
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

import { describe, expect, it } from "vitest";

import { isSurvivablePipeError } from "./pipe-errors.js";

/**
 * The exact rejections a crashing csharp-ls produced, from a real daemon.log. Each one arrived
 * as "Unhandled promise rejection - daemon crashing" and restarted the daemon, so the whole
 * point of this classifier is that these three are survivable and nothing else quietly becomes so.
 */
describe("survivable pipe errors", () => {
  it("survives a write to a pipe whose reader exited", () => {
    expect(isSurvivablePipeError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).toBe(
      true,
    );
  });

  it("survives a write to a destroyed stream", () => {
    const error = Object.assign(new Error("Cannot call write after a stream was destroyed"), {
      code: "ERR_STREAM_DESTROYED",
    });

    expect(isSurvivablePipeError(error)).toBe(true);
  });

  it("survives a write after end", () => {
    expect(
      isSurvivablePipeError(
        Object.assign(new Error("write after end"), {
          code: "ERR_STREAM_WRITE_AFTER_END",
        }),
      ),
    ).toBe(true);
  });

  it("still crashes on a programming error, which is the whole point of the short list", () => {
    expect(isSurvivablePipeError(new TypeError("x is not a function"))).toBe(false);
  });

  it("still crashes on an unrelated system error", () => {
    expect(
      isSurvivablePipeError(
        Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
      ),
    ).toBe(false);
  });

  it("is not fooled by a non-error", () => {
    expect(isSurvivablePipeError(null)).toBe(false);
    expect(isSurvivablePipeError("EPIPE")).toBe(false);
    expect(isSurvivablePipeError(undefined)).toBe(false);
  });
});

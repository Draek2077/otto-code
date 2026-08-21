import { describe, expect, it } from "vitest";
import { resolveToolCallTextLayout } from "./text-layout";

describe("tool-call text layout", () => {
  it("keeps the compact activity row single-line by default", () => {
    expect(resolveToolCallTextLayout(false)).toEqual({ wrap: false, numberOfLines: 1 });
  });

  it("removes the line cap when complete tool-call text is requested", () => {
    expect(resolveToolCallTextLayout(true)).toEqual({ wrap: true, numberOfLines: undefined });
  });
});

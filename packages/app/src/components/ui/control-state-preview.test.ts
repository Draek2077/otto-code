import { describe, expect, it } from "vitest";
import { resolvePreviewFlag } from "./control-state-preview";

describe("control state preview", () => {
  it("uses the real interaction state when no gallery override exists", () => {
    expect(resolvePreviewFlag(undefined, false)).toBe(false);
    expect(resolvePreviewFlag(undefined, true)).toBe(true);
  });

  it("lets a deterministic gallery state override the real event", () => {
    expect(resolvePreviewFlag(true, false)).toBe(true);
    expect(resolvePreviewFlag(false, true)).toBe(false);
  });
});

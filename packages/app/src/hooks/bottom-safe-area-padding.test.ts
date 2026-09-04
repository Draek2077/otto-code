import { describe, expect, it } from "vitest";
import { resolveBottomSafeAreaPadding } from "./bottom-safe-area-padding";

describe("resolveBottomSafeAreaPadding", () => {
  it("keeps the authored rhythm when there is no system obstruction", () => {
    expect(resolveBottomSafeAreaPadding({ basePadding: 4, safeAreaBottom: 0 })).toBe(4);
  });

  it("adds exactly the reported bottom inset", () => {
    expect(resolveBottomSafeAreaPadding({ basePadding: 4, safeAreaBottom: 34 })).toBe(38);
  });

  it("does not turn an invalid negative inset into negative space", () => {
    expect(resolveBottomSafeAreaPadding({ basePadding: 4, safeAreaBottom: -1 })).toBe(4);
  });
});

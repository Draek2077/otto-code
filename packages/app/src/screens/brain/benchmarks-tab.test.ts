import { describe, expect, it } from "vitest";
import { timeSeverity } from "./benchmark-time-severity";

describe("benchmark comparison time severity", () => {
  it("keeps matching or incomplete timings neutral", () => {
    expect(timeSeverity(10, 10)).toBeNull();
    expect(timeSeverity(14.9, 10)).toBeNull();
    expect(timeSeverity(9.6, 10)).toBeNull();
    expect(timeSeverity(null, 10)).toBeNull();
  });

  it("marks a result at least 5% faster green", () => {
    expect(timeSeverity(9.5, 10)).toBe("success");
  });

  it("marks slower material timing outliers amber", () => {
    expect(timeSeverity(15, 10)).toBe("warning");
    expect(timeSeverity(10, 15)).toBe("success");
  });

  it("marks only slower extreme timing outliers red", () => {
    expect(timeSeverity(20, 10)).toBe("critical");
    expect(timeSeverity(10, 20)).toBe("success");
  });
});

import { describe, expect, it } from "vitest";
import { isNativePassiveRestickEligible, isNativeReaderAtNewestEdge } from "./native-bottom-bands";

describe("native chat bottom bands", () => {
  it("gives reader ownership to an ordinary drag instead of snapping it back", () => {
    // Regression: a 288 px shared snap band treated this as still at the
    // newest edge, notably after a keyboard viewport change.
    expect(isNativeReaderAtNewestEdge(96)).toBe(false);
    expect(isNativePassiveRestickEligible(96)).toBe(false);
  });

  it("allows only small passive Android layout drift to be corrected", () => {
    expect(isNativeReaderAtNewestEdge(24)).toBe(false);
    expect(isNativePassiveRestickEligible(24)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { deriveAvatarAcronym, readableTextColor } from "./avatar-badge";

describe("deriveAvatarAcronym", () => {
  it("takes the first letter of the first two words for multi-word names", () => {
    expect(deriveAvatarAcronym("Otto Crew")).toBe("OC");
    expect(deriveAvatarAcronym("red green blue")).toBe("RG");
  });

  it("caps the acronym at two letters", () => {
    expect(deriveAvatarAcronym("one two three four five")).toBe("OT");
  });

  it("uses the first letter of a single-word name", () => {
    expect(deriveAvatarAcronym("Otto")).toBe("O");
  });

  it("skips leading articles when significant words remain", () => {
    expect(deriveAvatarAcronym("The Otto Crew")).toBe("OC");
    expect(deriveAvatarAcronym("The Something")).toBe("S");
    expect(deriveAvatarAcronym("A Team")).toBe("T");
    expect(deriveAvatarAcronym("An Otter Named Otto")).toBe("ON");
  });

  it("keeps articles when the name is only articles", () => {
    expect(deriveAvatarAcronym("The")).toBe("T");
    expect(deriveAvatarAcronym("The A")).toBe("TA");
  });

  it("ignores leading punctuation and emoji", () => {
    expect(deriveAvatarAcronym("🚀 launch team")).toBe("LT");
    expect(deriveAvatarAcronym("  spaced   out  ")).toBe("SO");
  });

  it("returns an empty string when nothing usable is found", () => {
    expect(deriveAvatarAcronym("")).toBe("");
    expect(deriveAvatarAcronym("   ")).toBe("");
    expect(deriveAvatarAcronym("✨🚀")).toBe("");
  });
});

describe("readableTextColor", () => {
  // Ink values come from the design system's accentFillInk formula (perceived
  // luminance, dark ink is #141417) so badges match accent chips.
  it("returns dark text on light backgrounds", () => {
    expect(readableTextColor("#ffffff")).toBe("#141417");
    expect(readableTextColor("#eab308")).toBe("#141417"); // amber
  });

  it("returns light text on dark backgrounds", () => {
    expect(readableTextColor("#000000")).toBe("#ffffff");
    expect(readableTextColor("#4f46e5")).toBe("#ffffff"); // indigo
  });

  it("accepts shorthand hex and a missing leading hash", () => {
    expect(readableTextColor("fff")).toBe("#141417");
    expect(readableTextColor("000")).toBe("#ffffff");
  });

  it("falls back to white for unparseable input", () => {
    expect(readableTextColor("not-a-color")).toBe("#ffffff");
    expect(readableTextColor("")).toBe("#ffffff");
  });
});

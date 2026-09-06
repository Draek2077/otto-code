import { describe, expect, it } from "vitest";
import { resolveResponsivePlaceholder } from "./placeholder";

describe("resolveResponsivePlaceholder", () => {
  const input = {
    placeholder: "Message the agent, tag @files, or use /commands and /skills",
    compactPlaceholder: "Message, @files, /commands",
  };

  it("keeps the complete watermark when it fits on one line", () => {
    expect(
      resolveResponsivePlaceholder({ ...input, availableWidth: 500, placeholderWidth: 500 }),
    ).toBe(input.placeholder);
  });

  it("uses the compact watermark when the complete wording would wrap", () => {
    expect(
      resolveResponsivePlaceholder({ ...input, availableWidth: 499, placeholderWidth: 500 }),
    ).toBe(input.compactPlaceholder);
  });

  it("waits for a real width measurement before changing the watermark", () => {
    expect(
      resolveResponsivePlaceholder({ ...input, availableWidth: 0, placeholderWidth: 500 }),
    ).toBe(input.placeholder);
  });

  it("does not replace a placeholder that has no compact form", () => {
    expect(
      resolveResponsivePlaceholder({
        ...input,
        compactPlaceholder: undefined,
        availableWidth: 100,
        placeholderWidth: 500,
      }),
    ).toBe(input.placeholder);
  });
});

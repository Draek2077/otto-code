import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_INPUT_HEIGHT, MIN_INPUT_HEIGHT, resolveMaxInputHeight } from "./max-height";

// The chrome the resolver reserves: 2 x spacing[4] + spacing[3] + 2px border +
// (28 - 6) toolbar row. Mirrored here so a change to either has to be deliberate.
const CHROME = 68;

describe("resolveMaxInputHeight", () => {
  it("falls back to the default cap when no viewport has been measured yet", () => {
    expect(resolveMaxInputHeight({ viewportHeight: 0, isCompact: false })).toBe(
      DEFAULT_MAX_INPUT_HEIGHT,
    );
    expect(resolveMaxInputHeight({ viewportHeight: Number.NaN, isCompact: true })).toBe(
      DEFAULT_MAX_INPUT_HEIGHT,
    );
    expect(resolveMaxInputHeight({ viewportHeight: -100, isCompact: false })).toBe(
      DEFAULT_MAX_INPUT_HEIGHT,
    );
  });

  it("caps the whole composer at half a desktop viewport", () => {
    expect(resolveMaxInputHeight({ viewportHeight: 1080, isCompact: false })).toBe(540 - CHROME);
  });

  it("keeps a smaller share on compact form factors", () => {
    const compact = resolveMaxInputHeight({ viewportHeight: 850, isCompact: true });
    const regular = resolveMaxInputHeight({ viewportHeight: 850, isCompact: false });
    expect(compact).toBe(340 - CHROME);
    expect(compact).toBeLessThan(regular);
  });

  it("leaves room for the toolbar so the send button stays inside the viewport", () => {
    for (const viewportHeight of [200, 300, 480, 720, 1080, 1440, 2160]) {
      for (const isCompact of [true, false]) {
        const cap = resolveMaxInputHeight({ viewportHeight, isCompact });
        expect(cap + CHROME).toBeLessThanOrEqual(viewportHeight);
      }
    }
  });

  it("scales with the viewport rather than a fixed pixel cap", () => {
    const short = resolveMaxInputHeight({ viewportHeight: 600, isCompact: false });
    const tall = resolveMaxInputHeight({ viewportHeight: 1600, isCompact: false });
    expect(tall).toBeGreaterThan(short);
  });

  it("never collapses below one line, even in a pane too short for the chrome", () => {
    expect(resolveMaxInputHeight({ viewportHeight: 80, isCompact: true })).toBe(MIN_INPUT_HEIGHT);
  });

  it("tracks a short pane instead of the window it sits in", () => {
    // The regression: a 300px split pane inside a 1080px window used to get the
    // window's cap and push the toolbar out the bottom.
    const pane = resolveMaxInputHeight({ viewportHeight: 300, isCompact: false });
    expect(pane).toBeLessThan(resolveMaxInputHeight({ viewportHeight: 1080, isCompact: false }));
    expect(pane + CHROME).toBeLessThanOrEqual(300);
  });
});

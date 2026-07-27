import { describe, expect, it } from "vitest";
import { formatLiveTokenCount, formatTokenCount } from "./context-window-meter.utils";

describe("formatTokenCount", () => {
  it("rounds to whole units", () => {
    expect(formatTokenCount(934)).toBe("934");
    expect(formatTokenCount(12_300)).toBe("12k");
    expect(formatTokenCount(1_200_000)).toBe("1m");
  });
});

describe("formatLiveTokenCount", () => {
  it("keeps exact counts below a thousand", () => {
    expect(formatLiveTokenCount(0)).toBe("0");
    expect(formatLiveTokenCount(999)).toBe("999");
  });

  it("shows a tenth of a thousand so the running count keeps moving", () => {
    expect(formatLiveTokenCount(1000)).toBe("1.0k");
    expect(formatLiveTokenCount(1240)).toBe("1.2k");
    expect(formatLiveTokenCount(12_349)).toBe("12.3k");
    expect(formatLiveTokenCount(150_000)).toBe("150.0k");
  });

  it("shows a hundredth of a million past the million mark", () => {
    expect(formatLiveTokenCount(1_000_000)).toBe("1.00M");
    expect(formatLiveTokenCount(1_234_000)).toBe("1.23M");
  });
});

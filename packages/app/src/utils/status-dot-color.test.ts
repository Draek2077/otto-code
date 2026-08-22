import { describe, expect, it } from "vitest";
import { darkTheme, daylightTheme } from "@/styles/theme";
import { getStatusDotColor } from "./status-dot-color";

describe("getStatusDotColor", () => {
  it("uses the canonical semantic tint tokens for sidebar status dots", () => {
    expect(getStatusDotColor({ theme: daylightTheme, bucket: "attention" })).toBe(
      daylightTheme.colors.statusSuccess,
    );
    expect(getStatusDotColor({ theme: daylightTheme, bucket: "failed" })).toBe(
      daylightTheme.colors.statusDanger,
    );
    expect(getStatusDotColor({ theme: daylightTheme, bucket: "needs_input" })).toBe(
      daylightTheme.colors.statusWarning,
    );
    expect(getStatusDotColor({ theme: darkTheme, bucket: "running" })).toBe(
      darkTheme.colors.statusInfo,
    );
  });
});

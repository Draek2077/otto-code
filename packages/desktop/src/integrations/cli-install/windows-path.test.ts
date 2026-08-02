import { describe, expect, it } from "vitest";
import { planWindowsPathUpdate } from "./windows-path";

const BIN = "C:\\Users\\user\\.local\\bin";

describe("planWindowsPathUpdate", () => {
  it("appends the bin dir when it is absent", () => {
    expect(
      planWindowsPathUpdate({ currentRawPath: "C:\\Windows;C:\\Windows\\System32", binDir: BIN }),
    ).toEqual({
      needsUpdate: true,
      nextPath: "C:\\Windows;C:\\Windows\\System32;C:\\Users\\user\\.local\\bin",
    });
  });

  it("seeds an empty PATH without a leading separator", () => {
    expect(planWindowsPathUpdate({ currentRawPath: "", binDir: BIN })).toEqual({
      needsUpdate: true,
      nextPath: BIN,
    });
  });

  it("does not duplicate an entry that differs only by case or trailing slash", () => {
    for (const existing of [
      "c:\\users\\user\\.local\\bin",
      "C:\\Users\\user\\.local\\bin\\",
      "C:\\Users\\user\\.local\\bin  ",
    ]) {
      expect(
        planWindowsPathUpdate({ currentRawPath: `C:\\Windows;${existing}`, binDir: BIN }),
      ).toEqual({ needsUpdate: false, nextPath: `C:\\Windows;${existing}` });
    }
  });

  it("matches through %VAR% indirection instead of appending a duplicate", () => {
    expect(
      planWindowsPathUpdate({
        currentRawPath: "C:\\Windows;%USERPROFILE%\\.local\\bin",
        binDir: BIN,
        env: { USERPROFILE: "C:\\Users\\user" },
      }),
    ).toEqual({ needsUpdate: false, nextPath: "C:\\Windows;%USERPROFILE%\\.local\\bin" });
  });

  it("leaves unresolvable %VAR% segments intact rather than dropping them", () => {
    const current = "%NOT_SET%\\bin;C:\\Windows";
    expect(planWindowsPathUpdate({ currentRawPath: current, binDir: BIN, env: {} })).toEqual({
      needsUpdate: true,
      nextPath: `${current};${BIN}`,
    });
  });

  it("collapses a trailing separator instead of producing an empty segment", () => {
    expect(planWindowsPathUpdate({ currentRawPath: "C:\\Windows;", binDir: BIN })).toEqual({
      needsUpdate: true,
      nextPath: `C:\\Windows;${BIN}`,
    });
  });

  it("treats a blank bin dir as nothing to do", () => {
    expect(planWindowsPathUpdate({ currentRawPath: "C:\\Windows", binDir: "  " })).toEqual({
      needsUpdate: false,
      nextPath: "C:\\Windows",
    });
  });
});

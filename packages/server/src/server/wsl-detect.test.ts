import { describe, expect, test } from "vitest";

import { isRunningInWsl } from "./wsl-detect.js";

describe("isRunningInWsl", () => {
  test("detects WSL via WSL_DISTRO_NAME", () => {
    expect(isRunningInWsl({ WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
  });

  test("detects WSL via WSL_INTEROP", () => {
    expect(isRunningInWsl({ WSL_INTEROP: "/run/WSL/8_interop" })).toBe(true);
  });

  test("does not report WSL for a plain environment", () => {
    expect(isRunningInWsl({})).toBe(false);
  });
});

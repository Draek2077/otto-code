import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveOttoHome } from "./otto-home.js";
import { PRIVATE_DIRECTORY_MODE } from "./private-files.js";

const MODE_MASK = 0o777;

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe.skipIf(process.platform === "win32")("resolveOttoHome permissions", () => {
  test("creates OTTO_HOME with private permissions", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "otto-home-parent-"));
    const ottoHome = path.join(parent, "home");
    try {
      expect(resolveOttoHome({ OTTO_HOME: ottoHome })).toBe(ottoHome);
      expect(modeOf(ottoHome)).toBe(PRIVATE_DIRECTORY_MODE);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "vitest";

import { areEquivalentPaths, createPathEquivalenceMatcher, isPathInsideRoot } from "./path.js";

describe("path equivalence", () => {
  test.each([
    ["C:/Users/Administrator/GhostFactory", "C:\\Users\\Administrator\\GhostFactory"],
    ["d:\\Projects\\otto", "D:\\Projects\\otto"],
    ["C:\\Users\\Administrator\\GhostFactory\\", "C:\\Users\\Administrator\\GhostFactory"],
    [String.raw`\\?\C:\Users\Administrator\GhostFactory`, "C:\\Users\\Administrator\\GhostFactory"],
    [String.raw`\\?\UNC\server\share\GhostFactory`, String.raw`\\server\share\GhostFactory`],
  ])("matches Windows-equivalent cwd forms", (left, right) => {
    expect(areEquivalentPaths(left, right)).toBe(true);
    expect(createPathEquivalenceMatcher(left)(right)).toBe(true);
  });

  test("keeps POSIX path casing significant", () => {
    expect(
      areEquivalentPaths("/Users/Administrator/GhostFactory", "/users/administrator/ghostfactory"),
    ).toBe(false);
  });

  test("checks POSIX root containment without prefix false positives", () => {
    expect(isPathInsideRoot("/opt/otto", "/opt/otto/node_modules/@otto-code/server")).toBe(true);
    expect(isPathInsideRoot("/opt/otto", "/opt/otto-other")).toBe(false);
  });

  test("checks Windows root containment case-insensitively", () => {
    expect(
      isPathInsideRoot("C:\\Otto\\node_modules", "c:/otto/node_modules/@otto-code/server"),
    ).toBe(true);
    expect(isPathInsideRoot("C:\\Otto\\node_modules", "C:\\Otto\\node_modules-other")).toBe(false);
  });
});

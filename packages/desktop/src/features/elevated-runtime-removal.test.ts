import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildElevatedRuntimeRemovalScript,
  resolveManagedRuntimePath,
} from "./elevated-runtime-removal.js";

describe("elevated runtime removal", () => {
  it("limits deletion to a direct child of Otto's managed runtime directory", () => {
    expect(resolveManagedRuntimePath("C:\\Otto", "cuda-12-4-managed-b10357")).toBe(
      path.resolve("C:\\Otto", "otto-brain", "runtimes", "cuda-12-4-managed-b10357"),
    );
    expect(() => resolveManagedRuntimePath("C:\\Otto", "..\\config.json")).toThrow(
      "Invalid managed runtime name.",
    );
  });

  it("builds a literal-path removal script rather than a shell command", () => {
    const script = buildElevatedRuntimeRemovalScript("C:\\Otto\\otto-brain\\runtimes\\cuda");

    expect(script).toContain("Remove-Item -LiteralPath $runtimePath -Recurse -Force");
    expect(script).not.toContain("cmd.exe");
  });
});

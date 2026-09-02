import { describe, expect, it } from "vitest";
import { getExplorerRequestedTargetHost } from "./explorer-open-policy";

describe("getExplorerRequestedTargetHost", () => {
  it("keeps navigation and investigation surfaces in Explorer", () => {
    expect(getExplorerRequestedTargetHost({ kind: "working_diff" })).toBe("explorer");
    expect(getExplorerRequestedTargetHost({ kind: "fileHistory", path: "src/app.tsx" })).toBe(
      "explorer",
    );
    expect(getExplorerRequestedTargetHost({ kind: "gitLog", operation: "commit" })).toBe(
      "explorer",
    );
  });

  it("opens active work surfaces in Main", () => {
    expect(getExplorerRequestedTargetHost({ kind: "file", path: "src/app.tsx" })).toBe("main");
    expect(getExplorerRequestedTargetHost({ kind: "draft", draftId: "draft-1" })).toBe("main");
    expect(getExplorerRequestedTargetHost({ kind: "terminal", terminalId: "term-1" })).toBe("main");
  });
});

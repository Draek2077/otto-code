import { expect, it } from "vitest";
import { visualizerDiscovery } from "./discoveries";
it("shows actual new-file and diff excerpts", () => {
  expect(
    visualizerDiscovery(
      { type: "write", filePath: "a.ts", content: "export const value = 1;" },
      false,
    ),
  ).toEqual({ type: "code", label: "New: a.ts", content: "export const value = 1;" });
  expect(
    visualizerDiscovery({ type: "edit", filePath: "a.ts", unifiedDiff: "-old\n+new" }, false),
  ).toEqual({ type: "code", label: "a.ts", content: "-old\n+new" });
});
it("uses only supplied search counts and result titles", () => {
  expect(
    visualizerDiscovery(
      { type: "search", query: "symbol", numFiles: 2, numMatches: 3, filePaths: ["a.ts", "b.ts"] },
      false,
    ),
  ).toEqual({ type: "pattern", label: "symbol", content: "3 matches\n2 files\na.ts\nb.ts" });
  expect(visualizerDiscovery({ type: "search", query: "query" }, false)).toBeNull();
});
it("does not claim a test verdict from a command's prose", () => {
  expect(
    visualizerDiscovery({ type: "shell", command: "echo", output: "tests failed: 0" }, false),
  ).toEqual({ type: "finding", label: "Test output", content: "tests failed: 0" });
});
it("does not turn ordinary reads or empty results into a spray of cards", () => {
  expect(
    visualizerDiscovery({ type: "read", filePath: "a.ts", content: "code" }, false),
  ).toBeNull();
  expect(visualizerDiscovery({ type: "fetch", url: "https://example.test" }, false)).toBeNull();
});
it("keeps shell failures and text budgets explicit", () => {
  const failure = visualizerDiscovery(
    { type: "shell", command: "false", exitCode: 1, output: "x".repeat(20000) },
    true,
  );
  expect(failure).toEqual({ type: "error", label: "Command failed", content: "x".repeat(44) });
});

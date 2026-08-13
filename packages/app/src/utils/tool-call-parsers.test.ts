import { describe, expect, it } from "vitest";

import {
  buildLineDiff,
  parseUnifiedDiff,
  extractTaskEntriesFromToolCall,
} from "./tool-call-parsers";

describe("tool-call-parsers", () => {
  it("builds line diff for text changes", () => {
    const diff = buildLineDiff("old\nline\n", "new\nline\n");

    expect(diff.some((entry) => entry.type === "remove")).toBe(true);
    expect(diff.some((entry) => entry.type === "add")).toBe(true);
  });

  it("does not attach a false intraline comparison across a multi-line edit", () => {
    const diff = buildLineDiff(
      'var people = [\n  "john", "harry", "dick", "eric",\n  "jenny", "alexandra",\n];\n',
      'var people = [\n  "john", "harry", "dick", "yvonne",\n  "eric", "jenny", "alexandra",\n];\n',
    );

    expect(diff.filter((line) => line.type === "remove" || line.type === "add")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: '-  "john", "harry", "dick", "eric",' }),
        expect.objectContaining({ content: '+  "john", "harry", "dick", "yvonne",' }),
      ]),
    );
    expect(diff.some((line) => line.segments !== undefined)).toBe(false);
  });

  it("keeps old and new source coordinates on a source-pair diff", () => {
    expect(buildLineDiff("shared\nold\nlast", "shared\nnew\nlast")).toMatchObject([
      { type: "context", oldLineNumber: 1, newLineNumber: 1 },
      { type: "remove", oldLineNumber: 2 },
      { type: "add", newLineNumber: 2 },
      { type: "context", oldLineNumber: 3, newLineNumber: 3 },
    ]);
  });

  it("does not turn a terminal newline into a numbered blank diff row", () => {
    expect(buildLineDiff("one\ntwo\n", "one\ntwo\n")).toHaveLength(2);
  });

  it("parses unified diff", () => {
    const parsed = parseUnifiedDiff("@@\n-old\n+new\n");

    expect(parsed.find((entry) => entry.type === "remove")?.content).toBe("-old");
    expect(parsed.find((entry) => entry.type === "add")?.content).toBe("+new");
  });

  it("reads source coordinates from unified hunk headers", () => {
    const parsed = parseUnifiedDiff("@@ -10,2 +12,3 @@\n-old\n+new\n shared");

    expect(parsed).toMatchObject([
      { type: "header" },
      { type: "remove", oldLineNumber: 10 },
      { type: "add", newLineNumber: 12 },
      { type: "context", oldLineNumber: 11, newLineNumber: 13 },
    ]);
  });

  it("extracts TodoWrite task entries", () => {
    const tasks = extractTaskEntriesFromToolCall("TodoWrite", {
      todos: [
        { content: "Task 1", status: "pending" },
        { content: "Task 2", status: "completed" },
      ],
    });

    expect(tasks?.map((task) => task.text)).toEqual(["Task 1", "Task 2"]);
    expect(tasks?.map((task) => task.completed)).toEqual([false, true]);
  });
});

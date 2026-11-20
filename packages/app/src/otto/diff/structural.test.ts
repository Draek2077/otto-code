import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLineDiff } from "@/utils/tool-call-parsers";
import { buildStructuralSplitRows, buildSplitDiffRows } from "@/utils/diff-layout";
import {
  buildStructuralDiffBlocks,
  buildStructuralDiffRows,
  buildStructuralSourceIndex,
  getStructuralDiffAvailability,
  isSyntaxFormattingOnly,
} from "./structural";

describe("structural review", () => {
  it("recognizes a wrapped syntax tree without hiding a changed literal", () => {
    const check = (beforeSource: string, afterSource: string) =>
      isSyntaxFormattingOnly({
        filePath: "sample.ts",
        beforeSource,
        afterSource,
        lines: buildLineDiff(beforeSource, afterSource),
      });
    expect(check("const x = { key: 1 };", "const x = {\n  key: 1\n};")).toBe(true);
    expect(check('const x = "a b";', 'const x = "ab";')).toBe(false);
  });

  it("preserves layout-sensitive JavaScript syntax changes", () => {
    const beforeSource = "function example() { return 1; }";
    const afterSource = "function example() { return\n1; }";
    expect(
      isSyntaxFormattingOnly({
        filePath: "return.ts",
        beforeSource,
        afterSource,
        lines: buildLineDiff(beforeSource, afterSource),
      }),
    ).toBe(false);
  });

  it("reuses projected snapshots while retaining at most four source indexes", () => {
    const source = "const cached = 7;";
    const first = buildStructuralSourceIndex(source, "cached.ts");
    expect(first).not.toBeNull();
    expect(buildStructuralSourceIndex(source, "cached.ts")).toBe(first);
    for (let index = 0; index < 4; index += 1) {
      buildStructuralSourceIndex(`const next = ${index};`, "other.ts");
    }
    expect(buildStructuralSourceIndex(source, "cached.ts")).not.toBe(first);
  });

  it("bounds the comparison cost of long lines even inside the candidate and source caps", () => {
    const oldLine = `// ${"a".repeat(300)}`;
    const newLine = `// ${"b".repeat(300)}`;
    const beforeSource = Array.from({ length: 50 }, () => oldLine).join("\n");
    const afterSource = Array.from({ length: 50 }, () => newLine).join("\n");
    const lines = [
      ...Array.from({ length: 50 }, () => ({ type: "remove" as const, content: `-${oldLine}` })),
      ...Array.from({ length: 50 }, () => ({ type: "add" as const, content: `+${newLine}` })),
    ];
    // 2,500 candidate cells are within the matrix cap. At 610 input
    // characters per candidate the text-work limit still admits this file.
    const input = { filePath: "long-lines.ts", beforeSource, afterSource, lines };
    expect(getStructuralDiffAvailability(input)).toEqual({ available: true });
    // A second hunk shares the same source budget, but comparison work is
    // cumulative. No second alignment matrix is allocated for this file.
    expect(
      getStructuralDiffAvailability({
        ...input,
        lines: [...lines, { type: "header", content: "@@" }, ...lines],
      }),
    ).toMatchObject({ available: false, code: "large-diff" });
  });

  it("limits alignment work before parsing or allocating a large candidate matrix", () => {
    const beforeSource = Array.from({ length: 100 }, (_, index) => `const left${index} = 1;`).join(
      "\n",
    );
    const afterSource = Array.from({ length: 100 }, (_, index) => `const right${index} = 2;`).join(
      "\n",
    );
    expect(
      getStructuralDiffAvailability({
        filePath: "bounded.ts",
        beforeSource,
        afterSource,
        lines: buildLineDiff(beforeSource, afterSource),
      }),
    ).toMatchObject({ available: false, code: "large-diff" });
  });

  it("keeps every original review coordinate while aligning a replacement past an added declaration", () => {
    const before = "const alpha = 1;\nconst beta = 2;";
    const after = "const extra = 0;\nconst alpha = 3;\nconst beta = 2;";
    const file = {
      path: "sample.ts",
      isNew: false,
      isDeleted: false,
      additions: 2,
      deletions: 1,
      structuralSource: { before, after },
      hunks: [
        {
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 3,
          lines: buildLineDiff(before, after).map((line) => ({
            type: line.type,
            content: line.content.slice(1),
          })),
        },
      ],
    };
    const plan = buildStructuralSplitRows(file);
    expect(plan.notice).toBeNull();
    expect(plan.rows).toContainEqual(
      expect.objectContaining({
        kind: "pair",
        left: expect.objectContaining({
          lineNumber: 1,
          reviewTarget: expect.objectContaining({ key: "sample.ts:old:1" }),
        }),
        right: expect.objectContaining({
          lineNumber: 2,
          reviewTarget: expect.objectContaining({ key: "sample.ts:new:2" }),
        }),
      }),
    );
    expect(buildStructuralSplitRows(file)).toBe(plan);
  });

  it.each([
    ["unknown.xyz", "a", "b", "unsupported-language"],
    ["sample.ts", "const a = 1;", "const b = {", "invalid-source"],
    ["sample.ts", "x".repeat(16001), "const b = 1;", "large-diff"],
    ["sample.ts", undefined, "const b = 1;", "missing-source"],
  ] as const)(
    "falls back to the canonical Line diff for %s (%s)",
    (filePath, beforeSource, afterSource, code) => {
      const lines = buildLineDiff("const a = 1;", "const b = 1;");
      expect(
        getStructuralDiffAvailability({ filePath, beforeSource, afterSource, lines }),
      ).toMatchObject({
        available: false,
        code,
      });
      const file = {
        path: filePath,
        isNew: false,
        isDeleted: false,
        additions: 1,
        deletions: 1,
        ...(beforeSource === undefined
          ? {}
          : { structuralSource: { before: beforeSource, after: afterSource } }),
        hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines }],
      };
      expect(buildStructuralSplitRows(file).rows).toEqual(buildSplitDiffRows(file));
    },
  );

  it.each([
    // Paired edits, shared nonblank lines, additions, removals, replayed from v0.9.35.
    ["simple", "js", [0, 1, 1, 1]],
    ["json", "json", [2, 2, 1, 0]],
    ["comma_and_comment", "js", [1, 0, 0, 0]],
    ["contiguous", "js", [1, 0, 2, 0]],
    ["javascript_simple", "js", [4, 1, 2, 0]],
    ["html_simple", "html", [4, 5, 0, 0]],
    ["if", "py", [1, 2, 0, 0]],
    ["hyphen_subwords", "json", [1, 2, 0, 0]],
  ] as const)(
    "preserves alignment and source order in the pinned %s.%s pair",
    (stem, extension, counts) => {
      const load = (side: number) =>
        readFileSync(
          new URL(`./fixtures/difftastic/${stem}_${side}.${extension}.fixture`, import.meta.url),
          "utf8",
        );
      const beforeSource = load(1);
      const afterSource = load(2);
      const lines = buildLineDiff(beforeSource, afterSource);
      const source = { filePath: `${stem}.${extension}`, beforeSource, afterSource, lines };
      expect(getStructuralDiffAvailability(source)).toEqual({ available: true });
      const rows = buildStructuralDiffRows(source);
      const paired = rows.flatMap((row) => (row.kind === "pair" ? [row] : []));
      expect([
        paired.filter(({ left, right }) => left?.type === "remove" && right?.type === "add").length,
        paired.filter(
          ({ left, right }) =>
            left?.type === "context" && right?.type === "context" && left.content.trim(),
        ).length,
        paired.filter(({ left, right }) => !left && right).length,
        paired.filter(({ left, right }) => left && !right).length,
      ]).toEqual(counts);
      expect(paired.flatMap((row) => (row.left ? [row.left.content] : []))).toEqual(
        lines.filter((line) => line.type !== "add").map((line) => line.content),
      );
      expect(paired.flatMap((row) => (row.right ? [row.right.content] : []))).toEqual(
        lines.filter((line) => line.type !== "remove").map((line) => line.content),
      );
      expect(buildStructuralDiffBlocks(source).length).toBeGreaterThan(0);
    },
  );
});

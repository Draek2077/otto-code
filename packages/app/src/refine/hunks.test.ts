import { describe, expect, it } from "vitest";
import {
  allHunkIds,
  applyRefineDecisions,
  buildRefineDiff,
  countKeptChanges,
  groupDiffHunks,
  type RefineDiff,
} from "./hunks";
import { buildLineDiff, type DiffLine } from "@/utils/tool-call-parsers";

const BASE = ["alpha", "bravo", "charlie", "delta", "echo"].join("\n");

describe("applyRefineDecisions round-trip properties", () => {
  const cases: Array<{ name: string; base: string; proposal: string }> = [
    {
      name: "a mixed rewrite",
      base: BASE,
      proposal: ["alpha", "BRAVO", "delta", "echo"].join("\n"),
    },
    { name: "an unchanged document", base: BASE, proposal: BASE },
    { name: "a pure addition", base: BASE, proposal: `${BASE}\nfoxtrot` },
    { name: "a pure deletion", base: BASE, proposal: ["alpha", "echo"].join("\n") },
    { name: "an emptied document", base: BASE, proposal: "" },
    { name: "a created document", base: "", proposal: BASE },
    { name: "both empty", base: "", proposal: "" },
    { name: "a trailing newline", base: `${BASE}\n`, proposal: `${BASE}\nfoxtrot\n` },
  ];

  for (const { name, base, proposal } of cases) {
    it(`keeps nothing → the base, keeps everything → the proposal (${name})`, () => {
      const diff = buildRefineDiff(base, proposal);
      expect(applyRefineDecisions(diff, new Set())).toBe(base);
      expect(applyRefineDecisions(diff, allHunkIds(diff))).toBe(proposal);
    });
  }
});

describe("applyRefineDecisions", () => {
  it("strips the diff prefix character from every line it takes", () => {
    // The gotcha this module exists to contain: DiffLine.content carries its
    // own leading +/-/space. A missed slice would show up as "+"-prefixed text.
    const diff = buildRefineDiff("one\ntwo", "one\nTWO");
    const kept = applyRefineDecisions(diff, allHunkIds(diff));
    expect(kept).toBe("one\nTWO");
    expect(kept).not.toContain("+");
    expect(applyRefineDecisions(diff, new Set())).toBe("one\ntwo");
  });

  it("applies one hunk and leaves the other at its base text", () => {
    const base = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].join("\n");
    const proposal = ["A", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "L"].join("\n");
    const diff = buildRefineDiff(base, proposal);
    expect(diff.hunks).toHaveLength(2);

    const [first, second] = diff.hunks;
    expect(applyRefineDecisions(diff, new Set([first!.id]))).toBe(
      ["A", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].join("\n"),
    );
    expect(applyRefineDecisions(diff, new Set([second!.id]))).toBe(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "L"].join("\n"),
    );
  });

  it("normalizes CRLF input to LF, the way the editor buffer and the write RPC do", () => {
    const diff = buildRefineDiff("one\r\ntwo\r\nthree", "one\r\nTWO\r\nthree");
    expect(applyRefineDecisions(diff, new Set())).toBe("one\ntwo\nthree");
    expect(applyRefineDecisions(diff, allHunkIds(diff))).toBe("one\nTWO\nthree");
  });

  it("ignores unified-diff headers rather than writing them into the file", () => {
    const lines: DiffLine[] = [
      { type: "header", content: "@@ -1,2 +1,2 @@" },
      { type: "context", content: " one" },
      { type: "remove", content: "-two" },
      { type: "add", content: "+TWO" },
    ];
    const diff: RefineDiff = { lines, hunks: groupDiffHunks(lines) };
    expect(applyRefineDecisions(diff, allHunkIds(diff))).toBe("one\nTWO");
  });
});

describe("groupDiffHunks", () => {
  it("returns no hunks for an unchanged document", () => {
    expect(groupDiffHunks(buildLineDiff(BASE, BASE))).toEqual([]);
  });

  it("returns no hunks for an empty diff", () => {
    expect(groupDiffHunks([])).toEqual([]);
  });

  it("keeps changes separated by less than the context window in one hunk", () => {
    const base = ["a", "b", "c", "d", "e"].join("\n");
    const proposal = ["A", "b", "c", "E", "e"].join("\n");
    const hunks = groupDiffHunks(buildLineDiff(base, proposal));
    expect(hunks).toHaveLength(1);
  });

  it("splits changes separated by the full context window, without repeating context", () => {
    const base = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const proposal = ["A", "b", "c", "d", "E", "f", "g", "h"].join("\n");
    const hunks = groupDiffHunks(buildLineDiff(base, proposal));
    expect(hunks).toHaveLength(2);
    // Adjacent, never overlapping: the shared context belongs to the first.
    const firstLines = new Set(hunks[0]!.lines.map((line) => line.content));
    const secondLines = hunks[1]!.lines.map((line) => line.content);
    expect(secondLines.filter((content) => firstLines.has(content))).toEqual([]);
  });

  it("counts additions and removals per hunk", () => {
    const diff = buildRefineDiff(BASE, ["alpha", "BRAVO", "CHARLIE", "delta", "echo"].join("\n"));
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]).toMatchObject({ id: "h0", additions: 2, removals: 2 });
  });

  it("includes surrounding context lines in what a hunk renders", () => {
    const base = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
    const diff = buildRefineDiff(base, ["a", "b", "c", "D", "e", "f", "g"].join("\n"));
    expect(diff.hunks[0]!.lines.map((line) => line.content)).toEqual([
      " a",
      " b",
      " c",
      "-d",
      "+D",
      " e",
      " f",
      " g",
    ]);
  });

  it("honors a custom context width", () => {
    const base = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
    const diff = buildRefineDiff(base, ["a", "b", "c", "D", "e", "f", "g"].join("\n"), 1);
    expect(diff.hunks[0]!.lines.map((line) => line.content)).toEqual([" c", "-d", "+D", " e"]);
  });
});

describe("countKeptChanges", () => {
  it("counts only the changes inside kept hunks", () => {
    const base = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].join("\n");
    const proposal = ["A", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "L"].join("\n");
    const diff = buildRefineDiff(base, proposal);
    expect(countKeptChanges(diff, new Set())).toEqual({ additions: 0, removals: 0 });
    expect(countKeptChanges(diff, new Set([diff.hunks[0]!.id]))).toEqual({
      additions: 1,
      removals: 1,
    });
    expect(countKeptChanges(diff, allHunkIds(diff))).toEqual({ additions: 2, removals: 2 });
  });
});

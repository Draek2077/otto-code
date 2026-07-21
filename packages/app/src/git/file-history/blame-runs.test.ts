import { describe, expect, it } from "vitest";
import { buildBlameRunFlags } from "./blame-runs";

function rows(...lines: (number | null)[]) {
  return lines.map((newLineNumber) => ({ newLineNumber }));
}

describe("buildBlameRunFlags", () => {
  it("annotates only the first line of a run", () => {
    const blame = new Map([
      [1, "aaa"],
      [2, "aaa"],
      [3, "aaa"],
      [4, "bbb"],
    ]);

    const flags = buildBlameRunFlags(rows(1, 2, 3, 4), (line) => blame.get(line));

    expect(flags).toEqual(["aaa", null, null, "bbb"]);
  });

  it("re-annotates when a commit reappears after another", () => {
    const blame = new Map([
      [1, "aaa"],
      [2, "bbb"],
      [3, "aaa"],
    ]);

    const flags = buildBlameRunFlags(rows(1, 2, 3), (line) => blame.get(line));

    expect(flags).toEqual(["aaa", "bbb", "aaa"]);
  });

  it("breaks a run across removed lines and hunk headers", () => {
    const blame = new Map([
      [1, "aaa"],
      [2, "aaa"],
    ]);

    // The null row is a removed line: it has no post-image position, so the run
    // must not read straight through it as if the lines were adjacent.
    const flags = buildBlameRunFlags(rows(1, null, 2), (line) => blame.get(line));

    expect(flags).toEqual(["aaa", null, "aaa"]);
  });

  it("leaves lines without blame unannotated", () => {
    const flags = buildBlameRunFlags(rows(1, 2), () => undefined);

    expect(flags).toEqual([null, null]);
  });
});

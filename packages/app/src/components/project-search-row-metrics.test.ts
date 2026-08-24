import { describe, expect, it } from "vitest";
import {
  buildSearchRowOffsets,
  estimateSearchRowHeight,
  type SearchRowGeometry,
} from "@/components/project-search-row-metrics";

const geometry: SearchRowGeometry = {
  fileRowHeight: 28,
  codeLineHeight: 18,
  chunkBorderWidth: 1,
};

function lines(count: number): readonly unknown[] {
  return Array.from({ length: count }, () => null);
}

describe("estimateSearchRowHeight", () => {
  it("gives every file row the measured header height", () => {
    expect(estimateSearchRowHeight({ kind: "file" }, geometry)).toBe(28);
  });

  it("sizes a chunk from its lines", () => {
    expect(
      estimateSearchRowHeight(
        { kind: "matches", lines: lines(16), isFirstChunk: false, isLastChunk: false },
        geometry,
      ),
    ).toBe(16 * 18);
  });

  it("adds the frame only to the chunks that draw it", () => {
    const first = estimateSearchRowHeight(
      { kind: "matches", lines: lines(4), isFirstChunk: true, isLastChunk: false },
      geometry,
    );
    const only = estimateSearchRowHeight(
      { kind: "matches", lines: lines(4), isFirstChunk: true, isLastChunk: true },
      geometry,
    );
    expect(first).toBe(4 * 18 + 1);
    expect(only).toBe(4 * 18 + 2);
  });

  it("treats a chunk with no lines as empty rather than as a file row", () => {
    expect(estimateSearchRowHeight({ kind: "matches" }, geometry)).toBe(0);
  });
});

describe("buildSearchRowOffsets", () => {
  it("returns the running offset of each row and the total", () => {
    expect(buildSearchRowOffsets([28, 72, 28])).toEqual([0, 28, 100, 128]);
  });

  it("returns a single zero for an empty list", () => {
    expect(buildSearchRowOffsets([])).toEqual([0]);
  });
});

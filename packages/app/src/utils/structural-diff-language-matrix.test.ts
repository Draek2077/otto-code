import { describe, expect, it } from "vitest";
import { getSupportedExtensions } from "@otto-code/highlight";
import { diffCode, getStructuralDiffAvailability, type StructuralDiffBlock } from "./diff-document";
import { evaluateStructuralSourcePair } from "./structural-diff-harness";
import { STRUCTURAL_DIFF_DEMO_SCENARIOS } from "./structural-diff-demo-scenarios";
import { STRUCTURAL_DIFF_LANGUAGE_FIXTURES } from "./structural-diff-language-matrix";
import type { DiffLine } from "./tool-call-parsers";

function blockLines(block: StructuralDiffBlock): readonly DiffLine[] {
  if (block.kind === "replacement" || block.kind === "formatting") {
    return [...block.before, ...block.after];
  }
  return block.lines;
}

function lineIdentity(line: DiffLine): string {
  return JSON.stringify({
    type: line.type,
    content: line.content,
    oldLineNumber: line.oldLineNumber,
    newLineNumber: line.newLineNumber,
  });
}

function restoreSource(lines: readonly DiffLine[], side: "before" | "after"): string {
  return lines
    .filter((line) => (side === "before" ? line.type !== "add" : line.type !== "remove"))
    .map(diffCode)
    .join("\n");
}

function withoutTerminalNewline(source: string): string {
  return source.endsWith("\n") ? source.slice(0, -1) : source;
}

describe("structural diff language matrix", () => {
  it("covers every extension exposed by the syntax parser registry", () => {
    const covered = STRUCTURAL_DIFF_LANGUAGE_FIXTURES.flatMap(
      (fixture) => fixture.extensions,
    ).sort();
    expect(covered).toEqual(getSupportedExtensions().sort());
  });

  for (const fixture of STRUCTURAL_DIFF_LANGUAGE_FIXTURES) {
    for (const extension of fixture.extensions) {
      it(`accepts a complete, valid ${extension} source pair`, () => {
        const filePath = `fixtures/${fixture.id}.${extension}`;
        const evaluation = evaluateStructuralSourcePair({
          before: fixture.before,
          after: fixture.after,
          filePath,
        });

        expect(evaluation.availability).toEqual({ available: true });
        expect(getStructuralDiffAvailability(evaluation.document)).toEqual({ available: true });
        // The line model intentionally keeps a terminal newline out of the
        // renderable row set, preventing a phantom numbered blank row.
        expect(restoreSource(evaluation.lineDiff, "before")).toBe(
          withoutTerminalNewline(fixture.before),
        );
        expect(restoreSource(evaluation.lineDiff, "after")).toBe(
          withoutTerminalNewline(fixture.after),
        );
        expect(evaluation.blocks.flatMap(blockLines).map(lineIdentity).sort()).toEqual(
          evaluation.lineDiff.map(lineIdentity).sort(),
        );
      });
    }
  }
});

describe("structural diff demo scenarios", () => {
  for (const scenario of STRUCTURAL_DIFF_DEMO_SCENARIOS) {
    it(`renders ${scenario.id} from a complete parser-safe source pair`, () => {
      const evaluation = evaluateStructuralSourcePair(scenario);

      expect(evaluation.availability).toEqual({ available: true });
      expect([...new Set(evaluation.blocks.map((block) => block.kind))].sort()).toEqual(
        [...scenario.expectedBlockKinds].sort(),
      );
      expect(evaluation.blocks.flatMap(blockLines).map(lineIdentity).sort()).toEqual(
        evaluation.lineDiff.map(lineIdentity).sort(),
      );
    });
  }
});

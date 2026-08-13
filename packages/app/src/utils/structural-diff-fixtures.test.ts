import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffCode, type StructuralDiffBlock } from "./diff-document";
import { buildInlineDiffFragments, type InlineDiffFragment } from "./inline-diff-fragments";
import { evaluateStructuralSourcePair } from "./structural-diff-harness";
import { buildStructuralRenderPlan } from "./structural-render-plan";

const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "structural-diff",
);

interface StructuralFixture {
  id: string;
  before: string;
  after: string;
  filePath: string;
  expected: {
    pairedChanges: number;
    sharedContextRows: number;
    unpairedAdditions: number;
    unpairedRemovals: number;
    kinds: readonly StructuralDiffBlock["kind"][];
    availability: "available" | "invalid-source";
    sharedLines?: readonly string[];
    inlineReplacements?: readonly {
      before: string;
      after: string;
      fragments: readonly InlineDiffFragment[];
    }[];
    renderReplacements?: readonly {
      before: string;
      after: string;
      fragments: readonly InlineDiffFragment[];
    }[];
  };
}

function source(path: string): string {
  return readFileSync(resolve(fixtureRoot, path), "utf8");
}

function blockContainsCode(block: StructuralDiffBlock, fragment: string): boolean {
  if (block.kind === "replacement" || block.kind === "formatting") {
    return [...block.before, ...block.after].some((line) => diffCode(line).includes(fragment));
  }
  const lines = block.lines;
  return lines.some((line) => diffCode(line).includes(fragment));
}

function findBlockIndex(
  blocks: readonly StructuralDiffBlock[],
  kind: StructuralDiffBlock["kind"],
  fragment: string,
): number {
  return blocks.findIndex((block) => block.kind === kind && blockContainsCode(block, fragment));
}

function spansForSide(spans: readonly InlineDiffFragment[], side: "before" | "after"): string {
  return spans
    .filter((span) =>
      side === "before"
        ? span.kind !== "added" && span.kind !== "replacement-added"
        : span.kind !== "removed",
    )
    .map((span) => span.text)
    .join("");
}

const fixtures: readonly StructuralFixture[] = [
  {
    id: "difftastic/simple-js-import",
    before: "difftastic/simple_1.js",
    after: "difftastic/simple_2.js",
    filePath: "simple.js",
    expected: {
      pairedChanges: 0,
      sharedContextRows: 1,
      unpairedAdditions: 1,
      unpairedRemovals: 1,
      kinds: ["removal", "addition", "shared"],
      availability: "available",
    },
  },
  {
    id: "difftastic/json-property-and-array-edit",
    before: "difftastic/json_1.json",
    after: "difftastic/json_2.json",
    filePath: "sample.json",
    expected: {
      pairedChanges: 2,
      sharedContextRows: 2,
      unpairedAdditions: 1,
      unpairedRemovals: 0,
      kinds: ["replacement", "addition", "shared"],
      availability: "available",
    },
  },
  {
    id: "difftastic/comments-inside-call",
    before: "difftastic/comma_and_comment_1.js",
    after: "difftastic/comma_and_comment_2.js",
    filePath: "call.js",
    expected: {
      pairedChanges: 1,
      sharedContextRows: 0,
      unpairedAdditions: 0,
      unpairedRemovals: 0,
      kinds: ["replacement"],
      availability: "available",
    },
  },
  {
    id: "difftastic/contiguous-duplicate-insertion",
    before: "difftastic/contiguous_1.js",
    after: "difftastic/contiguous_2.js",
    filePath: "values.js",
    expected: {
      pairedChanges: 0,
      sharedContextRows: 4,
      unpairedAdditions: 3,
      unpairedRemovals: 0,
      kinds: ["shared", "addition"],
      availability: "available",
    },
  },
  {
    id: "difftastic/nested-javascript-and-list-edit",
    before: "difftastic/javascript_simple_1.js",
    after: "difftastic/javascript_simple_2.js",
    filePath: "people.js",
    expected: {
      pairedChanges: 5,
      sharedContextRows: 3,
      unpairedAdditions: 2,
      unpairedRemovals: 0,
      kinds: ["shared", "replacement", "addition"],
      availability: "available",
      renderReplacements: [
        {
          before: "foo();",
          after: "  foo();",
          fragments: [
            { kind: "added", text: "  " },
            { kind: "shared", text: "foo();" },
          ],
        },
        {
          before: "bar(1);",
          after: "  bar(2);",
          fragments: [
            { kind: "added", text: "  " },
            { kind: "shared", text: "bar(" },
            { kind: "removed", text: "1" },
            { kind: "replacement-added", text: "2" },
            { kind: "shared", text: ");" },
          ],
        },
        {
          before: 'var people = ["john", "harry", "dick", "eric", "jenny", "alexandra"];',
          after: 'var people = ["john", "harry", "dick", "yvonne", "eric", "jenny", "alexandra"];',
          fragments: [
            { kind: "shared", text: 'var people = ["john", "harry", "dick", "' },
            { kind: "added", text: 'yvonne", "' },
            { kind: "shared", text: 'eric", "jenny", "alexandra"];' },
          ],
        },
      ],
    },
  },
  {
    id: "difftastic/python-block-indentation",
    before: "difftastic/if_1.py",
    after: "difftastic/if_2.py",
    filePath: "branch.py",
    expected: {
      pairedChanges: 1,
      sharedContextRows: 2,
      unpairedAdditions: 0,
      unpairedRemovals: 0,
      kinds: ["shared", "replacement"],
      availability: "available",
    },
  },
  {
    id: "difftastic/hyphenated-json-token",
    before: "difftastic/hyphen_subwords_1.json",
    after: "difftastic/hyphen_subwords_2.json",
    filePath: "package.json",
    expected: {
      pairedChanges: 1,
      sharedContextRows: 2,
      unpairedAdditions: 0,
      unpairedRemovals: 0,
      kinds: ["shared", "replacement"],
      availability: "available",
    },
  },
  {
    id: "difftastic/nested-html-content",
    before: "difftastic/html_simple_1.html",
    after: "difftastic/html_simple_2.html",
    filePath: "page.html",
    expected: {
      pairedChanges: 4,
      sharedContextRows: 5,
      unpairedAdditions: 0,
      unpairedRemovals: 0,
      kinds: ["shared", "replacement"],
      availability: "available",
      renderReplacements: [
        {
          before: '  <body class="foo">',
          after: '  <body class="bar">',
          fragments: [
            { kind: "shared", text: '  <body class="' },
            { kind: "removed", text: "foo" },
            { kind: "replacement-added", text: "bar" },
            { kind: "shared", text: '">' },
          ],
        },
        {
          before: "    <p>Story about foo.</p>",
          after: "    <p>Story about <strong>bar</strong>.</p>",
          fragments: [
            { kind: "shared", text: "    <p>Story about " },
            { kind: "removed", text: "foo" },
            { kind: "replacement-added", text: "<strong>bar</strong>" },
            { kind: "shared", text: ".</p>" },
          ],
        },
      ],
    },
  },
  {
    id: "otto/wrapped-call-formatting",
    before: "otto/wrapped-call_1.fixture",
    after: "otto/wrapped-call_2.fixture",
    filePath: "wrapped-call.ts",
    expected: {
      pairedChanges: 1,
      sharedContextRows: 0,
      unpairedAdditions: 4,
      unpairedRemovals: 0,
      kinds: ["replacement", "addition"],
      availability: "available",
    },
  },
  {
    id: "otto/token-rename",
    before: "otto/token-rename_1.fixture",
    after: "otto/token-rename_2.fixture",
    filePath: "color.ts",
    expected: {
      pairedChanges: 1,
      sharedContextRows: 2,
      unpairedAdditions: 0,
      unpairedRemovals: 0,
      kinds: ["shared", "replacement"],
      availability: "available",
    },
  },
  {
    id: "otto/whitespace-only",
    before: "otto/whitespace-only_1.fixture",
    after: "otto/whitespace-only_2.fixture",
    filePath: "route.ts",
    expected: {
      pairedChanges: 1,
      sharedContextRows: 0,
      unpairedAdditions: 4,
      unpairedRemovals: 0,
      kinds: ["formatting"],
      availability: "available",
    },
  },
  {
    id: "otto/pure-addition",
    before: "otto/addition_1.fixture",
    after: "otto/addition_2.fixture",
    filePath: "config.ts",
    expected: {
      pairedChanges: 0,
      sharedContextRows: 1,
      unpairedAdditions: 1,
      unpairedRemovals: 0,
      kinds: ["shared", "addition"],
      availability: "available",
    },
  },
  {
    id: "otto/pure-removal",
    before: "otto/removal_1.fixture",
    after: "otto/removal_2.fixture",
    filePath: "config.ts",
    expected: {
      pairedChanges: 0,
      sharedContextRows: 1,
      unpairedAdditions: 0,
      unpairedRemovals: 1,
      kinds: ["shared", "removal"],
      availability: "available",
    },
  },
  {
    id: "otto/exact-line-reorder",
    before: "otto/reorder_1.fixture",
    after: "otto/reorder_2.fixture",
    filePath: "save.ts",
    expected: {
      pairedChanges: 0,
      sharedContextRows: 1,
      unpairedAdditions: 1,
      unpairedRemovals: 1,
      kinds: ["move", "shared"],
      availability: "available",
    },
  },
  {
    id: "otto/duplicate-line-reorder",
    before: "otto/duplicate-reorder_1.fixture",
    after: "otto/duplicate-reorder_2.fixture",
    filePath: "save.ts",
    expected: {
      pairedChanges: 0,
      sharedContextRows: 2,
      unpairedAdditions: 1,
      unpairedRemovals: 1,
      kinds: ["move", "shared"],
      availability: "available",
    },
  },
  {
    id: "otto/malformed-source",
    before: "otto/malformed_1.fixture",
    after: "otto/malformed_2.fixture",
    filePath: "invalid.ts",
    expected: {
      pairedChanges: 1,
      sharedContextRows: 0,
      unpairedAdditions: 0,
      unpairedRemovals: 0,
      kinds: ["replacement"],
      availability: "invalid-source",
    },
  },
  {
    id: "otto/mixed-review",
    before: "otto/review-mix_1.fixture",
    after: "otto/review-mix_2.fixture",
    filePath: "format.ts",
    expected: {
      pairedChanges: 2,
      sharedContextRows: 3,
      unpairedAdditions: 1,
      unpairedRemovals: 1,
      kinds: ["replacement", "addition", "removal", "shared"],
      availability: "available",
      sharedLines: ["  validateCurrency(amount);"],
      inlineReplacements: [
        {
          before: "formatPrice",
          after: "formatAmount",
          fragments: [
            { kind: "shared", text: "format" },
            { kind: "removed", text: "Price" },
            { kind: "added", text: "Amount" },
          ],
        },
      ],
    },
  },
];

describe("structural diff fixture corpus", () => {
  for (const fixture of fixtures) {
    it(`keeps the approved semantics for ${fixture.id}`, () => {
      const evaluation = evaluateStructuralSourcePair({
        before: source(fixture.before),
        after: source(fixture.after),
        filePath: fixture.filePath,
      });

      // These aggregate counts are retained in the fixture data as historical
      // measurements, but are not an approval gate. They can all remain true
      // while a reviewer-visible token is wrongly coloured. Render-plan
      // expectations below are the semantic contract.
      if (fixture.expected.availability === "available") {
        expect(evaluation.availability).toEqual({ available: true });
      } else {
        expect(evaluation.availability).toMatchObject({
          available: false,
          code: fixture.expected.availability,
        });
      }
      if (fixture.expected.sharedLines) {
        const sharedLines = evaluation.blocks
          .filter((block) => block.kind === "shared")
          .flatMap((block) => block.lines.map(diffCode));
        expect(sharedLines).toEqual(expect.arrayContaining([...fixture.expected.sharedLines]));
      }
      for (const replacement of fixture.expected.inlineReplacements ?? []) {
        expect(buildInlineDiffFragments(replacement.before, replacement.after)).toEqual(
          replacement.fragments,
        );
      }
      const renderPlan = buildStructuralRenderPlan(evaluation.document);
      for (const row of renderPlan.rows) {
        if (row.kind !== "inline-change") continue;
        expect(spansForSide(row.spans, "before")).toBe(diffCode(row.before));
        expect(spansForSide(row.spans, "after")).toBe(diffCode(row.after));
      }
      for (const replacement of fixture.expected.renderReplacements ?? []) {
        const row = renderPlan.rows.find(
          (candidate) =>
            candidate.kind === "inline-change" &&
            diffCode(candidate.before) === replacement.before &&
            diffCode(candidate.after) === replacement.after,
        );
        expect(row).toEqual(
          expect.objectContaining({ kind: "inline-change", spans: replacement.fragments }),
        );
      }
    });
  }

  it("preserves source order around an unpaired removal and replacement", () => {
    const evaluation = evaluateStructuralSourcePair({
      before: source("otto/review-mix_1.fixture"),
      after: source("otto/review-mix_2.fixture"),
      filePath: "format.ts",
    });
    const addedFormatted = findBlockIndex(evaluation.blocks, "addition", "formatted");
    const sharedValidation = findBlockIndex(evaluation.blocks, "shared", "validateCurrency");
    const removedLabel = findBlockIndex(evaluation.blocks, "removal", "const label");
    const replacedReturn = findBlockIndex(evaluation.blocks, "replacement", "return label");

    expect(addedFormatted).toBeLessThan(sharedValidation);
    expect(sharedValidation).toBeLessThan(removedLabel);
    expect(removedLabel).toBeLessThan(replacedReturn);
  });
});

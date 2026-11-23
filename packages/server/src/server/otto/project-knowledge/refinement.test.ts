import { expect, it } from "vitest";
import { proposeKnowledgeBody, validateKnowledgeDirectives } from "./refinement.js";
import type { KnowledgeReviewDirective } from "@getpaseo/plugin/otto/project-knowledge";
import type { StructuredTextGeneration } from "../../session/checkout/git-metadata-generator.js";

const body = "# Article\n\nOld wording.\n\nPrivate unchanged truth.\n";
const note: KnowledgeReviewDirective = {
  id: "note",
  kind: "replace",
  start: 11,
  end: 22,
  selectedText: "Old wording",
  value: "Exact new wording",
};
it("bounds the combined instruction budget before any provider request", () => {
  expect(() => validateKnowledgeDirectives(body, [{ ...note, value: "x".repeat(16001) }])).toThrow(
    "16,000",
  );
});
function generation(
  response: unknown,
  onPrompt?: (prompt: string) => void,
): StructuredTextGeneration {
  return {
    generate: async (request) => {
      onPrompt?.(request.prompt);
      return request.schema.parse(response);
    },
  };
}
it("applies exact replacements without asking any provider and preserves all other bytes", async () => {
  expect(await proposeKnowledgeBody({ body, directives: [note], cwd: "fixture" })).toBe(
    body.replace("Old wording", "Exact new wording"),
  );
});
it("permits explicit removal but refuses an empty final article", async () => {
  expect(
    await proposeKnowledgeBody({ body, directives: [{ ...note, value: "" }], cwd: "fixture" }),
  ).toBe(body.replace("Old wording", ""));
  await expect(
    proposeKnowledgeBody({
      body: "x",
      directives: [{ ...note, start: 0, end: 1, selectedText: "x", value: "" }],
      cwd: "fixture",
    }),
  ).rejects.toThrow("empty");
});
it.each([
  { ...note, selectedText: "Wrong quote" },
  { ...note, start: -1 },
  { ...note, end: 999 },
  { ...note, start: 11.5 },
  { ...note, kind: "refine" as const, value: " " },
])("refuses stale or invalid scopes before generation: %j", (invalid) => {
  expect(() => validateKnowledgeDirectives(body, [invalid])).toThrow();
});
it("rejects overlapping selections and duplicate scope identities", () => {
  expect(() => validateKnowledgeDirectives(body, [note, { ...note, id: "other" }])).toThrow(
    "overlaps",
  );
  expect(() =>
    validateKnowledgeDirectives(body, [note, { ...note, start: 0, end: 1, selectedText: "#" }]),
  ).toThrow("ambiguous");
});
it("keeps direct replacements outside model authority and accepts only the exact scoped reply", async () => {
  const source = "Direct correction.\nModel sentence.\nSecret history is elsewhere.";
  const direct = {
    ...note,
    id: "direct",
    start: 0,
    end: 17,
    selectedText: "Direct correction",
    value: "Protected exact",
  };
  const refine = {
    ...note,
    id: "refine",
    kind: "refine" as const,
    start: 19,
    end: 33,
    selectedText: "Model sentence",
    value: "Make clearer",
  };
  const result = await proposeKnowledgeBody({
    body: source,
    directives: [refine, direct],
    cwd: "fixture",
    generation: generation(
      { replacements: [{ id: "refine", content: "Clear sentence" }] },
      (prompt) => {
        expect(prompt).not.toContain("Protected exact");
        expect(prompt).toContain("Make clearer");
      },
    ),
  });
  expect(result).toBe("Protected exact.\nClear sentence.\nSecret history is elsewhere.");
});
it.each([
  { replacements: [], message: "omitted" },
  { replacements: [{ id: "foreign", content: "Wrong" }], message: "unknown" },
  {
    replacements: [
      { id: "note", content: "one" },
      { id: "note", content: "two" },
    ],
    message: "duplicate",
  },
])(
  "refuses missing, unknown or duplicated model replacements: %j",
  async ({ replacements, message }) => {
    await expect(
      proposeKnowledgeBody({
        body,
        cwd: "fixture",
        directives: [{ ...note, kind: "refine" }],
        generation: generation({ replacements }),
      }),
    ).rejects.toThrow(message);
  },
);
it("does not pretend a failed provider produced a proposal", async () => {
  await expect(
    proposeKnowledgeBody({
      body,
      cwd: "fixture",
      directives: [{ ...note, kind: "refine" }],
      generation: {
        generate: async () => {
          throw new Error("provider unavailable");
        },
      },
    }),
  ).rejects.toThrow("provider unavailable");
});

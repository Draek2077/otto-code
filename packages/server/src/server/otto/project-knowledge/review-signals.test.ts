import { expect, it } from "vitest";
import { inspectReviewSignals, KnowledgeReviewUnavailableError } from "./review-signals.js";
import type { KnowledgePage } from "./markdown-page.js";

const now = new Date("2026-10-25T12:00:00.000Z");
function page(input: {
  id: string;
  tags?: string[];
  statement?: string;
  kind?: KnowledgePage["metadata"]["kind"];
  status?: KnowledgePage["metadata"]["status"];
  updatedAt?: string;
  timeline?: string;
}): KnowledgePage {
  return {
    metadata: {
      id: input.id,
      kind: input.kind ?? "requirement",
      title: input.id,
      status: input.status ?? "confirmed",
      tags: input.tags ?? [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: input.updatedAt ?? now.toISOString(),
    },
    statement: input.statement ?? "Unrelated",
    timeline: input.timeline ?? "",
    revision: "a".repeat(64),
  };
}
it("counts complete and partial unique tag sets separately, with no peer bodies or identities", () => {
  const source = page({ id: "source", tags: ["a", "b", "a", " "] });
  const pages = [
    source,
    page({ id: "same", tags: ["b", " a "] }),
    page({ id: "subset", tags: ["a"] }),
    page({ id: "superset", tags: ["a", "b", "c"] }),
    page({ id: "none", tags: ["z"] }),
  ];
  const before = JSON.stringify(pages);
  expect(inspectReviewSignals({ source, pages, now })).toEqual({
    sourceRevision: source.revision,
    checkedAt: now.toISOString(),
    eligible: true,
    comparedRecords: 4,
    identicalTagSets: 1,
    partialTagOverlap: 2,
    overlappingTruth: 0,
    stale: false,
    ageDays: 0,
  });
  expect(JSON.stringify(pages)).toBe(before);
});
it("counts distinct shared current-truth words once per peer, ignoring repetition and timeline history", () => {
  const source = page({
    id: "source",
    statement: "Retain canonical Markdown records",
    timeline: "unrelated historical evidence",
  });
  const pages = [
    source,
    page({ id: "match", statement: "MARKDOWN canonical retain retain" }),
    page({ id: "short", statement: "canonical Markdown" }),
    page({ id: "history", timeline: source.statement }),
    page({ id: "repeated", statement: "retain retain retain" }),
  ];
  expect(inspectReviewSignals({ source, pages, now })).toMatchObject({
    comparedRecords: 4,
    overlappingTruth: 1,
    identicalTagSets: 0,
    partialTagOverlap: 0,
  });
});
it.each(["proposed", "superseded"] as const)(
  "does not diagnose %s sources or count inactive peers",
  (status) => {
    const source = page({ id: "source", tags: ["same"], statement: "canonical records retained" });
    const inactive = page({
      id: "inactive",
      tags: ["same"],
      statement: source.statement,
      status,
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(inspectReviewSignals({ source, pages: [inactive], now })).toMatchObject({
      comparedRecords: 0,
      identicalTagSets: 0,
      overlappingTruth: 0,
    });
    expect(inspectReviewSignals({ source: inactive, pages: [source], now })).toMatchObject({
      eligible: false,
      comparedRecords: 0,
      stale: false,
    });
  },
);
it.each(["project", "reference"] as const)(
  "excludes broad %s overlap but still reports its stale timestamp",
  (kind) => {
    const source = page({ id: "source", tags: ["same"], statement: "canonical records retained" });
    const broad = page({
      id: "broad",
      kind,
      tags: ["same"],
      statement: source.statement,
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(inspectReviewSignals({ source, pages: [broad], now })).toMatchObject({
      comparedRecords: 0,
      identicalTagSets: 0,
      overlappingTruth: 0,
    });
    expect(inspectReviewSignals({ source: broad, pages: [source], now })).toMatchObject({
      eligible: true,
      comparedRecords: 0,
      stale: true,
    });
  },
);
it.each([
  { days: 180, stale: false, ageDays: 180 },
  { days: 181, stale: true, ageDays: 181 },
  { days: -1, stale: false, ageDays: 0 },
])("uses an explicit 180-day changed-date boundary ($days)", ({ days, stale, ageDays }) => {
  const source = page({
    id: "source",
    updatedAt: new Date(now.getTime() - days * 86400000).toISOString(),
  });
  expect(inspectReviewSignals({ source, pages: [], now })).toMatchObject({ stale, ageDays });
});
it("uses kind and id for source identity", () => {
  const source = page({ id: "same-id", tags: ["same"] });
  expect(
    inspectReviewSignals({
      source,
      pages: [source, page({ id: "same-id", kind: "finding", tags: ["same"] })],
      now,
    }),
  ).toMatchObject({ comparedRecords: 1, identicalTagSets: 1 });
});
it("refuses oversized records and peer counts instead of returning a misleading healthy result", () => {
  const source = page({ id: "source" });
  const many = Array.from({ length: 2001 }, (_, index) => page({ id: `peer-${index}` }));
  expect(() => inspectReviewSignals({ source, pages: many, now })).toThrow(
    KnowledgeReviewUnavailableError,
  );
  expect(() =>
    inspectReviewSignals({ source: { ...source, statement: "x".repeat(524289) }, pages: [], now }),
  ).toThrow(KnowledgeReviewUnavailableError);
  const large = Array.from({ length: 33 }, (_, index) =>
    page({ id: `peer-${index}`, statement: "x".repeat(524288) }),
  );
  expect(() => inspectReviewSignals({ source, pages: large, now })).toThrow(
    KnowledgeReviewUnavailableError,
  );
});

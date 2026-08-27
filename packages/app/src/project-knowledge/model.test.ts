import { describe, expect, it } from "vitest";
import {
  formatDeliveryStatus,
  formatMetadataLabel,
  isolateKnowledgeTypeFilter,
  KNOWLEDGE_ARTICLE_KINDS,
  recordMatchesKnowledgeTypes,
  recordMatchesTags,
  summarizeProjectKnowledge,
  toggleKnowledgeTypeFilter,
  uniqueTags,
} from "./model";

describe("project knowledge summary", () => {
  it("formats stored metadata for people without changing its value", () => {
    expect(formatMetadataLabel("in_build")).toBe("In Build");
    expect(formatMetadataLabel("requirement")).toBe("Requirement");
    expect(formatDeliveryStatus(undefined)).toBe("Charter");
  });

  it("keeps charter counts separate from weighted completion metrics", () => {
    const records = [
      {
        id: "one",
        kind: "project" as const,
        title: "One",
        statement: "One",
        tags: [],
        status: "confirmed" as const,
        deliveryStatus: "complete" as const,
        progress: { completed: 2, total: 2, unit: "milestones" },
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
      },
      {
        id: "two",
        kind: "project" as const,
        title: "Two",
        statement: "Two",
        tags: [],
        status: "confirmed" as const,
        deliveryStatus: "partial" as const,
        progress: { completed: 3, total: 8, unit: "milestones" },
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
      },
      {
        id: "reference",
        kind: "reference" as const,
        title: "Reference",
        statement: "Reference",
        tags: [],
        status: "confirmed" as const,
        referenceDisposition: "adopted" as const,
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
      },
    ];

    expect(summarizeProjectKnowledge(records)).toMatchObject({
      projects: 2,
      projectsComplete: 1,
      projectsInFlight: 1,
      measuredCompleted: 5,
      measuredTotal: 10,
      measuredPercentage: 50,
      references: 1,
      referencesAdopted: 1,
    });
  });
});

describe("tag filtering", () => {
  it("matches every selected tag and passes everything through with no selection", () => {
    const record = { tags: ["protocol", "compatibility", "ui"] };
    expect(recordMatchesTags(record, [])).toBe(true);
    expect(recordMatchesTags(record, ["protocol"])).toBe(true);
    expect(recordMatchesTags(record, ["protocol", "ui"])).toBe(true);
    expect(recordMatchesTags(record, ["protocol", "missing"])).toBe(false);
    expect(recordMatchesTags({ tags: [] }, ["protocol"])).toBe(false);
  });

  it("collects unique tags from records in stable case-insensitive order", () => {
    const tags = uniqueTags([
      { tags: ["ui", "protocol"] },
      { tags: ["UI", "knowledge"] },
      { tags: [] },
    ]);
    expect(tags).toEqual(["knowledge", "protocol", "ui"]);
  });
});

describe("knowledge type filtering", () => {
  it("matches any selected article type", () => {
    expect(recordMatchesKnowledgeTypes({ kind: "architecture" }, ["architecture"])).toBe(true);
    expect(recordMatchesKnowledgeTypes({ kind: "finding" }, ["architecture"])).toBe(false);
  });

  it("restores All types when the final individual type is cleared", () => {
    expect(toggleKnowledgeTypeFilter(["finding"], "finding")).toEqual(KNOWLEDGE_ARTICLE_KINDS);
    expect(toggleKnowledgeTypeFilter(["finding"], "all")).toEqual(KNOWLEDGE_ARTICLE_KINDS);
  });

  it("can isolate one type without clearing every other type individually", () => {
    expect(isolateKnowledgeTypeFilter("requirement")).toEqual(["requirement"]);
  });
});

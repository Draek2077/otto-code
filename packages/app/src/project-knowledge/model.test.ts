import { describe, expect, it } from "vitest";
import { summarizeProjectKnowledge } from "./model";

describe("project knowledge summary", () => {
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

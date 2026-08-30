import { describe, expect, test } from "vitest";
import { ArtifactMetadataSchema, StoredArtifactSchema } from "./types.js";

function legacyArtifact() {
  return {
    id: "artifact-1",
    name: "Release report",
    description: "A report",
    projectId: "/project",
    filePath: "/project/.otto/artifacts/artifact-1.html",
    kind: "html",
    starred: false,
    status: "ready",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T01:00:00.000Z",
    generationAgentId: null,
    generationProvider: "mock",
    generationModel: null,
    errorMessage: null,
  };
}

describe("Artifact metadata compatibility", () => {
  test("parses a record written before storage, repair, and provenance metadata", () => {
    const parsed = ArtifactMetadataSchema.parse(legacyArtifact());

    expect(parsed.storageLocation).toBeUndefined();
    expect(parsed.repairAvailable).toBeUndefined();
    expect(parsed.source).toBeUndefined();
    expect(parsed.generationModeId).toBeUndefined();
    expect(parsed.generationThinkingOptionId).toBeUndefined();
  });

  test.each([
    { kind: "chat", agentId: "agent-1" },
    { kind: "schedule", scheduleId: "schedule-1", runId: "run-1" },
    { kind: "workflow", workflowId: "workflow-1", runId: "run-1" },
  ] as const)("parses additive %s source provenance", (source) => {
    const parsed = ArtifactMetadataSchema.parse({
      ...legacyArtifact(),
      storageLocation: "host",
      repairAvailable: true,
      source,
    });

    expect(parsed.storageLocation).toBe("host");
    expect(parsed.repairAvailable).toBe(true);
    expect(parsed.source).toEqual(source);
  });

  test("keeps old stored records readable while defaulting absent run history", () => {
    const parsed = StoredArtifactSchema.parse(legacyArtifact());

    expect(parsed.runs).toEqual([]);
  });
});

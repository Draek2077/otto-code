import { describe, expect, test } from "vitest";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { toArtifactRow } from "./ls.js";

function artifact(overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
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
    ...overrides,
  };
}

describe("Artifact CLI list rows", () => {
  test("discloses host storage and scheduled provenance without leaking file paths", () => {
    expect(
      toArtifactRow(
        artifact({
          storageLocation: "host",
          source: { kind: "schedule", scheduleId: "schedule-1", runId: "run-1" },
        }),
      ),
    ).toMatchObject({
      id: "artifact-1",
      project: "/project",
      stored: "This host",
      source: "Schedule",
      status: "ready",
    });
  });

  test("discloses legacy records without inventing a source or ownership", () => {
    expect(toArtifactRow(artifact())).toMatchObject({ stored: "Legacy", source: "-" });
  });
});

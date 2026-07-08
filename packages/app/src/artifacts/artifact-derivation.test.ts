import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { describe, expect, it } from "vitest";
import { filterByProject, sortArtifacts } from "./artifact-derivation";

function makeArtifact(overrides: Partial<ArtifactMetadata>): ArtifactMetadata {
  return {
    id: "aaaa",
    name: "Test Artifact",
    description: "A test artifact",
    projectId: "project-1",
    filePath: "artifacts/aaaa/index.html",
    kind: "html",
    starred: false,
    status: "ready",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    generationAgentId: null,
    generationProvider: null,
    generationModel: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("sortArtifacts", () => {
  it("places starred artifacts before unstarred ones", () => {
    const unstarred = makeArtifact({ id: "unstarred", updatedAt: "2026-07-02T00:00:00.000Z" });
    const starred = makeArtifact({
      id: "starred",
      starred: true,
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const result = sortArtifacts([unstarred, starred]);
    expect(result[0].id).toBe("starred");
    expect(result[1].id).toBe("unstarred");
  });

  it("orders by updatedAt descending within the same star group", () => {
    const older = makeArtifact({ id: "older", updatedAt: "2026-07-01T00:00:00.000Z" });
    const newer = makeArtifact({ id: "newer", updatedAt: "2026-07-02T00:00:00.000Z" });
    const result = sortArtifacts([older, newer]);
    expect(result[0].id).toBe("newer");
    expect(result[1].id).toBe("older");
  });

  it("does not mutate the input array", () => {
    const artifacts = [
      makeArtifact({ id: "b", updatedAt: "2026-07-02T00:00:00.000Z" }),
      makeArtifact({ id: "a", updatedAt: "2026-07-01T00:00:00.000Z" }),
    ];
    sortArtifacts(artifacts);
    expect(artifacts[0].id).toBe("b");
  });

  it("sorts starred first then by updatedAt, and unstarred by updatedAt", () => {
    const result = sortArtifacts([
      makeArtifact({ id: "unstarred-old", updatedAt: "2026-07-03T00:00:00.000Z" }),
      makeArtifact({ id: "starred-old", starred: true, updatedAt: "2026-07-01T00:00:00.000Z" }),
      makeArtifact({ id: "starred-new", starred: true, updatedAt: "2026-07-02T00:00:00.000Z" }),
      makeArtifact({ id: "unstarred-new", updatedAt: "2026-07-04T00:00:00.000Z" }),
    ]);
    expect(result.map((a) => a.id)).toEqual([
      "starred-new",
      "starred-old",
      "unstarred-new",
      "unstarred-old",
    ]);
  });
});

describe("filterByProject", () => {
  it("returns all artifacts when projectId is undefined", () => {
    const artifacts = [
      makeArtifact({ id: "a", projectId: "project-1" }),
      makeArtifact({ id: "b", projectId: "project-2" }),
    ];
    const result = filterByProject(artifacts);
    expect(result.length).toBe(2);
  });

  it("filters to matching project", () => {
    const artifacts = [
      makeArtifact({ id: "a", projectId: "project-1" }),
      makeArtifact({ id: "b", projectId: "project-2" }),
      makeArtifact({ id: "c", projectId: "project-1" }),
    ];
    const result = filterByProject(artifacts, "project-1");
    expect(result.map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("returns an empty array when no artifacts match", () => {
    const artifacts = [makeArtifact({ id: "a", projectId: "project-1" })];
    const result = filterByProject(artifacts, "project-99");
    expect(result).toEqual([]);
  });
});

import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { describe, expect, it } from "vitest";
import {
  artifactBelongsToProject,
  artifactMatchesWorkspace,
  filterByProject,
  sortArtifacts,
} from "./artifact-derivation";

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

  it("orders alphabetically by name within the same star group", () => {
    const zed = makeArtifact({ id: "zed", name: "Zed Artifact" });
    const apple = makeArtifact({ id: "apple", name: "Apple Artifact" });
    const result = sortArtifacts([zed, apple]);
    expect(result[0].id).toBe("apple");
    expect(result[1].id).toBe("zed");
  });

  it("sorts case-insensitively", () => {
    const upper = makeArtifact({ id: "upper", name: "banana" });
    const lower = makeArtifact({ id: "lower", name: "Apple" });
    const result = sortArtifacts([upper, lower]);
    expect(result[0].id).toBe("lower");
    expect(result[1].id).toBe("upper");
  });

  it("does not mutate the input array", () => {
    const artifacts = [
      makeArtifact({ id: "b", name: "Bravo" }),
      makeArtifact({ id: "a", name: "Alpha" }),
    ];
    sortArtifacts(artifacts);
    expect(artifacts[0].id).toBe("b");
  });

  it("keeps unstarring an artifact from pinning it via a fresher updatedAt", () => {
    // Regression: the store bumps updatedAt on every change, including the
    // star toggle itself. Sorting by updatedAt made an unstarred artifact
    // (just touched) look stuck at the top of the unstarred group even
    // though older, alphabetically-earlier artifacts should lead.
    const justUnstarred = makeArtifact({
      id: "just-unstarred",
      name: "Zed Artifact",
      updatedAt: "2026-07-04T00:00:00.000Z",
    });
    const untouched = makeArtifact({
      id: "untouched",
      name: "Apple Artifact",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const result = sortArtifacts([justUnstarred, untouched]);
    expect(result.map((a) => a.id)).toEqual(["untouched", "just-unstarred"]);
  });

  it("sorts starred first then alphabetically, and unstarred alphabetically", () => {
    const result = sortArtifacts([
      makeArtifact({ id: "unstarred-z", name: "Zulu" }),
      makeArtifact({ id: "starred-b", starred: true, name: "Bravo" }),
      makeArtifact({ id: "starred-a", starred: true, name: "Alpha" }),
      makeArtifact({ id: "unstarred-a", name: "Alpha" }),
    ]);
    expect(result.map((a) => a.id)).toEqual([
      "starred-a",
      "starred-b",
      "unstarred-a",
      "unstarred-z",
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

describe("artifactBelongsToProject", () => {
  it("matches a remote-key grouping id exactly", () => {
    expect(
      artifactBelongsToProject("remote:github.com/owner/repo", "remote:github.com/owner/repo"),
    ).toBe(true);
  });

  it("does not treat a grouping id as a path — no prefix matching", () => {
    // The regression this guards: artifact.projectId and workspace.projectId
    // are opaque grouping keys (often a remote key, not a path), so a worktree
    // whose projectId happens to be a path-shaped prefix of another must not
    // match unless the ids are exactly equal.
    expect(artifactBelongsToProject("/repo", "/repo/worktree")).toBe(false);
  });

  it("rejects a mismatched project id", () => {
    expect(
      artifactBelongsToProject("remote:github.com/owner/repo", "remote:github.com/owner/other"),
    ).toBe(false);
  });

  it("rejects when either side is missing", () => {
    expect(artifactBelongsToProject("remote:github.com/owner/repo", null)).toBe(false);
    expect(artifactBelongsToProject("", "remote:github.com/owner/repo")).toBe(false);
  });
});

describe("artifactMatchesWorkspace", () => {
  it("matches a path-shaped projectId against the workspace cwd (repo root vs worktree)", () => {
    expect(
      artifactMatchesWorkspace({
        artifactProjectId: "C:\\Users\\dev\\repo",
        workspaceCwd: "C:/Users/dev/repo/.otto/worktrees/feature",
        workspaceProjectId: "remote:github.com/owner/repo",
      }),
    ).toBe(true);
  });

  it("matches a legacy grouping-key projectId against the workspace project id", () => {
    // COMPAT(artifactGroupingKeyProjectId): artifacts created by the
    // create_artifact tool before the rootPath fix stored the opaque grouping
    // key; those persisted values must keep matching their workspace.
    expect(
      artifactMatchesWorkspace({
        artifactProjectId: "remote:github.com/owner/repo",
        workspaceCwd: "C:/Users/dev/repo",
        workspaceProjectId: "remote:github.com/owner/repo",
      }),
    ).toBe(true);
  });

  it("rejects an artifact from another project on both keys", () => {
    expect(
      artifactMatchesWorkspace({
        artifactProjectId: "/other/repo",
        workspaceCwd: "/dev/repo",
        workspaceProjectId: "remote:github.com/owner/repo",
      }),
    ).toBe(false);
  });
});

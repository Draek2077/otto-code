import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { describe, expect, test, vi } from "vitest";

const { artifactRegenerate, close, connectArtifactClient } = vi.hoisted(() => ({
  artifactRegenerate: vi.fn(),
  close: vi.fn(async () => {}),
  connectArtifactClient: vi.fn(),
}));

vi.mock("./shared.js", () => ({
  connectArtifactClient,
  toArtifactCommandError: (code: string, action: string, error: unknown) => ({
    code,
    message: `Failed to ${action}: ${String(error)}`,
  }),
}));

import { runRegenerateCommand, toRegeneratedArtifactResult } from "./regenerate.js";

function artifact(overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return {
    id: "artifact-1",
    name: "Release report",
    description: "A report",
    projectId: "/project",
    filePath: "/project/.otto/artifacts/artifact-1.html",
    kind: "html",
    starred: false,
    status: "generating",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T01:00:00.000Z",
    generationAgentId: "agent-1",
    generationProvider: "mock",
    generationModel: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("Artifact CLI regeneration result", () => {
  test("reports queued regeneration state without exposing the artifact file path", () => {
    expect(toRegeneratedArtifactResult(artifact())).toEqual({
      id: "artifact-1",
      status: "generating",
      updatedAt: "2026-08-29T01:00:00.000Z",
    });
  });

  test("delegates only the artifact identity to the daemon regeneration operation", async () => {
    connectArtifactClient.mockResolvedValueOnce({ artifactRegenerate, close });
    artifactRegenerate.mockResolvedValueOnce({ artifact: artifact(), success: true });

    await expect(
      runRegenerateCommand("artifact-1", { host: "daemon.example" }, {} as never),
    ).resolves.toMatchObject({ data: { id: "artifact-1", status: "generating" } });

    expect(connectArtifactClient).toHaveBeenCalledWith("daemon.example", "artifacts");
    expect(artifactRegenerate).toHaveBeenCalledWith({ artifactId: "artifact-1" });
    expect(close).toHaveBeenCalledOnce();
  });
});

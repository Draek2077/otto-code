import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { describe, expect, test, vi } from "vitest";

const { artifactRepair, close, connectArtifactClient } = vi.hoisted(() => ({
  artifactRepair: vi.fn(),
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

import { runRepairCommand, toRepairedArtifactResult } from "./repair.js";

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
    repairAvailable: false,
    errorMessage: null,
    ...overrides,
  };
}

describe("Artifact CLI repair result", () => {
  test("reports only repair state, without exposing the artifact file path", () => {
    expect(toRepairedArtifactResult(artifact())).toEqual({
      id: "artifact-1",
      status: "ready",
      updatedAt: "2026-08-29T01:00:00.000Z",
      repairAvailable: false,
    });
  });

  test("delegates to the daemon repair operation and closes the client", async () => {
    connectArtifactClient.mockResolvedValueOnce({ artifactRepair, close });
    artifactRepair.mockResolvedValueOnce({ artifact: artifact(), success: true });

    await expect(
      runRepairCommand("artifact-1", { host: "daemon.example" }, {} as never),
    ).resolves.toMatchObject({ data: { id: "artifact-1", status: "ready" } });

    expect(connectArtifactClient).toHaveBeenCalledWith("daemon.example", "repair");
    expect(artifactRepair).toHaveBeenCalledWith({ artifactId: "artifact-1" });
    expect(close).toHaveBeenCalledOnce();
  });
});

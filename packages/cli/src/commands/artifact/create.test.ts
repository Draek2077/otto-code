import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { artifactCreate, close, connectArtifactClient } = vi.hoisted(() => ({
  artifactCreate: vi.fn(),
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

import { runCreateCommand } from "./create.js";

function artifact(): ArtifactMetadata {
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
    generationAgentId: null,
    generationProvider: "mock",
    generationModel: null,
    storageLocation: "repository",
    errorMessage: null,
  };
}

describe("Artifact CLI creation", () => {
  beforeEach(() => vi.clearAllMocks());

  test("delegates a fully explicit generation request to the daemon", async () => {
    connectArtifactClient.mockResolvedValueOnce({ artifactCreate, close });
    artifactCreate.mockResolvedValueOnce({ artifact: artifact(), success: true });

    await expect(
      runCreateCommand(
        "Release report",
        {
          host: "daemon.example",
          project: " /project ",
          provider: " mock ",
          description: " Create a release report ",
          model: " model-1 ",
          thinking: " high ",
        },
        {} as never,
      ),
    ).resolves.toMatchObject({
      data: { id: "artifact-1", status: "generating", storageLocation: "repository" },
    });

    expect(connectArtifactClient).toHaveBeenCalledWith("daemon.example", "artifacts");
    expect(artifactCreate).toHaveBeenCalledWith({
      name: "Release report",
      description: "Create a release report",
      projectId: "/project",
      provider: "mock",
      model: "model-1",
      thinkingOptionId: "high",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  test("rejects incomplete creation arguments before connecting", async () => {
    await expect(
      runCreateCommand("Report", { project: "/project", provider: "mock" }, {} as never),
    ).rejects.toMatchObject({
      code: "MISSING_ARTIFACT_CREATE_OPTION",
      message: "--description is required.",
    });
    expect(connectArtifactClient).not.toHaveBeenCalled();
  });
});

import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { describe, expect, test, vi } from "vitest";

const { artifactCancel, close, connectArtifactClient } = vi.hoisted(() => ({
  artifactCancel: vi.fn(),
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

import { runCancelCommand, toCancelledArtifactResult } from "./cancel.js";

function artifact(overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return {
    id: "artifact-1",
    name: "Release report",
    description: "A report",
    projectId: "/project",
    filePath: "/project/.otto/artifacts/artifact-1.html",
    kind: "html",
    starred: false,
    status: "error",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T01:00:00.000Z",
    generationAgentId: null,
    generationProvider: "mock",
    generationModel: null,
    errorMessage: "Artifact generation cancelled",
    ...overrides,
  };
}

describe("Artifact CLI cancellation result", () => {
  test("reports the recoverable error state without exposing the artifact file path", () => {
    expect(toCancelledArtifactResult(artifact())).toEqual({
      id: "artifact-1",
      status: "error",
      updatedAt: "2026-08-29T01:00:00.000Z",
      error: "Artifact generation cancelled",
    });
  });

  test("delegates to the daemon cancellation operation and closes the client", async () => {
    connectArtifactClient.mockResolvedValueOnce({ artifactCancel, close });
    artifactCancel.mockResolvedValueOnce({ artifact: artifact(), success: true });

    await expect(
      runCancelCommand("artifact-1", { host: "daemon.example" }, {} as never),
    ).resolves.toMatchObject({ data: { id: "artifact-1", status: "error" } });

    expect(connectArtifactClient).toHaveBeenCalledWith("daemon.example", "artifacts");
    expect(artifactCancel).toHaveBeenCalledWith({ artifactId: "artifact-1" });
    expect(close).toHaveBeenCalledOnce();
  });
});

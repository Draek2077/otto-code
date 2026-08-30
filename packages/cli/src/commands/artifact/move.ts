import type { Command } from "commander";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import {
  connectArtifactClient,
  toArtifactCommandError,
  type ArtifactCommandOptions,
} from "./shared.js";

interface MoveArtifactOptions extends ArtifactCommandOptions {
  to?: string;
}

interface MoveArtifactResult {
  id: string;
  storageLocation: "repository" | "host" | null;
  status: string;
  updatedAt: string;
}

const moveArtifactSchema: OutputSchema<MoveArtifactResult> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 12 },
    { header: "STORED", field: "storageLocation", width: 14 },
    { header: "STATUS", field: "status", width: 12 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
};

export async function runMoveCommand(
  id: string,
  options: MoveArtifactOptions,
  _command: Command,
): Promise<SingleResult<MoveArtifactResult>> {
  if (options.to !== "repository" && options.to !== "host") {
    throw {
      code: "INVALID_ARTIFACT_STORAGE_LOCATION",
      message: "--to must be repository or host.",
    };
  }

  const client = await connectArtifactClient(options.host, "move");
  try {
    const payload = await client.artifactMoveStore({ artifactId: id, destination: options.to });
    if (!payload.success) throw new Error(payload.error ?? "Artifact move failed");
    return {
      type: "single",
      data: {
        id: payload.artifact.id,
        storageLocation: payload.artifact.storageLocation ?? null,
        status: payload.artifact.status,
        updatedAt: payload.artifact.updatedAt,
      },
      schema: moveArtifactSchema,
    };
  } catch (error) {
    throw toArtifactCommandError("ARTIFACT_MOVE_FAILED", "move artifact", error);
  } finally {
    await client.close().catch(() => {});
  }
}

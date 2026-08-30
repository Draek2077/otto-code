import type { Command } from "commander";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import {
  connectArtifactClient,
  toArtifactCommandError,
  type ArtifactCommandOptions,
} from "./shared.js";

interface UpdateDataOptions extends ArtifactCommandOptions {
  data?: unknown;
}

const artifactDataUpdateSchema: OutputSchema<{ id: string; status: string; updatedAt: string }> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 12 },
    { header: "STATUS", field: "status", width: 12 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
};

export async function runUpdateDataCommand(
  id: string,
  options: UpdateDataOptions,
  _command: Command,
): Promise<SingleResult<{ id: string; status: string; updatedAt: string }>> {
  let data: unknown;
  try {
    if (typeof options.data !== "string") {
      throw new Error("--data JSON is required");
    }
    data = JSON.parse(options.data) as unknown;
  } catch (error) {
    throw toArtifactCommandError("INVALID_ARTIFACT_DATA", "parse --data JSON", error);
  }

  const client = await connectArtifactClient(options.host, "data");
  try {
    const payload = await client.artifactUpdateData({ artifactId: id, data });
    if (!payload.success) throw new Error(payload.error ?? "Artifact data update failed");
    return {
      type: "single",
      data: {
        id: payload.artifact.id,
        status: payload.artifact.status,
        updatedAt: payload.artifact.updatedAt,
      },
      schema: artifactDataUpdateSchema,
    };
  } catch (error) {
    throw toArtifactCommandError("ARTIFACT_DATA_UPDATE_FAILED", "update artifact data", error);
  } finally {
    await client.close().catch(() => {});
  }
}

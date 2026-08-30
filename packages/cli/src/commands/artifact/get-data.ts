import type { Command } from "commander";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import {
  connectArtifactClient,
  toArtifactCommandError,
  type ArtifactCommandOptions,
} from "./shared.js";

const artifactDataSchema: OutputSchema<unknown> = {
  idField: () => "",
  columns: [{ header: "DATA", field: (data) => JSON.stringify(data) }],
};

export async function runGetDataCommand(
  id: string,
  options: ArtifactCommandOptions,
  _command: Command,
): Promise<SingleResult<unknown>> {
  const client = await connectArtifactClient(options.host, "data");
  try {
    const payload = await client.artifactGetData({ artifactId: id });
    if (!payload.success) throw new Error(payload.error ?? "Artifact data is unavailable");
    if (payload.data === null) {
      throw new Error("Artifact has no explicit data contract; regenerate it to add one");
    }
    return { type: "single", data: payload.data, schema: artifactDataSchema };
  } catch (error) {
    throw toArtifactCommandError("ARTIFACT_DATA_GET_FAILED", "read artifact data", error);
  } finally {
    await client.close().catch(() => {});
  }
}

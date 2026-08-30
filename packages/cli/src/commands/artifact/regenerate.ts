import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import type { Command } from "commander";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import {
  connectArtifactClient,
  toArtifactCommandError,
  type ArtifactCommandOptions,
} from "./shared.js";

export interface RegeneratedArtifactResult {
  id: string;
  status: string;
  updatedAt: string;
}

const regeneratedArtifactSchema: OutputSchema<RegeneratedArtifactResult> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 16 },
    { header: "STATUS", field: "status", width: 12 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
};

export function toRegeneratedArtifactResult(artifact: ArtifactMetadata): RegeneratedArtifactResult {
  return { id: artifact.id, status: artifact.status, updatedAt: artifact.updatedAt };
}

export async function runRegenerateCommand(
  id: string,
  options: ArtifactCommandOptions,
  _command: Command,
): Promise<SingleResult<RegeneratedArtifactResult>> {
  const client = await connectArtifactClient(options.host, "artifacts");
  try {
    const payload = await client.artifactRegenerate({ artifactId: id });
    if (!payload.success) throw new Error(payload.error ?? "Artifact regeneration failed");
    return {
      type: "single",
      data: toRegeneratedArtifactResult(payload.artifact),
      schema: regeneratedArtifactSchema,
    };
  } catch (error) {
    throw toArtifactCommandError("ARTIFACT_REGENERATE_FAILED", "regenerate artifact", error);
  } finally {
    await client.close().catch(() => {});
  }
}

import type { Command } from "commander";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import {
  connectArtifactClient,
  toArtifactCommandError,
  type ArtifactCommandOptions,
} from "./shared.js";

export interface RepairedArtifactResult {
  id: string;
  status: string;
  updatedAt: string;
  repairAvailable: boolean;
}

const repairedArtifactSchema: OutputSchema<RepairedArtifactResult> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 16 },
    { header: "STATUS", field: "status", width: 12 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
    { header: "REPAIR AVAILABLE", field: "repairAvailable", width: 18 },
  ],
};

export function toRepairedArtifactResult(artifact: ArtifactMetadata): RepairedArtifactResult {
  return {
    id: artifact.id,
    status: artifact.status,
    updatedAt: artifact.updatedAt,
    repairAvailable: artifact.repairAvailable ?? false,
  };
}

export async function runRepairCommand(
  id: string,
  options: ArtifactCommandOptions,
  _command: Command,
): Promise<SingleResult<RepairedArtifactResult>> {
  const client = await connectArtifactClient(options.host, "repair");
  try {
    const payload = await client.artifactRepair({ artifactId: id });
    if (!payload.success) throw new Error(payload.error ?? "Artifact repair failed");
    return {
      type: "single",
      data: toRepairedArtifactResult(payload.artifact),
      schema: repairedArtifactSchema,
    };
  } catch (error) {
    throw toArtifactCommandError("ARTIFACT_REPAIR_FAILED", "repair artifact", error);
  } finally {
    await client.close().catch(() => {});
  }
}

import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import type { Command } from "commander";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import {
  connectArtifactClient,
  toArtifactCommandError,
  type ArtifactCommandOptions,
} from "./shared.js";

export interface CancelledArtifactResult {
  id: string;
  status: string;
  updatedAt: string;
  error: string | null;
}

const cancelledArtifactSchema: OutputSchema<CancelledArtifactResult> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 16 },
    { header: "STATUS", field: "status", width: 12 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
    { header: "RECOVERY", field: "error", width: 36 },
  ],
};

export function toCancelledArtifactResult(artifact: ArtifactMetadata): CancelledArtifactResult {
  return {
    id: artifact.id,
    status: artifact.status,
    updatedAt: artifact.updatedAt,
    error: artifact.errorMessage,
  };
}

export async function runCancelCommand(
  id: string,
  options: ArtifactCommandOptions,
  _command: Command,
): Promise<SingleResult<CancelledArtifactResult>> {
  const client = await connectArtifactClient(options.host, "artifacts");
  try {
    const payload = await client.artifactCancel({ artifactId: id });
    if (!payload.success) throw new Error(payload.error ?? "Artifact cancellation failed");
    return {
      type: "single",
      data: toCancelledArtifactResult(payload.artifact),
      schema: cancelledArtifactSchema,
    };
  } catch (error) {
    throw toArtifactCommandError("ARTIFACT_CANCEL_FAILED", "cancel artifact generation", error);
  } finally {
    await client.close().catch(() => {});
  }
}

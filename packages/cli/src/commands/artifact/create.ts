import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import type { Command } from "commander";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import {
  connectArtifactClient,
  toArtifactCommandError,
  type ArtifactCommandOptions,
} from "./shared.js";

interface CreateArtifactOptions extends ArtifactCommandOptions {
  project?: string;
  provider?: string;
  description?: string;
  model?: string;
  thinking?: string;
}

interface CreatedArtifactResult {
  id: string;
  status: string;
  storageLocation: "repository" | "host" | null;
  updatedAt: string;
}

const createdArtifactSchema: OutputSchema<CreatedArtifactResult> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 16 },
    { header: "STATUS", field: "status", width: 12 },
    { header: "STORED", field: "storageLocation", width: 14 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
};

function requiredOption(value: string | undefined, option: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw { code: "MISSING_ARTIFACT_CREATE_OPTION", message: `${option} is required.` };
  }
  return trimmed;
}

export function toCreatedArtifactResult(artifact: ArtifactMetadata): CreatedArtifactResult {
  return {
    id: artifact.id,
    status: artifact.status,
    storageLocation: artifact.storageLocation ?? null,
    updatedAt: artifact.updatedAt,
  };
}

export async function runCreateCommand(
  name: string,
  options: CreateArtifactOptions,
  _command: Command,
): Promise<SingleResult<CreatedArtifactResult>> {
  const projectId = requiredOption(options.project, "--project");
  const provider = requiredOption(options.provider, "--provider");
  const description = requiredOption(options.description, "--description");
  const artifactName = requiredOption(name, "Artifact name");
  const client = await connectArtifactClient(options.host, "artifacts");
  try {
    const payload = await client.artifactCreate({
      name: artifactName,
      description,
      projectId,
      provider,
      ...(options.model?.trim() ? { model: options.model.trim() } : {}),
      ...(options.thinking?.trim() ? { thinkingOptionId: options.thinking.trim() } : {}),
    });
    if (!payload.success) throw new Error(payload.error ?? "Artifact creation failed");
    return {
      type: "single",
      data: toCreatedArtifactResult(payload.artifact),
      schema: createdArtifactSchema,
    };
  } catch (error) {
    throw toArtifactCommandError("ARTIFACT_CREATE_FAILED", "create artifact", error);
  } finally {
    await client.close().catch(() => {});
  }
}

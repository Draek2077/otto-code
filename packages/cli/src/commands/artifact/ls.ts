import path from "node:path";
import type { Command } from "commander";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import type { CommandError, ListResult, OutputSchema } from "../../output/index.js";
import {
  connectArtifactClient,
  toArtifactCommandError,
  type ArtifactCommandOptions,
} from "./shared.js";

interface ArtifactListOptions extends ArtifactCommandOptions {
  project?: string;
}

export interface ArtifactRow {
  id: string;
  name: string;
  project: string;
  stored: string;
  source: string;
  status: string;
  updatedAt: string;
}

const artifactListSchema: OutputSchema<ArtifactRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 16 },
    { header: "NAME", field: "name", width: 28 },
    { header: "PROJECT", field: "project", width: 28 },
    { header: "STORED", field: "stored", width: 14 },
    { header: "SOURCE", field: "source", width: 12 },
    { header: "STATUS", field: "status", width: 12 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
};

function storageLabel(location: ArtifactMetadata["storageLocation"]): string {
  switch (location) {
    case "repository":
      return "Repository";
    case "host":
      return "This host";
    default:
      return "Legacy";
  }
}

function sourceLabel(source: ArtifactMetadata["source"]): string {
  if (!source) return "-";
  switch (source.kind) {
    case "chat":
      return "Chat";
    case "schedule":
      return "Schedule";
    case "workflow":
      return "Workflow";
  }
}

export function toArtifactRow(artifact: ArtifactMetadata): ArtifactRow {
  return {
    id: artifact.id,
    name: artifact.name,
    project: artifact.projectId,
    stored: storageLabel(artifact.storageLocation),
    source: sourceLabel(artifact.source),
    status: artifact.status,
    updatedAt: artifact.updatedAt,
  };
}

export async function runArtifactListCommand(
  options: ArtifactListOptions,
  _command: Command,
): Promise<ListResult<ArtifactRow>> {
  // The daemon filters by project root path, not registry id. A registry id
  // would be resolved as a relative path under the daemon's cwd and silently
  // match nothing, so refuse anything that is not an absolute path up front.
  if (options.project !== undefined && !path.isAbsolute(options.project)) {
    throw {
      code: "ARTIFACT_PROJECT_INVALID",
      message: `--project must be an absolute project root path, received ${JSON.stringify(options.project)}`,
    } satisfies CommandError;
  }
  const client = await connectArtifactClient(options.host, "artifacts");
  try {
    const payload = await client.artifactList(
      options.project === undefined ? undefined : { projectId: options.project },
    );
    if (!payload.success) throw new Error(payload.error ?? "Artifact list is unavailable");
    return { type: "list", data: payload.artifacts.map(toArtifactRow), schema: artifactListSchema };
  } catch (error) {
    throw toArtifactCommandError("ARTIFACT_LIST_FAILED", "list artifacts", error);
  } finally {
    await client.close().catch(() => {});
  }
}

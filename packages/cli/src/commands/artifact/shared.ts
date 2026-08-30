import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, CommandOptions } from "../../output/index.js";

export interface ArtifactCommandOptions extends CommandOptions {
  host?: string;
}

type ArtifactCommandCapability = "artifacts" | "data" | "move" | "repair";

function supportsArtifactCapability(
  capability: ArtifactCommandCapability,
  features:
    | {
        artifacts?: boolean;
        artifactDataUpdate?: boolean;
        artifactStoreMove?: boolean;
        artifactRepair?: boolean;
      }
    | undefined,
): boolean | undefined {
  switch (capability) {
    case "artifacts":
      return features?.artifacts;
    case "data":
      return features?.artifactDataUpdate;
    case "move":
      return features?.artifactStoreMove;
    case "repair":
      return features?.artifactRepair;
  }
}

function artifactCapabilityUpgradeMessage(capability: ArtifactCommandCapability): string {
  switch (capability) {
    case "artifacts":
      return "Update the host to list artifacts.";
    case "data":
      return "Update the host to read or update artifact data.";
    case "move":
      return "Update the host to move artifacts between storage locations.";
    case "repair":
      return "Update the host to repair artifact output.";
  }
}

export async function connectArtifactClient(
  host?: string,
  capability: ArtifactCommandCapability = "data",
): Promise<DaemonClient> {
  const daemonHost = getDaemonHost({ host });
  try {
    const client = await connectToDaemon({ host });
    const supportsCapability = supportsArtifactCapability(
      capability,
      client.getLastServerInfoMessage()?.features,
    );
    // COMPAT(artifactDataUpdate): added in v0.9.0, remove after 2027-02-28.
    // COMPAT(artifactStoreMove): added in v0.9.0, remove after 2027-02-28.
    // COMPAT(artifactRepair): added in v0.9.0, remove after 2027-02-28.
    if (!supportsCapability) {
      await client.close().catch(() => {});
      throw {
        code: "DAEMON_UPDATE_REQUIRED",
        message: artifactCapabilityUpgradeMessage(capability),
      } satisfies CommandError;
    }
    return client;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && "message" in error) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${daemonHost}: ${message}`,
      details: "Start the daemon with: otto daemon start",
    } satisfies CommandError;
  }
}

export function toArtifactCommandError(code: string, action: string, error: unknown): CommandError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return error as CommandError;
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code, message: `Failed to ${action}: ${message}` };
}

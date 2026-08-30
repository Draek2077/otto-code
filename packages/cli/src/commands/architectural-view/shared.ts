import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, CommandOptions } from "../../output/index.js";

export interface ArchitecturalViewCommandOptions extends CommandOptions {
  host?: string;
}

export async function connectArchitecturalViewsClient(host?: string): Promise<DaemonClient> {
  const daemonHost = getDaemonHost({ host });
  try {
    const client = await connectToDaemon({ host });
    // COMPAT(architecturalViews): added in v0.9.0, remove after 2027-02-28.
    if (!client.getLastServerInfoMessage()?.features?.architecturalViews) {
      await client.close().catch(() => {});
      throw {
        code: "DAEMON_UPDATE_REQUIRED",
        message: "Update the host to use Architectural Views.",
      } satisfies CommandError;
    }
    return client;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && "message" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${daemonHost}: ${message}`,
      details: "Start the daemon with: otto daemon start",
    } satisfies CommandError;
  }
}

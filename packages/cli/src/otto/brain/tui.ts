/** Node terminal composition over the daemon's existing encrypted RPC and status lease. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BrainStatusStore } from "@getpaseo/brain/host";
import {
  BrainTuiClient,
  BrainTuiSnapshotSchema,
  BrainTuiJobsSchema,
  BrainTuiResourcesSchema,
  BrainTuiLiveSchema,
  BrainTuiExecutionSchema,
  runUiCommand,
  TuiActionError,
} from "@getpaseo/brain/tui";
import { BrainBootstrapSchema, BrainStatusSchema } from "@getpaseo/protocol/otto/brain";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { BrainCliError, decodeBrainEnvelope } from "./rpc.js";
import { BrainOwnerRpc, type BrainRpcClient } from "./owner-rpc.js";
export type BrainTuiDaemonClient = BrainRpcClient;

export async function openDaemonBrainTui(client: BrainTuiDaemonClient): Promise<BrainTuiClient> {
  // COMPAT(ottoBrainTui): added in v0.10.0; remove after 2027-04-24 when floor >= v0.10.0.
  if (client.getLastServerInfoMessage()?.features?.ottoBrainTui !== true)
    throw new BrainCliError(
      "DAEMON_UPDATE_REQUIRED",
      "Update the host to use the Brain terminal UI.",
    );
  let bootstrap = BrainBootstrapSchema.parse(
    decodeBrainEnvelope(await client.invokePluginRpc("otto-brain", "brain.bootstrap", {})),
  );
  if (!bootstrap.connection.config.enabled)
    throw new TuiActionError(
      "failed",
      "Enable Brain in this Otto host's settings before opening its terminal UI.",
    );
  const rpc = new BrainOwnerRpc(client, bootstrap.connection.revision);
  if (bootstrap.connection.config.mode === "local" && !bootstrap.localRunning) {
    await rpc.invoke(
      "brain.tui.start",
      { connectionRevision: bootstrap.connection.revision },
      z.object({ accepted: z.literal(true) }),
    );
    bootstrap = await rpc.invoke("brain.bootstrap", {}, BrainBootstrapSchema);
    if (bootstrap.connection.revision !== rpc.connectionRevision)
      throw new TuiActionError(
        "conflict",
        "The Brain connection changed. Reopen the terminal on the intended owner.",
      );
  }
  const status = await rpc.invoke("brain.query", { resource: "status" }, BrainStatusSchema);
  if (status.capabilities.tui !== true)
    throw new TuiActionError("unsupported", "Update the Brain owner to use its terminal UI.");
  const lifetime = new AbortController();
  const initial = await rpc.read("snapshot", lifetime.signal, BrainTuiSnapshotSchema);
  const feed = new BrainStatusStore(rpc.statusSource(BrainTuiLiveSchema), {
    streamId: randomUUID(),
  });
  return new BrainTuiClient(initial, {
    status: feed,
    endpoint: bootstrap.endpoint,
    readSnapshot: (signal) => rpc.read("snapshot", signal, BrainTuiSnapshotSchema),
    readJobs: (signal) => rpc.read("jobs", signal, BrainTuiJobsSchema),
    readResources: (signal) => rpc.read("resources", signal, BrainTuiResourcesSchema),
    execute: async (action, instanceId, signal) => {
      signal.throwIfAborted();
      return rpc.invoke(
        "brain.tui.action",
        { action, instanceId, connectionRevision: bootstrap.connection.revision },
        BrainTuiExecutionSchema,
      );
    },
  });
}

export async function runDaemonBrainTui(target: DaemonTarget): Promise<void> {
  let client: DaemonClient | undefined;
  let viewer: BrainTuiClient | undefined;
  try {
    // runUiCommand validates both TTY streams before this factory can connect or start an owner.
    await runUiCommand(async () => {
      try {
        client = await connectToDaemon({ target });
      } catch (cause) {
        throw new BrainCliError("BRAIN_UNAVAILABLE", "The selected Otto daemon is unavailable.", {
          cause,
        });
      }
      viewer = await openDaemonBrainTui(client);
      return viewer;
    });
  } finally {
    await viewer?.close();
    await client?.close().catch(() => undefined);
  }
}

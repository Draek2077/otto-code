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
  type BrainTuiLive,
} from "@getpaseo/brain/tui";
import {
  BrainBootstrapSchema,
  BrainStatusSchema,
  BrainStatusReadSchema,
} from "@getpaseo/protocol/otto/brain";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { BrainCliError, decodeBrainEnvelope } from "./rpc.js";

interface Decoder<T> {
  parse(value: unknown): T;
}
export interface BrainTuiDaemonClient {
  getLastServerInfoMessage(): { features?: { ottoBrain?: boolean; ottoBrainTui?: boolean } } | null;
  invokePluginRpc: DaemonClient["invokePluginRpc"];
}
class TuiRpc {
  constructor(
    private readonly client: BrainTuiDaemonClient,
    readonly connectionRevision: string,
  ) {}
  async invoke<T>(method: string, input: unknown, schema: Decoder<T>): Promise<T> {
    try {
      return schema.parse(
        decodeBrainEnvelope(await this.client.invokePluginRpc("otto-brain", method, input)),
      );
    } catch (error) {
      if (error instanceof BrainCliError)
        throw new TuiActionError(
          error.code === "BRAIN_CONFLICT" ? "conflict" : "failed",
          error.message,
        );
      throw new TuiActionError(
        "failed",
        "The Brain request could not be confirmed. Read its current state before retrying.",
      );
    }
  }
  async read<T>(
    resource: "snapshot" | "jobs" | "resources",
    signal: AbortSignal,
    schema: Decoder<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    const requestId = randomUUID();
    const release = () => {
      void this.invoke(
        "brain.resources.release",
        { requestId },
        z.object({ released: z.boolean() }),
      ).catch(() => {});
    };
    signal.addEventListener("abort", release, { once: true });
    try {
      return await this.invoke(
        "brain.tui.read",
        { resource, requestId, connectionRevision: this.connectionRevision },
        schema,
      );
    } finally {
      signal.removeEventListener("abort", release);
    }
  }
  statusSource() {
    return {
      open: async (
        receive: {
          status(value: BrainTuiLive): void;
          log(record: { instanceId: string; index: number; line: string }): void;
        },
        signal: AbortSignal,
      ): Promise<void> => {
        signal.throwIfAborted();
        const leaseId = randomUUID();
        let released: Promise<unknown> | null = null;
        const release = () => {
          return (released ??= this.invoke(
            "brain.status.release",
            { leaseId },
            z.object({ released: z.boolean() }),
          ).catch(() => undefined));
        };
        const abort = () => {
          void release();
        };
        signal.addEventListener("abort", abort, { once: true });
        let previous: z.infer<typeof BrainStatusReadSchema> | null = null;
        try {
          while (!signal.aborted) {
            const feed: z.infer<typeof BrainStatusReadSchema> = await this.invoke(
              "brain.status.wait",
              {
                leaseId,
                cursor: previous?.cursor ?? null,
                includeLogs: true,
                afterLogIndex: previous?.nextLogIndex ?? null,
                instanceId: previous?.status?.instanceId ?? null,
              },
              BrainStatusReadSchema,
            );
            if (signal.aborted) return;
            if (feed.controlRevision !== this.connectionRevision)
              throw new TuiActionError(
                "conflict",
                "The Brain connection changed. Reopen the terminal on the intended owner.",
              );
            if (feed.connection === "disconnected")
              throw new TuiActionError("failed", "The selected Brain owner disconnected.");
            if (feed.status) {
              receive.status(BrainTuiLiveSchema.parse(feed.status));
              for (const log of feed.logs)
                receive.log({ ...log, instanceId: feed.status.instanceId });
            }
            previous = feed;
          }
        } finally {
          signal.removeEventListener("abort", abort);
          await release();
        }
      },
    };
  }
}

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
  const rpc = new TuiRpc(client, bootstrap.connection.revision);
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
  const feed = new BrainStatusStore(rpc.statusSource(), { streamId: randomUUID() });
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

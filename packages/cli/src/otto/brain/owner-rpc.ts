/** One encrypted owner RPC/feed binding shared by interactive and ordinary Brain commands. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BrainStatusReadSchema } from "@getpaseo/protocol/otto/brain";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { TuiActionError } from "@getpaseo/brain/tui";
import type { BrainHostEvent, BrainCommandRequest } from "@getpaseo/brain/cli-target";
import type { BrainStatusSource } from "@getpaseo/brain/host";
import { BrainCliError, decodeBrainEnvelope } from "./rpc.js";

interface Decoder<T> {
  parse(value: unknown): T;
}
function emitFrame(
  feed: z.infer<typeof BrainStatusReadSchema>,
  receive: (event: BrainHostEvent) => void,
  signal: AbortSignal,
): void {
  if (!feed.status) return;
  receive({ event: "status", data: feed.status });
  for (const log of feed.logs) {
    if (signal.aborted) return;
    receive({ event: "log", data: { ...log, instanceId: feed.status.instanceId } });
  }
}
export interface BrainRpcClient {
  getLastServerInfoMessage(): {
    features?: {
      ottoBrain?: boolean;
      ottoBrainTui?: boolean;
      ottoBrainCommands?: boolean;
      ottoBrainSharing?: boolean;
    };
  } | null;
  invokePluginRpc: DaemonClient["invokePluginRpc"];
}
export class BrainOwnerRpc {
  constructor(
    private readonly client: BrainRpcClient,
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
  private async abortable<T>(
    method: string,
    input: Record<string, unknown>,
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
      const value = await this.invoke(
        method,
        { ...input, requestId, connectionRevision: this.connectionRevision },
        schema,
      );
      signal.throwIfAborted();
      return value;
    } finally {
      signal.removeEventListener("abort", release);
    }
  }
  read<T>(
    resource: "snapshot" | "jobs" | "resources",
    signal: AbortSignal,
    schema: Decoder<T>,
  ): Promise<T> {
    return this.abortable("brain.tui.read", { resource }, signal, schema);
  }
  command(request: BrainCommandRequest, instanceId: string, signal: AbortSignal): Promise<unknown> {
    return this.abortable("brain.cli.request", { request, instanceId }, signal, z.unknown());
  }
  async events(
    receive: (event: BrainHostEvent) => void,
    signal: AbortSignal,
    includeLogs = false,
  ): Promise<void> {
    signal.throwIfAborted();
    const leaseId = randomUUID();
    let released: Promise<unknown> | null = null;
    const release = () =>
      (released ??= this.invoke(
        "brain.status.release",
        { leaseId },
        z.object({ released: z.boolean() }),
      ).catch(() => undefined));
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
            includeLogs,
            afterLogIndex: previous?.nextLogIndex ?? null,
            instanceId: previous?.status?.instanceId ?? null,
          },
          BrainStatusReadSchema,
        );
        if (signal.aborted) return;
        if (feed.controlRevision !== this.connectionRevision)
          throw new TuiActionError(
            "conflict",
            "The Brain connection changed. Reopen the command on the intended owner.",
          );
        if (feed.connection === "disconnected")
          throw new TuiActionError("failed", "The selected Brain owner disconnected.");
        emitFrame(feed, receive, signal);
        previous = feed;
      }
    } finally {
      signal.removeEventListener("abort", abort);
      await release();
    }
  }
  statusSource<T>(schema: Decoder<T>): BrainStatusSource<T> {
    return {
      open: (receive, signal) =>
        this.events(
          (event) => {
            if (event.event === "status") receive.status(schema.parse(event.data));
            else
              receive.log(
                z
                  .object({ instanceId: z.string(), index: z.number(), line: z.string() })
                  .parse(event.data),
              );
          },
          signal,
          true,
        ),
    };
  }
}

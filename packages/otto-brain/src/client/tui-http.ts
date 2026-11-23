/** Node-only HTTP composition. The terminal never constructs an engine or owns a model process. */
import { randomUUID } from "node:crypto";
import { z } from "zod/v3";
import { BrainStatusStore } from "./status-store.js";
import { brainStatusSource } from "./status-source.js";
import { BrainTuiClient } from "../tui/client.js";
import {
  BrainTuiSnapshotSchema,
  BrainTuiJobsSchema,
  BrainTuiResourcesSchema,
} from "../tui/contracts.js";
import { BrainTuiLiveSchema } from "../tui/live.js";
import { performTuiAction } from "../tui/actions.js";
import { TuiActionError } from "../tui/host.js";
import type { BrainControllerTransport } from "../controller/controller.js";
import { BrainHttpResponseError } from "../service/host-http-client.js";
import { readPidFile, isProcessAlive } from "../service/pid-lock.js";
import { localBrainClient } from "../service/local-client.js";
import { startLocalBrain } from "../service/lifecycle.js";
import { readBrainConfig } from "../config/store.js";

export async function openBrainHttpTui(
  client: () => BrainControllerTransport,
  endpoint: string | null,
): Promise<BrainTuiClient> {
  const capabilities = z
    .object({ tui: z.literal(true) })
    .safeParse(await client().request("/__host/capabilities"));
  if (!capabilities.success)
    throw new TuiActionError(
      "unsupported",
      "Update the Brain owner to use its interactive terminal UI.",
    );
  const initial = BrainTuiSnapshotSchema.parse(await client().request("/__host/tui"));
  const status = new BrainStatusStore(
    brainStatusSource(
      {
        events: (receive, signal) => client().events(receive, signal),
      },
      (value) => BrainTuiLiveSchema.parse(value),
    ),
    { streamId: randomUUID() },
  );
  return new BrainTuiClient(initial, {
    endpoint,
    status,
    readSnapshot: async (signal) =>
      BrainTuiSnapshotSchema.parse(await client().request("/__host/tui", undefined, signal)),
    readResources: async (signal) =>
      BrainTuiResourcesSchema.parse(
        await client().request("/__host/tui/resources", undefined, signal),
      ),
    readJobs: async (signal) =>
      BrainTuiJobsSchema.parse(await client().request("/__host/tui/jobs", undefined, signal)),
    execute: async (action, instanceId, signal) => {
      // Capture one transport before checking identity, so a local PID replacement
      // cannot redirect the subsequent mutation to a different service lifetime.
      const owner = client();
      const current = z
        .object({ instanceId: z.string() })
        .parse(await owner.request("/__host/status", undefined, signal));
      if (current.instanceId !== instanceId)
        throw new TuiActionError(
          "conflict",
          "The Brain owner restarted. Reload before another operation.",
        );
      try {
        return await performTuiAction(action, (route, body) =>
          owner.request(route, body, signal, instanceId),
        );
      } catch (error) {
        if (error instanceof BrainHttpResponseError && error.status === 409)
          throw new TuiActionError(
            "conflict",
            "Brain state changed. Reload before submitting another operation.",
          );
        throw error;
      }
    },
  });
}

/** An explicit standalone UI invocation may start its detached, unloaded owner.
 * The UI's close() only releases reads/feed; that owner and its jobs remain. */
export async function openLocalBrainTui(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BrainTuiClient> {
  const current = readPidFile(env);
  if (!current || !isProcessAlive(current.pid)) await startLocalBrain({ env });
  const record = readPidFile(env);
  if (!record || !isProcessAlive(record.pid))
    throw new TuiActionError(
      "failed",
      "The Brain management host is not ready. Inspect its host log.",
    );
  const client = () => {
    const owner = readPidFile(env);
    if (!owner || !isProcessAlive(owner.pid))
      throw new TuiActionError("failed", "The local Brain owner is unavailable.");
    return localBrainClient({ record: owner, env, config: readBrainConfig(env) });
  };
  const host = record.displayHost ?? record.host;
  const endpoint = `${record.secure ? "https" : "http"}://${host.includes(":") ? `[${host}]` : host}:${record.port}`;
  return openBrainHttpTui(client, endpoint);
}

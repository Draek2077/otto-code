/** A restart is one explicit request bound to the selected remote owner's lifetime. */
import { z } from "zod/v3";
import { BrainConnectionError } from "./connection-store.js";
import type { BrainControllerTransport } from "./controller.js";

const Capabilities = z.object({ restart: z.boolean(), writable: z.boolean() });
const Status = z.object({ instanceId: z.string().min(1).max(1024) });
const Accepted = z.object({ accepted: z.literal(true), instanceId: z.string() });
export async function restartRemoteBrain(
  client: BrainControllerTransport,
  modelId: string | null,
  signal: AbortSignal,
): Promise<void> {
  const capabilities = Capabilities.safeParse(
    await client.request("/__host/capabilities", undefined, signal),
  );
  if (!capabilities.success || !capabilities.data.restart)
    throw new BrainConnectionError(
      "validation",
      "Update the Remote Brain owner to support explicit restart",
    );
  if (!capabilities.data.writable)
    throw new BrainConnectionError(
      "validation",
      "Allow remote configuration on the Brain owner before restarting it",
    );
  const status = Status.safeParse(await client.request("/__host/status", undefined, signal));
  if (!status.success)
    throw new BrainConnectionError(
      "unknown",
      "The Remote Brain owner could not be identified. Refresh before restarting it.",
    );
  signal.throwIfAborted();
  const result = Accepted.safeParse(
    await client.request(
      "/__host/restart",
      { instanceId: status.data.instanceId, modelId },
      signal,
    ),
  );
  if (!result.success || result.data.instanceId !== status.data.instanceId)
    throw new BrainConnectionError(
      "unknown",
      "The Remote Brain restart could not be confirmed. Check its current state before retrying.",
    );
}

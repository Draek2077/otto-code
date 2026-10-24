/** Brain CLI traffic uses the selected Otto daemon's encrypted plugin channel. */
import { z } from "zod";
import { BrainOperationResultSchema } from "@getpaseo/protocol/otto/brain";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";

export interface BrainCliClient {
  getLastServerInfoMessage(): { features?: { ottoBrain?: boolean } } | null;
  invokePluginRpc(pluginId: string, method: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}
export interface BrainCliRequest {
  method: string;
  input: unknown;
  output: z.ZodType;
}
export class BrainCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const FAILURES = {
  validation: "The Brain host rejected this request. Check its fields before submitting again.",
  conflict: "Brain settings changed. Read the current revision before submitting again.",
  unavailable: "The selected Brain owner is unavailable. Check its connection and access key.",
  unknown: "The Brain operation could not be confirmed. Read its current state before retrying.",
};

export async function runBrainRequest(
  target: DaemonTarget,
  request: BrainCliRequest,
  connect: (target: DaemonTarget) => Promise<BrainCliClient> = (selected) =>
    connectToDaemon({ target: selected }),
): Promise<unknown> {
  // Neither connection failures nor remote bodies may reflect saved access keys.
  let client: BrainCliClient;
  try {
    client = await connect(target);
  } catch (cause) {
    throw new BrainCliError("BRAIN_UNAVAILABLE", FAILURES.unavailable, { cause });
  }
  try {
    // COMPAT(ottoBrainCli): added in v0.10.0; remove after 2027-04-24 when floor >= v0.10.0.
    if (client.getLastServerInfoMessage()?.features?.ottoBrain !== true)
      throw new BrainCliError("DAEMON_UPDATE_REQUIRED", "Update the host to use Otto Brain.");
    const raw = await client.invokePluginRpc("otto-brain", request.method, request.input);
    const result = BrainOperationResultSchema.safeParse(raw);
    if (!result.success)
      throw new BrainCliError("BRAIN_RESPONSE_INVALID", "Update the host to read its Brain data.");
    if (!result.data.ok)
      throw new BrainCliError(
        `BRAIN_${result.data.error.kind.toUpperCase()}`,
        FAILURES[result.data.error.kind],
      );
    const parsed = request.output.safeParse(result.data.value);
    if (!parsed.success)
      throw new BrainCliError("BRAIN_RESPONSE_INVALID", "Update the host to read its Brain data.");
    return parsed.data;
  } catch (error) {
    if (error instanceof BrainCliError) throw error;
    throw new BrainCliError("BRAIN_UNCONFIRMED", FAILURES.unknown, { cause: error });
  } finally {
    await client.close().catch(() => undefined);
  }
}

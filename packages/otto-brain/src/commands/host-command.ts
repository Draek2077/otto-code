/** Explicit CLI demand on the same host transport used by management clients. */
import { CommandError } from "../output/types.js";
import {
  followBrainJob,
  localJobTransport,
  type BrainJobTransport,
  type BrainJobStatus,
} from "../service/job-client.js";
import { localBrainRequest } from "../service/local-client.js";
import { withOperationHost } from "./operation-host.js";

export interface HostCommandPort extends BrainJobTransport {
  request(route: string, signal: AbortSignal, body?: unknown): Promise<unknown>;
}
export async function waitForCommandJob(port: HostCommandPort, id: string, signal: AbortSignal) {
  let job: BrainJobStatus;
  try {
    job = await followBrainJob(port, id, signal, commandJobProgress());
  } catch (error) {
    // A dropped feed does not cancel durable host work; an explicit interruption does.
    if (!signal.aborted) throw error;
    await port.request("/__host/jobs/cancel", AbortSignal.timeout(5000), { id });
    throw new CommandError({
      code: "CANCELED",
      message: "Brain operation cancellation requested.",
    });
  }
  if (job.state !== "completed")
    throw new CommandError({
      code: job.state === "canceled" ? "CANCELED" : "OPERATION_FAILED",
      message:
        job.state === "canceled"
          ? "Brain operation was canceled."
          : "Brain operation failed. Check the host logs.",
    });
  return job;
}

/** Render only recognized measured fields; host exception text is never terminal output. */
export function commandJobProgress(
  write: (line: string) => void = (line) => process.stderr.write(line),
) {
  let previous = "";
  return (job: BrainJobStatus): void => {
    const event = job.progress;
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    const phases = new Set([
      "skip",
      "loading",
      "measured",
      "failed",
      "generating",
      "done",
      "downloading",
      "extracting",
      "start",
    ]);
    if (!("phase" in event) || typeof event.phase !== "string" || !phases.has(event.phase)) return;
    const fields = [event.phase];
    for (const [key, label] of [
      ["contextSize", "context"],
      ["budget", "budget"],
      ["deltaBytes", "bytes"],
      ["receivedBytes", "received"],
      ["totalBytes", "total"],
      ["tokensPerSecond", "tok/s"],
    ]) {
      if (!(key in event)) continue;
      const value = Reflect.get(event, key);
      if (typeof value === "number" && Number.isFinite(value))
        fields.push(`${label}=${Number(value.toFixed(1))}`);
    }
    const line = `  ${fields.join(" ")}\n`;
    if (line !== previous) write(line);
    previous = line;
  };
}
export async function withCommandHost<T>(
  run: (port: HostCommandPort, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Brain command interrupted"));
  process.once("SIGINT", interrupt);
  try {
    return await withOperationHost((client) => {
      // COMPAT(brainHostJobs): added in v0.10.0, remove after 2027-04-23.
      if (!client.record.instanceId)
        throw new CommandError({
          code: "UPDATE_HOST",
          message: "Update the Brain host to use management commands.",
        });
      return run(
        {
          ...localJobTransport(client),
          request: (route, signal, body) => localBrainRequest(client, route, body, signal),
        },
        controller.signal,
      );
    });
  } finally {
    process.off("SIGINT", interrupt);
  }
}

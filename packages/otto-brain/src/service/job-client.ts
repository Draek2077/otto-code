/** Wait on the existing host event source, never a per-command polling loop. */
import { z } from "zod/v3";
import type { BrainHostEvent } from "./event-decoder.js";
import {
  localBrainEvents,
  localBrainRequest,
  type LocalBrainClientOptions,
} from "./local-client.js";
import type { BrainJobState } from "./jobs.js";

const JobStatusSchema = z.object({
  job: z
    .object({
      id: z.string(),
      state: z.enum(["queued", "running", "completed", "failed", "canceled"]),
      progress: z.unknown(),
      result: z.unknown(),
      error: z.string().nullable(),
    })
    .passthrough(),
});
export type BrainJobStatus = z.infer<typeof JobStatusSchema>["job"];
const TERMINAL = new Set<BrainJobState>(["completed", "failed", "canceled"]);

export interface BrainJobTransport {
  instanceId: string;
  request(route: string, signal: AbortSignal): Promise<unknown>;
  events(receive: (event: BrainHostEvent) => void, signal: AbortSignal): Promise<void>;
}

export function localJobTransport(options: LocalBrainClientOptions): BrainJobTransport {
  if (!options.record.instanceId) throw new Error("Update the Brain host to track jobs safely");
  return {
    instanceId: options.record.instanceId,
    request: (route, signal) => localBrainRequest(options, route, undefined, signal),
    events: (receive, signal) => localBrainEvents(options, receive, signal),
  };
}

export async function followBrainJob(
  transport: BrainJobTransport,
  id: string,
  signal: AbortSignal,
  receive: (job: BrainJobStatus) => void = () => {},
): Promise<BrainJobStatus> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const lifetime = AbortSignal.any([signal, controller.signal]);
  let resolve!: (job: BrainJobStatus) => void;
  let reject!: (error: unknown) => void;
  const completed = new Promise<BrainJobStatus>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let settled = false;
  let dirty = true;
  let reading = false;
  let revision: unknown;
  const finish = (job: BrainJobStatus | null, error?: unknown): void => {
    if (settled) return;
    settled = true;
    if (job) resolve(job);
    else reject(error ?? new Error("Brain job feed disconnected"));
    controller.abort();
  };
  const read = async (): Promise<void> => {
    if (reading || settled) return;
    reading = true;
    try {
      while (dirty) {
        if (settled) return;
        dirty = false;
        const { job } = JobStatusSchema.parse(
          await transport.request(`/__host/jobs/status?id=${encodeURIComponent(id)}`, lifetime),
        );
        if (job.id !== id) throw new Error("Brain job identity changed");
        if (settled) return;
        receive(job);
        if (TERMINAL.has(job.state)) finish(job);
      }
    } catch (error) {
      finish(null, error);
    } finally {
      reading = false;
    }
  };
  const onAbort = () => finish(null, signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const startEvents = async () =>
    transport.events((event) => {
      if (event.event !== "status") return;
      if (event.data.instanceId !== transport.instanceId) {
        finish(null, new Error("Brain host lifetime changed"));
        return;
      }
      if (revision !== event.data.jobRevision) {
        revision = event.data.jobRevision;
        dirty = true;
        void read();
      }
    }, lifetime);
  const streaming = startEvents().then(
    () => finish(null),
    (error: unknown) => finish(null, error),
  );
  void read();
  try {
    return await completed;
  } finally {
    signal.removeEventListener("abort", onAbort);
    controller.abort();
    await streaming;
  }
}

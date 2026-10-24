/** Validated event transport for the one canonical consumer store. */
import { z } from "zod/v3";
import type { BrainHostEvent } from "../service/event-decoder.js";
import { localBrainEvents, type LocalBrainClientOptions } from "../service/local-client.js";
import type { BrainStatusSource } from "./status-store.js";

const EnvelopeSchema = z.object({
  instanceId: z.string().min(1).max(128),
  capabilities: z.object({ events: z.boolean(), logCursors: z.boolean().optional() }),
});
const LogSchema = z.object({
  instanceId: z.string().min(1).max(128),
  index: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  line: z.string().max(8192),
});
export interface BrainStatusTransport {
  events(receive: (event: BrainHostEvent) => void, signal: AbortSignal): Promise<void>;
}

/** The owner supplies its full DTO validator; this boundary validates feed identity too. */
export function brainStatusSource<Status extends { instanceId: string }>(
  transport: BrainStatusTransport,
  decodeStatus: (input: unknown) => Status,
): BrainStatusSource<Status> {
  return {
    open: (receive, signal) =>
      transport.events((event) => {
        if (event.event === "log") {
          receive.log(LogSchema.parse(event.data));
          return;
        }
        const envelope = EnvelopeSchema.parse(event.data);
        // COMPAT(brainLogCursors): added in v0.10.0, remove after 2027-04-23.
        if (!envelope.capabilities.events || !envelope.capabilities.logCursors)
          throw new Error("Update the Brain host to use the live Brain surface");
        const value = decodeStatus(event.data);
        if (value.instanceId !== envelope.instanceId)
          throw new Error("Brain status projection changed the host identity");
        receive.status(value);
      }, signal),
  };
}

export function localBrainStatusSource<Status extends { instanceId: string }>(
  options: LocalBrainClientOptions,
  decodeStatus: (input: unknown) => Status,
): BrainStatusSource<Status> {
  return brainStatusSource(
    {
      events: (receive, signal) => localBrainEvents(options, receive, signal),
    },
    decodeStatus,
  );
}

import { z } from "zod";
import type { ScheduleRef, ScheduleTransferInput } from "@getpaseo/plugin/otto/schedules";
export type { ScheduleTransferInput } from "@getpaseo/plugin/otto/schedules";
import type { ScheduleTransferEntry } from "./registry.js";
import type { ScheduleOrigin } from "./stores.js";
import { scheduleDigest } from "./files.js";
import { canonicalJson } from "../workflows/graph-identity.js";

const record = z.record(z.string(), z.unknown());
const serialize = (value: unknown) => JSON.stringify(canonicalJson(value), null, 2) + "\n";
/** Raw records remain raw: source backup is byte-exact and unknown nested fields
 * travel with a move. Copy settings deliberately starts a new identity/history. */
export function scheduleTransferPlan(
  source: Pick<ScheduleTransferEntry, "bytes" | "ref">,
  input: ScheduleTransferInput,
  destination: Pick<ScheduleOrigin, "scope" | "location" | "storeKey">,
  at: string,
) {
  const original = record.parse(JSON.parse(source.bytes));
  const metadata = original.otto === undefined ? {} : record.parse(original.otto);
  const destinationRef: ScheduleRef = {
    scope: destination.scope,
    location: destination.location,
    storeKey: destination.storeKey,
    id:
      input.operation === "move"
        ? source.ref.id
        : `schedule-${scheduleDigest(JSON.stringify([input.scope, input.operationId, "copy"]))}`,
  };
  const sourceMarker = {
    operationId: input.operationId,
    operation: input.operation,
    phase: "pending",
    role: "source",
    peer: destinationRef,
  };
  const fencedSource = serialize({
    ...original,
    status: "paused",
    nextRunAt: null,
    pausedAt: at,
    updatedAt: at,
    otto: {
      ...metadata,
      version: 1,
      scope: source.ref.scope,
      location: source.ref.location,
      storeKey: source.ref.storeKey,
      transfer: sourceMarker,
    },
  });
  const destinationMetadata = { ...metadata };
  if (input.operation === "copy") {
    delete destinationMetadata.creation;
    delete destinationMetadata.history;
  }
  const rawDestination = {
    ...original,
    ...(input.operation === "copy" ? { runs: [], lastRunAt: null, createdAt: at } : {}),
    id: destinationRef.id,
    status: "paused",
    nextRunAt: null,
    pausedAt: at,
    updatedAt: at,
    otto: {
      ...destinationMetadata,
      version: 1,
      scope: destinationRef.scope,
      location: destinationRef.location,
      storeKey: destinationRef.storeKey,
      transfer: { ...sourceMarker, role: "destination", peer: source.ref },
    },
  };
  return {
    destinationRef,
    originalSource: source.bytes,
    fencedSource,
    pendingDestination: serialize(rawDestination),
    committedDestination: serialize({
      ...rawDestination,
      otto: {
        ...rawDestination.otto,
        transfer: { ...rawDestination.otto.transfer, phase: "committed" },
      },
    }),
  };
}
export type ScheduleTransferPlan = ReturnType<typeof scheduleTransferPlan>;

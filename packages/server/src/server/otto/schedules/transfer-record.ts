import path from "node:path";
import { z } from "zod";
import {
  ScheduleDigest,
  ScheduleRef,
  ScheduleTransferInput,
  ScheduleTransferMarker,
} from "@getpaseo/plugin/otto/schedules";
import { canonicalJson } from "../workflows/graph-identity.js";
import { scheduleDigest, ScheduleError, readScheduleFile } from "./files.js";
import { scheduleTransferPlan, type ScheduleTransferPlan } from "./transfer-plan.js";

export const scheduleTransferInput = ScheduleTransferInput;
export const scheduleTransferRecord = z.object({
  version: z.literal(1),
  input: scheduleTransferInput,
  fingerprint: ScheduleDigest,
  at: z.string(),
  destination: ScheduleRef,
  status: z.enum(["reconciliation_required", "committed", "aborted"]),
  proof: z.object({
    originalSource: ScheduleDigest,
    fencedSource: ScheduleDigest,
    pendingDestination: ScheduleDigest,
    committedDestination: ScheduleDigest,
  }),
});
export type ScheduleTransferRecord = z.infer<typeof scheduleTransferRecord>;
export function scheduleTransferFingerprint(input: ScheduleTransferInput) {
  return scheduleDigest(JSON.stringify(canonicalJson(input)));
}
export function scheduleTransferProof(plan: ScheduleTransferPlan) {
  return {
    originalSource: scheduleDigest(plan.originalSource),
    fencedSource: scheduleDigest(plan.fencedSource),
    pendingDestination: scheduleDigest(plan.pendingDestination),
    committedDestination: scheduleDigest(plan.committedDestination),
  };
}
export async function readScheduleTransfer(file: string) {
  const bytes = await readScheduleFile(file, 32000);
  if (bytes === null) return null;
  const record = scheduleTransferRecord.parse(JSON.parse(bytes));
  if (record.fingerprint !== scheduleTransferFingerprint(record.input))
    throw new ScheduleError(
      "conflict",
      "Transfer receipt identity changed. Inspect it on the owning host.",
    );
  const scope = record.input.scope;
  if (
    record.destination.scope.hostId !== scope.hostId ||
    record.destination.scope.projectId !== scope.projectId ||
    record.destination.location !== record.input.destination ||
    record.input.source.scope.hostId !== scope.hostId ||
    (record.input.source.scope.projectId !== null &&
      record.input.source.scope.projectId !== scope.projectId)
  )
    throw new ScheduleError("invalid", "Transfer receipt crosses its owning host or project.");
  return { record, revision: scheduleDigest(bytes) };
}
const transferHead = z.object({
  otto: z.object({ transfer: ScheduleTransferMarker.optional() }).optional(),
});
export function hasPendingScheduleTransfer(bytes: string | null, operationId: string): boolean {
  if (bytes === null) return false;
  try {
    const result = transferHead.safeParse(JSON.parse(bytes));
    const marker = result.success ? result.data.otto?.transfer : null;
    return marker?.operationId === operationId && marker.phase === "pending";
  } catch {
    return false;
  }
}
export async function retainedScheduleTransferPlan(file: string, record: ScheduleTransferRecord) {
  const bytes = await readScheduleFile(path.join(path.dirname(file), "source.json"));
  if (bytes === null || scheduleDigest(bytes) !== record.proof.originalSource)
    throw new ScheduleError(
      "conflict",
      "Transfer backup is unavailable or changed. No transfer was replayed.",
    );
  const plan = scheduleTransferPlan(
    { bytes, ref: record.input.source },
    record.input,
    record.destination,
    record.at,
  );
  if (
    JSON.stringify(scheduleTransferProof(plan)) !== JSON.stringify(record.proof) ||
    JSON.stringify(canonicalJson(plan.destinationRef)) !==
      JSON.stringify(canonicalJson(record.destination))
  )
    throw new ScheduleError(
      "conflict",
      "Retained transfer proof changed. Inspect the original records.",
    );
  return plan;
}

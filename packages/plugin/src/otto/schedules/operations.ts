import { ScheduleScope } from "./model.js";
import * as rpc from "./rpc.js";
import { z } from "zod";

/** Shared discovery and authority classification for daemon, CLI and MCP. */
export const scheduleMutationNames: readonly string[] = [
  rpc.createSchedule.name,
  rpc.updateSchedule.name,
  rpc.controlSchedule.name,
  rpc.saveScheduleStorage.name,
  rpc.saveScheduleDefaults.name,
  rpc.transferSchedule.name,
  rpc.reconcileScheduleTransfer.name,
  rpc.recoverScheduleTransferLock.name,
];
const writes = new Set(scheduleMutationNames);
export function scheduleOperationWrites(method: string) {
  return writes.has(method);
}
export function describeScheduleOperation(
  operation: (typeof rpc.scheduleOperations)[number],
  includeSchema: boolean,
) {
  const description: { name: string; readOnly: boolean; input?: unknown } = {
    name: operation.name,
    readOnly: !scheduleOperationWrites(operation.name),
  };
  if (includeSchema) description.input = z.toJSONSchema(operation.input);
  return description;
}

/** Post-validation envelope selection, never a schema transform or scope guess
 * from file paths. Every published operation carries one of these exact envelopes. */
export function scheduleOperationScope(method: string, input: unknown): ScheduleScope {
  const contract = rpc.scheduleOperations.find((row) => row.name === method);
  if (!contract) throw new Error("Discover an available Schedule operation first.");
  const data: unknown = contract.input.parse(input);
  if (!data || typeof data !== "object") throw new Error("Missing Schedule scope.");
  if ("scope" in data) return ScheduleScope.parse(data.scope);
  if ("ref" in data) {
    const ref = data.ref;
    if (ref && typeof ref === "object" && "scope" in ref) return ScheduleScope.parse(ref.scope);
  }
  if (method === rpc.readScheduleDefaults.name || method === rpc.saveScheduleDefaults.name) {
    if ("hostId" in data) return ScheduleScope.parse({ hostId: data.hostId, projectId: null });
  }
  return ScheduleScope.parse(data);
}

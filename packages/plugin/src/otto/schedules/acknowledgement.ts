import { z } from "zod";
import * as rpc from "./rpc.js";
import { ScheduleRef } from "./model.js";

function sameRef(left: ScheduleRef, right: ScheduleRef) {
  return (
    left.id === right.id &&
    left.location === right.location &&
    left.storeKey === right.storeKey &&
    left.scope.hostId === right.scope.hostId &&
    left.scope.projectId === right.scope.projectId
  );
}
function exact(document: rpc.ScheduleDocument, ref: ScheduleRef) {
  if (!sameRef(document.ref, ref) || document.schedule.id !== ref.id)
    throw new Error("Unconfirmed Schedule origin.");
}
/** Semantic postconditions after structural validation. In particular, the wire's
 * optional control fields must never turn an empty success into an acknowledgement. */
export function assertScheduleAcknowledgement(
  method: string,
  input: unknown,
  value: unknown,
): void {
  switch (method) {
    case rpc.readSchedule.name:
      exact(rpc.ScheduleDocument.parse(value), rpc.readSchedule.input.parse(input));
      return;
    case rpc.updateSchedule.name:
      exact(rpc.ScheduleDocument.parse(value), rpc.updateSchedule.input.parse(input).ref);
      return;
    case rpc.createSchedule.name:
    case rpc.readCreatedSchedule.name: {
      if (method === rpc.readCreatedSchedule.name && value === null) return;
      const intent = rpc.readCreatedSchedule.input.parse(input),
        document = rpc.ScheduleDocument.parse(value);
      if (
        document.ref.scope.hostId !== intent.scope.hostId ||
        document.ref.scope.projectId !== intent.scope.projectId ||
        document.schedule.id !== document.ref.id ||
        document.schedule.otto?.creation?.operationId !== intent.operationId
      )
        throw new Error("Unconfirmed Schedule creation intent.");
      return;
    }
    case rpc.controlSchedule.name: {
      const request = rpc.controlSchedule.input.parse(input),
        result = z
          .object({
            entry: rpc.ScheduleDocument.optional(),
            deleted: z.boolean().optional(),
            acceptedRunId: z.string().optional(),
          })
          .parse(value);
      if (request.command.type === "delete") {
        if (result.deleted !== true) throw new Error("Unconfirmed Schedule deletion.");
        return;
      }
      if (!result.entry) throw new Error("Unconfirmed Schedule control.");
      exact(result.entry, request.ref);
      if (request.command.type === "run-once" && !result.acceptedRunId?.trim())
        throw new Error("Unconfirmed Schedule run admission.");
      return;
    }
    default:
      return;
  }
}

import type { PluginRpcContract } from "@getpaseo/plugin";
import type { input as Input, output as Output, ZodType } from "zod";
import * as rpc from "@getpaseo/plugin/otto/schedules";

export interface ScheduleRpcTransport {
  invokePluginRpc(pluginId: string, method: string, input: unknown): Promise<unknown>;
}
export class ScheduleRequestError extends Error {
  constructor(
    readonly code: "invalid" | "conflict" | "busy" | "unavailable" | "unsupported",
    readonly origin: "local-validation" | "host-reply" | "transport" | "response-validation",
    message: string,
  ) {
    super(message);
    this.name = "ScheduleRequestError";
  }
}
function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: Input<typeof rpc.ScheduleFailure> },
): T {
  if (!result.ok)
    throw new ScheduleRequestError(result.error.code, "host-reply", result.error.message);
  return result.value;
}
function unconfirmedResponse(): never {
  throw new ScheduleRequestError(
    "unavailable",
    "response-validation",
    "The host response could not be validated. Inspect the saved Schedule before another write.",
  );
}
function sameRef(left: rpc.ScheduleRef, right: rpc.ScheduleRef) {
  return (
    left.id === right.id &&
    left.location === right.location &&
    left.storeKey === right.storeKey &&
    left.scope.hostId === right.scope.hostId &&
    left.scope.projectId === right.scope.projectId
  );
}
function exactDocument(value: rpc.ScheduleDocument, ref: rpc.ScheduleRef) {
  if (!sameRef(value.ref, ref) || value.schedule.id !== ref.id) unconfirmedResponse();
  return value;
}
type ControlValue = Extract<Output<typeof rpc.controlSchedule.output>, { ok: true }>["value"];
function controlAcknowledgement(
  input: Input<typeof rpc.controlSchedule.input>,
  value: ControlValue,
) {
  if (input.command.type === "delete") {
    if (value.deleted !== true) unconfirmedResponse();
  } else {
    if (!value.entry) unconfirmedResponse();
    exactDocument(value.entry, input.ref);
    if (input.command.type === "run-once" && !value.acceptedRunId?.trim()) unconfirmedResponse();
  }
  return value;
}
/** The normal authenticated daemon transport owns connectivity and encryption.
 * This adapter has no socket, cache, provider, retry or background task. */
export function createScheduleApi(transport: ScheduleRpcTransport) {
  async function call<I extends ZodType, O extends ZodType>(
    contract: PluginRpcContract<I, O>,
    input: Input<I>,
  ): Promise<Output<O>> {
    const parsed = contract.input.safeParse(input);
    if (!parsed.success)
      throw new ScheduleRequestError(
        "invalid",
        "local-validation",
        "Check the Schedule fields before saving. This request was not sent.",
      );
    let response: unknown;
    try {
      response = await transport.invokePluginRpc("otto-schedules", contract.name, parsed.data);
    } catch {
      throw new ScheduleRequestError(
        "unavailable",
        "transport",
        "The owning host did not confirm this request. Reconnect and inspect the saved Schedule before another write.",
      );
    }
    const validated = contract.output.safeParse(response);
    if (!validated.success) unconfirmedResponse();
    return validated.data;
  }
  return {
    list: async (input: Input<typeof rpc.listSchedules.input>) =>
      unwrap(await call(rpc.listSchedules, input)),
    watch: async (input: Input<typeof rpc.watchSchedules.input>) =>
      unwrap(await call(rpc.watchSchedules, input)),
    read: async (input: Input<typeof rpc.readSchedule.input>) =>
      exactDocument(unwrap(await call(rpc.readSchedule, input)), input),
    created: async (input: Input<typeof rpc.readCreatedSchedule.input>) => {
      const document = unwrap(await call(rpc.readCreatedSchedule, input));
      if (
        document &&
        (document.ref.scope.hostId !== input.scope.hostId ||
          document.ref.scope.projectId !== input.scope.projectId ||
          document.schedule.otto?.creation?.operationId !== input.operationId ||
          document.schedule.id !== document.ref.id)
      )
        unconfirmedResponse();
      return document;
    },
    preview: async (input: Input<typeof rpc.previewScheduleCadence.input>) =>
      unwrap(await call(rpc.previewScheduleCadence, input)),
    history: async (input: Input<typeof rpc.readScheduleHistory.input>) =>
      unwrap(await call(rpc.readScheduleHistory, input)),
    run: async (input: Input<typeof rpc.readScheduleRun.input>) =>
      unwrap(await call(rpc.readScheduleRun, input)),
    part: async (input: Input<typeof rpc.readScheduleRunPart.input>) =>
      unwrap(await call(rpc.readScheduleRunPart, input)),
    create: async (input: Input<typeof rpc.createSchedule.input>) => {
      const document = unwrap(await call(rpc.createSchedule, input));
      if (
        document.ref.scope.hostId !== input.scope.hostId ||
        document.ref.scope.projectId !== input.scope.projectId ||
        document.schedule.otto?.creation?.operationId !== input.operationId ||
        document.schedule.id !== document.ref.id
      )
        unconfirmedResponse();
      return document;
    },
    update: async (input: Input<typeof rpc.updateSchedule.input>) =>
      exactDocument(unwrap(await call(rpc.updateSchedule, input)), input.ref),
    control: async (input: Input<typeof rpc.controlSchedule.input>) =>
      controlAcknowledgement(input, unwrap(await call(rpc.controlSchedule, input))),
    review: async (input: Input<typeof rpc.reviewScheduleTarget.input>) =>
      unwrap(await call(rpc.reviewScheduleTarget, input)),
    storage: async (input: Input<typeof rpc.readScheduleStorage.input>) =>
      unwrap(await call(rpc.readScheduleStorage, input)),
    saveStorage: async (input: Input<typeof rpc.saveScheduleStorage.input>) =>
      unwrap(await call(rpc.saveScheduleStorage, input)),
    defaults: async (input: Input<typeof rpc.readScheduleDefaults.input>) =>
      unwrap(await call(rpc.readScheduleDefaults, input)),
    saveDefaults: async (input: Input<typeof rpc.saveScheduleDefaults.input>) =>
      unwrap(await call(rpc.saveScheduleDefaults, input)),
    transfer: async (input: Input<typeof rpc.transferSchedule.input>) =>
      unwrap(await call(rpc.transferSchedule, input)),
    inspectTransfer: async (input: Input<typeof rpc.readScheduleTransfer.input>) =>
      unwrap(await call(rpc.readScheduleTransfer, input)),
    reconcileTransfer: async (input: Input<typeof rpc.reconcileScheduleTransfer.input>) =>
      unwrap(await call(rpc.reconcileScheduleTransfer, input)),
    recoverTransferLock: async (input: Input<typeof rpc.recoverScheduleTransferLock.input>) =>
      unwrap(await call(rpc.recoverScheduleTransferLock, input)),
  };
}
export type ScheduleApi = ReturnType<typeof createScheduleApi>;

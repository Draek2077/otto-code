import {
  ScheduleTransferInput,
  type ScheduleDocument,
  type ScheduleTransferLookup,
} from "@getpaseo/plugin/otto/schedules";
import { ScheduleRequestError, type ScheduleApi } from "./api";
import { ScheduleOperation } from "./operation";

/** Read both subscribed snapshots rather than a method on the stable model. */
export function scheduleTransferCanStart(
  state: { attempted: boolean },
  lane: { busy: boolean; blocked: boolean },
) {
  return !state.attempted && !lane.busy && !lane.blocked;
}

export class ScheduleTransferModel {
  readonly lane = new ScheduleOperation();
  private listeners = new Set<() => void>();
  private state: {
    attempted: boolean;
    operation: "copy" | "move";
    destination: "repository" | "host";
    operationId: string;
    receipt: ScheduleTransferLookup | null;
    receiptInspected: boolean;
    writersStopped: boolean;
  };
  constructor(
    readonly api: ScheduleApi,
    readonly scope: { hostId: string; projectId: string },
    readonly document: ScheduleDocument,
    operationId: string,
  ) {
    this.state = {
      attempted: false,
      operation: "copy",
      destination: document.ref.location === "host" ? "repository" : "host",
      operationId,
      receipt: null,
      receiptInspected: false,
      writersStopped: false,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    return this.lane.activate();
  }
  canStart() {
    return scheduleTransferCanStart(this.state, this.lane.getSnapshot());
  }
  operation(value: "copy" | "move") {
    if (!this.state.attempted && !this.lane.getSnapshot().busy) this.publish({ operation: value });
  }
  destination(value: "repository" | "host") {
    if (!this.state.attempted && !this.lane.getSnapshot().busy)
      this.publish({ destination: value });
  }
  operationId(value: string) {
    if (!this.state.attempted && !this.lane.getSnapshot().busy)
      this.publish({ operationId: value, receipt: null });
  }
  writersStopped(value: boolean) {
    if (!this.lane.getSnapshot().busy) this.publish({ writersStopped: value });
  }
  async start(confirm: () => Promise<boolean>) {
    if (this.state.attempted) return;
    const input = {
      scope: this.scope,
      source: this.document.ref,
      expectedRevision: this.document.revision,
      operationId: this.state.operationId,
      operation: this.state.operation,
      destination: this.state.destination,
    };
    await this.lane.run({
      write: true,
      confirm,
      operation: () => {
        if (!ScheduleTransferInput.safeParse(input).success)
          throw new ScheduleRequestError(
            "invalid",
            "local-validation",
            "Check the transfer operation ID, project and destination. This request was not sent.",
          );
        this.publish({ attempted: true });
        return this.api.transfer(input);
      },
      apply: (receipt) => this.publish({ receipt }),
      message: "Transfer receipt received. Inspect its status; no target was started.",
    });
  }
  async inspect() {
    const operationId = this.state.operationId;
    await this.lane.run({
      operation: () => this.api.inspectTransfer({ scope: this.scope, operationId }),
      apply: (receipt) => {
        this.publish({ attempted: true, receipt, receiptInspected: true });
      },
    });
  }
  async reconcile(decision: "complete" | "abort", confirm: () => Promise<boolean>) {
    const receipt = this.state.receipt;
    if (!receipt?.found || !this.state.receiptInspected) return;
    // Explicit inspection authorizes reconciliation only, never replay of transfer/start.
    await this.lane.run({
      write: true,
      recovery: true,
      confirm,
      operation: () => {
        this.publish({ receiptInspected: false });
        return this.api.reconcileTransfer({
          scope: this.scope,
          operationId: receipt.operationId,
          expectedRevision: receipt.revision,
          expectedSourceDigest: receipt.sourceDigest,
          expectedDestinationDigest: receipt.destinationDigest,
          decision,
        });
      },
      apply: (updated) => this.publish({ receipt: updated, receiptInspected: true }),
      message: "Inspected transfer reconciliation acknowledged.",
    });
  }
  async recover(
    kind: NonNullable<ScheduleTransferLookup["locks"]>[number]["kind"],
    confirm: () => Promise<boolean>,
  ) {
    const receipt = this.state.receipt,
      lock = receipt?.locks.find((row) => row.kind === kind);
    if (
      !receipt ||
      !lock ||
      !this.state.receiptInspected ||
      !this.state.writersStopped ||
      !lock.canRecover
    )
      return;
    await this.lane.run({
      write: true,
      recovery: true,
      confirm,
      operation: () => {
        this.publish({ receiptInspected: false });
        return this.api.recoverTransferLock({
          scope: this.scope,
          operationId: receipt.operationId,
          expectedRevision: receipt.found ? receipt.revision : null,
          kind,
          expectedLockRevision: lock.revision,
          writersStopped: true,
        });
      },
      apply: (updated) => this.publish({ receipt: updated, receiptInspected: true }),
      message: "Inspected lock recovery acknowledged.",
    });
  }
}

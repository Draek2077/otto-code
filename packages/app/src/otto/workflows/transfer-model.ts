import type { WorkflowRef } from "@getpaseo/plugin/otto/workflows";
import type { WorkflowApi } from "./api";
type Inspection = Awaited<ReturnType<WorkflowApi["inspectTransfer"]>>;
type Ports = Pick<
  WorkflowApi,
  "read" | "transfer" | "inspectTransfer" | "reconcileTransfer" | "recoverTransferLock"
>;
let operation = 0;
export class WorkflowTransferForm {
  private listeners = new Set<() => void>();
  private active = false;
  private authority = 0;
  private writing = false;
  private state: {
    operationId: string;
    destination: "host" | "repository";
    operation: "copy" | "move";
    attempted: boolean;
    busy: boolean;
    error: string;
    message: string;
    inspection: Inspection | null;
    epoch: number;
  };
  constructor(readonly reference: WorkflowRef) {
    this.state = {
      operationId: this.nextId(),
      destination: reference.location === "host" ? "repository" : "host",
      operation: reference.location === "legacy" ? "copy" : "move",
      attempted: false,
      busy: false,
      error: "",
      message: "",
      inspection: null,
      epoch: 0,
    };
  }
  private nextId() {
    return `transfer-${Date.now().toString(36)}-${++operation}`;
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
    this.active = true;
    const id = ++this.authority;
    return () => {
      if (id === this.authority) {
        this.active = false;
        ++this.authority;
        if (this.writing)
          this.publish({
            attempted: true,
            error:
              "Transfer may have completed. Inspect the retained operation receipt before another write.",
          });
      }
    };
  }
  destination(value: string) {
    if (!this.state.busy && !this.state.attempted && (value === "host" || value === "repository"))
      this.publish({ destination: value });
  }
  operation(value: string) {
    if (!this.state.busy && !this.state.attempted && (value === "copy" || value === "move"))
      this.publish({ operation: value });
  }
  operationId(value: string) {
    if (!this.state.busy) this.publish({ operationId: value, attempted: true, inspection: null });
  }
  private async request(action: (current: () => boolean) => Promise<void>) {
    if (!this.active || this.state.busy) return;
    const id = this.authority;
    this.publish({ busy: true, error: "" });
    try {
      await action(() => this.active && id === this.authority);
    } catch (error) {
      if (id === this.authority)
        this.publish({
          error: error instanceof Error ? error.message : "Transfer action was not acknowledged.",
        });
    } finally {
      this.writing = false;
      this.publish({ busy: false });
    }
  }
  async newOperation(confirm: () => Promise<boolean>) {
    await this.request(async (current) => {
      if ((await confirm()) && current())
        this.publish({
          operationId: this.nextId(),
          epoch: this.state.epoch + 1,
          attempted: false,
          inspection: null,
          error: "",
          message: "",
        });
    });
  }
  async transfer(api: Pick<Ports, "read" | "transfer">, confirm: () => Promise<boolean>) {
    if (this.state.attempted) return;
    await this.request(async (current) => {
      const source = await api.read(this.reference);
      if (!current() || !(await confirm()) || !current()) return;
      this.writing = true;
      this.publish({ attempted: true });
      const receipt = await api.transfer({
        source: source.ref,
        expectedRevision: source.revision,
        destination: this.state.destination,
        operation: this.state.operation,
        operationId: this.state.operationId,
        confirmed: true,
      });
      if (current()) this.publish({ message: `${receipt.status}: ${receipt.message}` });
    });
  }
  async inspect(api: Pick<Ports, "inspectTransfer">) {
    await this.request(async (current) => {
      const inspection = await api.inspectTransfer({
        scope: this.reference.scope,
        operationId: this.state.operationId,
      });
      if (current()) this.publish({ inspection });
    });
  }
  async reconcile(
    api: Pick<Ports, "reconcileTransfer">,
    decision: "keep_copy" | "complete_move",
    confirm: () => Promise<boolean>,
  ) {
    const inspected = this.state.inspection;
    if (!inspected?.revision || !inspected.destinationRevision || !inspected.destinationMatches)
      return;
    await this.request(async (current) => {
      if (!(await confirm()) || !current()) return;
      this.writing = true;
      const inspection = await api.reconcileTransfer({
        scope: this.reference.scope,
        operationId: this.state.operationId,
        expectedRevision: inspected.revision!,
        expectedSourceRevision: inspected.sourceRevision,
        expectedDestinationRevision: inspected.destinationRevision!,
        decision,
        confirmed: true,
      });
      if (current())
        this.publish({ inspection, message: inspection.receipt?.message ?? "Receipt reconciled." });
    });
  }
  async recoverLock(api: Pick<Ports, "recoverTransferLock">, confirm: () => Promise<boolean>) {
    const inspected = this.state.inspection;
    if (!inspected?.lock?.canRecover) return;
    await this.request(async (current) => {
      if (!(await confirm()) || !current()) return;
      this.writing = true;
      const inspection = await api.recoverTransferLock({
        scope: this.reference.scope,
        operationId: this.state.operationId,
        expectedRevision: inspected.revision,
        expectedLockRevision: inspected.lock!.revision,
        confirmedNoWriter: true,
      });
      if (current())
        this.publish({
          inspection,
          message: "Exact lock retained and recovered. No copy or move was replayed.",
        });
    });
  }
}

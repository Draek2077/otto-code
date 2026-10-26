export interface ContextEdgeEditState {
  busy: boolean;
  blocked: boolean;
  saved: boolean;
  error: string;
  operationId: string | null;
}
/** Local confirmation/write authority only. Canonical source/revision stays in the host report. */
export class ContextEdgeEdit {
  private state: ContextEdgeEditState = {
    busy: false,
    blocked: false,
    saved: false,
    error: "",
    operationId: null,
  };
  private readonly listeners = new Set<() => void>();
  private activation: object | null = null;
  private inFlight = false;
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  activate() {
    const activation = {};
    this.activation = activation;
    return () => {
      if (this.activation === activation) this.activation = null;
    };
  }
  private publish(patch: Partial<ContextEdgeEditState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  async change(
    confirm: () => Promise<boolean>,
    write: () => Promise<{ ok: true } | { ok: false; message: string }>,
    changed: () => void,
    isCurrent: () => boolean = () => true,
    operationId: string | null = null,
  ): Promise<void> {
    if (!this.activation || this.inFlight || this.state.blocked || !isCurrent()) return;
    const activation = this.activation;
    this.inFlight = true;
    let sent = false;
    this.publish({ busy: true, error: "", operationId });
    try {
      if (!(await confirm()) || this.activation !== activation || !isCurrent()) return;
      sent = true;
      const result = await write();
      if (this.activation !== activation || !isCurrent()) {
        this.publish({
          blocked: true,
          error:
            "The source may have changed while this view was hidden. Refresh and review it before another edit.",
        });
        return;
      }
      if (!result.ok) {
        this.publish({ blocked: true, error: result.message });
        return;
      }
      this.publish({ blocked: true, saved: true });
      changed();
    } catch {
      this.publish({
        blocked: sent,
        error:
          "The host could not confirm this context edit. Refresh and inspect the source before trying again.",
      });
    } finally {
      this.inFlight = false;
      this.publish({ busy: false });
    }
  }
}

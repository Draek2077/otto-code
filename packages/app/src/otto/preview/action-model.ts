export interface PreviewActionState {
  busy: boolean;
  notice: string;
  error: string;
}
/** One explicit UI action at a time. Hiding invalidates confirmations, never cancels a host write. */
export class PreviewActions {
  private state: PreviewActionState = { busy: false, notice: "", error: "" };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private active = false;
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<PreviewActionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    const epoch = ++this.epoch;
    this.active = true;
    return () => {
      if (epoch === this.epoch) {
        this.active = false;
        this.epoch++;
      }
    };
  }
  async run(
    confirm: () => Promise<boolean>,
    request: () => Promise<string>,
    refresh: () => Promise<void>,
  ) {
    if (!this.active || this.state.busy) return;
    const epoch = this.epoch;
    this.publish({ busy: true, notice: "", error: "" });
    try {
      if (!(await confirm()) || !this.active || epoch !== this.epoch) return;
      const notice = await request();
      if (!this.active || epoch !== this.epoch) return;
      this.publish({ notice });
      await refresh();
    } catch {
      if (this.active && epoch === this.epoch)
        this.publish({
          error:
            "The host could not acknowledge this action. Refresh the servers and inspect their state before another lifecycle action.",
        });
    } finally {
      this.publish({ busy: false });
    }
  }
}

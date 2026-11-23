/** Local mutation admission. Hiding a surface never implies that a host write was canceled. */
export class WorkflowAction {
  private listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  private state = { busy: false, error: "", message: "", blocked: false };
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
        if (this.state.busy)
          this.publish({
            blocked: true,
            error:
              "The host action may have completed. Inspect current state before another write.",
          });
      }
    };
  }
  async run<T>(action: () => Promise<T>, write = true): Promise<T | null> {
    if (!this.active || this.state.busy || (write && this.state.blocked)) return null;
    const id = this.authority;
    this.publish({ busy: true, error: "", message: "" });
    try {
      const value = await action();
      return id === this.authority ? value : null;
    } catch (error) {
      if (id === this.authority)
        this.publish({
          error: error instanceof Error ? error.message : "Host action was not acknowledged.",
          blocked: write,
        });
      return null;
    } finally {
      this.publish({ busy: false });
    }
  }
  inspected() {
    if (!this.state.busy) this.publish({ blocked: false, error: "" });
  }
  message(message: string) {
    this.publish({ message });
  }
}

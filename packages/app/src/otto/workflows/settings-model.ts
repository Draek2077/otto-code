export class WorkflowStorageForm {
  private listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  private state: {
    revision: string;
    value: string;
    busy: boolean;
    blocked: boolean;
    error: string;
    changed: boolean;
  };
  constructor(revision: string, value: string) {
    this.state = { revision, value, busy: false, blocked: false, error: "", changed: false };
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
        if (this.state.busy)
          this.publish({
            blocked: true,
            error: "Settings may have saved. Reload before another write.",
          });
      }
    };
  }
  select(value: string) {
    this.publish({ value, changed: true });
  }
  async save(
    write: (revision: string, value: string) => Promise<{ revision: string; value: string }>,
  ) {
    if (!this.active || this.state.busy || this.state.blocked) return;
    const id = this.authority,
      submitted = this.state.value;
    this.publish({ busy: true, error: "" });
    try {
      const saved = await write(this.state.revision, submitted);
      if (id === this.authority)
        this.publish({
          revision: saved.revision,
          value: this.state.value === submitted ? saved.value : this.state.value,
          changed: this.state.value !== submitted,
        });
    } catch (error) {
      if (id === this.authority)
        this.publish({
          blocked: true,
          error: error instanceof Error ? error.message : "Settings were not acknowledged.",
        });
    } finally {
      this.publish({ busy: false });
    }
  }
  async reload(
    read: () => Promise<{ revision: string; value: string }>,
    confirm: () => Promise<boolean>,
  ) {
    if (!this.active || this.state.busy) return;
    const id = this.authority;
    if (!(await confirm()) || id !== this.authority) return;
    this.publish({ busy: true });
    try {
      const value = await read();
      if (id === this.authority)
        this.publish({ ...value, blocked: false, error: "", changed: false });
    } catch (error) {
      if (id === this.authority)
        this.publish({ error: error instanceof Error ? error.message : "Reload failed." });
    } finally {
      this.publish({ busy: false });
    }
  }
}

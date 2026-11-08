import { ScheduleRequestError } from "./api";

/** A surface's local mutation lane. No retry, optimistic host write or cancellation
 * claim. Host CAS remains authoritative between independent surfaces. */
export class ScheduleOperation {
  private active = false;
  private authority = 0;
  private sent = false;
  private listeners = new Set<() => void>();
  private state = { busy: false, writing: false, blocked: false, error: "", message: "" };
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
    const authority = ++this.authority;
    return () => {
      if (authority !== this.authority) return;
      this.active = false;
      ++this.authority;
      if (this.sent)
        this.publish({
          blocked: true,
          error:
            "The host may have accepted this action. Inspect its saved state before another write.",
        });
    };
  }
  private report(error: unknown) {
    this.publish({
      blocked:
        this.state.blocked ||
        (this.sent &&
          !(error instanceof ScheduleRequestError && error.origin === "local-validation")),
      error:
        error instanceof ScheduleRequestError
          ? error.message
          : "The host did not confirm this operation. Inspect the saved state before another write.",
    });
  }
  async run<T>(input: {
    write?: boolean;
    recovery?: boolean;
    confirm?: () => Promise<boolean>;
    operation(): Promise<T>;
    apply(value: T): void;
    message?: string;
    inspected?: boolean;
  }): Promise<void> {
    if (!this.active || this.state.busy || (input.write && this.state.blocked && !input.recovery))
      return;
    const authority = this.authority;
    this.publish({ busy: true, writing: !!input.write, error: "", message: "" });
    try {
      if (input.confirm && !(await input.confirm())) return;
      if (!this.active || this.authority !== authority) return;
      this.sent = !!input.write;
      const result = await input.operation();
      if (!this.active || this.authority !== authority) return;
      input.apply(result);
      this.publish({
        message: input.message ?? "",
        blocked: input.inspected ? false : this.state.blocked,
      });
    } catch (error) {
      if (this.active && this.authority === authority) this.report(error);
    } finally {
      this.sent = false;
      this.publish({ busy: false, writing: false });
    }
  }
}

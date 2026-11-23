import type { KnowledgeLockInspection } from "@getpaseo/plugin/otto/project-knowledge";
type Outcome<T> = { ok: true; value: T } | { ok: false; error: { message: string } };
interface RecoveryState {
  plan: KnowledgeLockInspection | null;
  busy: boolean;
  blocked: boolean;
  reason: string;
  verified: boolean;
  error: string;
  success: string;
  generation: number;
}
interface RecoveryPorts {
  inspect(): Promise<Outcome<KnowledgeLockInspection>>;
  recover(input: {
    expectedRevision: string;
    reason: string;
    userVerifiedNoActiveWriter: boolean;
  }): Promise<Outcome<{ recoveryName: string }>>;
  changed(): void;
}
/** One human-adjudicated recovery intent, never a store cache or retry loop. */
export class KnowledgeLockRecoveryModel {
  private state: RecoveryState = {
    plan: null,
    busy: false,
    blocked: false,
    reason: "",
    verified: false,
    error: "",
    success: "",
    generation: 0,
  };
  private listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  private closed = false;
  constructor(private readonly ports: RecoveryPorts) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  activate() {
    this.closed = false;
  }
  setActive(active: boolean) {
    if (this.active && !active) this.authority++;
    this.active = active;
  }
  close() {
    this.authority++;
    this.active = false;
    this.closed = true;
    this.listeners.clear();
  }
  setReason(reason: string) {
    if (!this.state.busy && !this.closed) {
      this.authority++;
      this.publish({ ...this.state, reason });
    }
  }
  verify(verified: boolean) {
    if (!this.state.busy && !this.closed) {
      this.authority++;
      this.publish({ ...this.state, verified });
    }
  }
  private admitted(authority: number) {
    return !this.closed && this.active && !this.state.busy && this.authority === authority;
  }
  async inspect() {
    const authority = this.authority;
    if (!this.admitted(authority)) return;
    this.publish({ ...this.state, busy: true, error: "", success: "" });
    try {
      const result = await this.ports.inspect();
      if (this.closed) return;
      if (authority !== this.authority) {
        this.publish({ ...this.state, busy: false });
        return;
      }
      if (!result.ok) {
        this.publish({ ...this.state, busy: false, blocked: true, error: result.error.message });
        return;
      }
      this.authority++;
      this.publish({
        ...this.state,
        plan: result.value,
        busy: false,
        blocked: false,
        verified: false,
      });
    } catch {
      if (!this.closed)
        this.publish({
          ...this.state,
          busy: false,
          blocked: authority === this.authority ? true : this.state.blocked,
          error:
            authority === this.authority
              ? "The lock inspection did not complete. No recovery was submitted."
              : this.state.error,
        });
    }
  }
  async recover(confirm: () => Promise<boolean>) {
    const authority = this.authority;
    const { plan, reason, verified, blocked } = this.state;
    if (!this.admitted(authority) || blocked || plan?.state !== "unverified") return;
    if (!verified || !reason.trim()) {
      this.publish({
        ...this.state,
        error:
          "Enter a reason and verify that every Knowledge writer using this store has stopped.",
      });
      return;
    }
    let approved: boolean;
    try {
      approved = await confirm();
    } catch {
      if (this.admitted(authority))
        this.publish({
          ...this.state,
          error: "Confirmation did not complete. No recovery was submitted.",
        });
      return;
    }
    if (!approved || !this.admitted(authority)) return;
    this.publish({ ...this.state, busy: true, error: "", success: "" });
    try {
      const result = await this.ports.recover({
        expectedRevision: plan.revision,
        reason: reason.trim(),
        userVerifiedNoActiveWriter: true,
      });
      if (this.closed) return;
      if (authority !== this.authority) {
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          verified: false,
          error:
            "Recovery settled while this page was hidden. Inspect the store again before another attempt.",
        });
        return;
      }
      if (!result.ok) {
        this.publish({ ...this.state, busy: false, blocked: true, error: result.error.message });
        return;
      }
      this.publish({
        plan: null,
        busy: false,
        blocked: false,
        verified: false,
        reason: "",
        error: "",
        success: `Lock retained as ${result.value.recoveryName}. Reload the affected article before a new explicit write.`,
        generation: this.state.generation + 1,
      });
      this.ports.changed();
    } catch {
      if (!this.closed)
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          verified: false,
          error:
            "The recovery outcome is unknown. Your reason is retained; inspect before another explicit attempt.",
        });
    }
  }
  private publish(state: RecoveryState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

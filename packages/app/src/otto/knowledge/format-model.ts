import type { KnowledgeFormatPlan } from "@getpaseo/plugin/otto/project-knowledge";
type Outcome<T> = { ok: true; value: T } | { ok: false; error: { message: string } };
interface FormatState {
  generation: number;
  plan: KnowledgeFormatPlan | null;
  busy: boolean;
  blocked: boolean;
  reason: string;
  error: string;
  success: string;
}
/** Owns one explicit conversion preview, never a canonical store or host cache. */
export class KnowledgeFormatModel {
  private state: FormatState = {
    generation: 0,
    plan: null,
    busy: false,
    blocked: false,
    reason: "",
    error: "",
    success: "",
  };
  private listeners = new Set<() => void>();
  private active = false;
  private closed = false;
  private authority = 0;
  constructor(
    private readonly ports: {
      inspect(): Promise<Outcome<KnowledgeFormatPlan>>;
      apply(input: {
        expectedRevision: string;
        reason: string;
      }): Promise<Outcome<{ converted: number; recoveryPath: string }>>;
      changed(): void;
    },
  ) {}
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
    this.closed = true;
    this.active = false;
    this.authority++;
    this.listeners.clear();
  }
  getAuthority() {
    return this.authority;
  }
  setReason(reason: string) {
    if (!this.closed && !this.state.busy) this.publish({ ...this.state, reason });
  }
  private admitted(authority: number) {
    return !this.closed && this.active && authority === this.authority && !this.state.busy;
  }
  async inspect(authority = this.authority) {
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
        generation: this.state.generation + 1,
        plan: result.value,
        busy: false,
        blocked: false,
        reason: "",
        error: "",
        success: "",
      });
    } catch {
      if (!this.closed)
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          error:
            authority === this.authority
              ? "The conversion preview could not be read. No conversion was submitted."
              : this.state.error,
        });
    }
  }
  async apply(authority = this.authority) {
    const { plan, reason, blocked } = this.state;
    if (!this.admitted(authority) || blocked || !plan?.required) return;
    if (!reason.trim()) {
      this.publish({ ...this.state, error: "Enter a reason for this conversion." });
      return;
    }
    this.publish({ ...this.state, busy: true, error: "", success: "" });
    try {
      const result = await this.ports.apply({
        expectedRevision: plan.revision,
        reason: reason.trim(),
      });
      if (this.closed) return;
      if (authority !== this.authority) {
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          error:
            "Conversion settled while this page was hidden. Your reason is retained; inspect again before another attempt.",
        });
        return;
      }
      if (!result.ok) {
        this.publish({ ...this.state, busy: false, blocked: true, error: result.error.message });
        return;
      }
      this.publish({
        ...this.state,
        plan: null,
        reason: "",
        busy: false,
        blocked: false,
        success: `${result.value.converted} records converted. Recovery bytes: ${result.value.recoveryPath}`,
      });
      this.ports.changed();
    } catch {
      if (!this.closed)
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          error:
            "The conversion outcome is unknown. Your reason is retained; inspect the store before another explicit attempt.",
        });
    }
  }
  private publish(state: FormatState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

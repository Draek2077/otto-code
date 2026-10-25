import type {
  KnowledgeStorageSetup,
  KnowledgeStorageChoice,
} from "@getpaseo/plugin/otto/project-knowledge";
type Outcome<T> = { ok: true; value: T } | { ok: false; error: { message: string } };
interface SetupState {
  plan: KnowledgeStorageSetup | null;
  choice: KnowledgeStorageChoice | null;
  busy: boolean;
  blocked: boolean;
  error: string;
}
/** A captured inspection and explicit choice, never a second canonical host store. */
export class KnowledgeSetupModel {
  private state: SetupState = { plan: null, choice: null, busy: false, blocked: false, error: "" };
  private active = false;
  private closed = false;
  private authority = 0;
  private listeners = new Set<() => void>();
  constructor(
    private readonly ports: {
      inspect(): Promise<Outcome<KnowledgeStorageSetup>>;
      bind(input: {
        expectedRevision: string;
        choice: KnowledgeStorageChoice;
      }): Promise<Outcome<{ directoryName: string | null }>>;
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
  close() {
    this.closed = true;
    this.setActive(false);
    this.listeners.clear();
  }
  setActive(active: boolean) {
    if (this.active && !active) this.authority++;
    this.active = active;
  }
  getAuthority() {
    return this.authority;
  }
  choose(value: string) {
    if (!this.active || this.closed || this.state.busy || !this.state.plan?.required) return;
    let choice: KnowledgeStorageChoice | null = null;
    if (value === "__new__") choice = { kind: "new" };
    else if (value === "__repository__") choice = { kind: "repository" };
    else if (this.state.plan.candidates.some((candidate) => candidate.directoryName === value))
      choice = { kind: "retained", directoryName: value };
    if (JSON.stringify(choice) !== JSON.stringify(this.state.choice)) this.authority++;
    this.publish({ ...this.state, choice });
  }
  private admitted(authority: number) {
    return this.active && !this.closed && !this.state.busy && authority === this.authority;
  }
  async inspect(authority = this.authority) {
    if (!this.admitted(authority)) return;
    this.publish({ ...this.state, busy: true, error: "" });
    try {
      const result = await this.ports.inspect();
      if (this.closed) return;
      if (authority !== this.authority) {
        this.publish({ ...this.state, busy: false });
        return;
      }
      if (!result.ok) {
        this.fail(result.error.message);
        return;
      }
      this.authority++;
      this.publish({ plan: result.value, choice: null, busy: false, blocked: false, error: "" });
    } catch {
      if (!this.closed)
        this.fail(
          "Host stores could not be inspected. Existing bindings and files have not been discarded.",
        );
    }
  }
  async bind(authority = this.authority) {
    const { plan, choice, blocked } = this.state;
    if (!this.admitted(authority) || !plan?.required || !choice || blocked) return;
    this.publish({ ...this.state, busy: true, error: "" });
    try {
      const result = await this.ports.bind({ expectedRevision: plan.revision, choice });
      if (this.closed) return;
      if (authority !== this.authority) {
        this.fail(
          "Setup settled while hidden. Inspect the saved binding before another explicit attempt.",
        );
        return;
      }
      if (!result.ok) {
        this.fail(result.error.message);
        return;
      }
      this.publish({ plan: null, choice: null, busy: false, blocked: false, error: "" });
      this.ports.changed();
    } catch {
      if (!this.closed)
        this.fail(
          "The setup outcome is unknown. The allocated identity may already be saved; reload Knowledge before another attempt.",
        );
    }
  }
  private fail(error: string) {
    this.publish({ ...this.state, busy: false, blocked: true, error });
  }
  private publish(state: SetupState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

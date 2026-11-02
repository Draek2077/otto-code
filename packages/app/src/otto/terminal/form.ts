import type {
  TerminalSettings,
  TerminalPreferences,
  TerminalDiagnostic,
} from "@getpaseo/plugin/otto/terminal";

export interface TerminalSettingsPort {
  read(): Promise<TerminalSettings>;
  save(revision: string, patch: Partial<TerminalPreferences>): Promise<TerminalSettings>;
  diagnose(): Promise<TerminalDiagnostic>;
}
export interface TerminalFormState {
  data: TerminalSettings | null;
  draft: TerminalPreferences | null;
  phase: "loading" | "ready" | "saving" | "blocked";
  error: string | null;
  diagnostic: TerminalDiagnostic | null;
  diagnosticPending: boolean;
  diagnosticError: string | null;
  saved: boolean;
}
/** Local draft authority only. The host owns settings, launch policy and diagnostics. */
export class TerminalForm {
  private state: TerminalFormState = {
    data: null,
    draft: null,
    phase: "loading",
    error: null,
    diagnostic: null,
    diagnosticPending: false,
    diagnosticError: null,
    saved: false,
  };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private active = false;
  constructor(private readonly port: TerminalSettingsPort) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<TerminalFormState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    void this.reload();
    return () => {
      this.active = false;
      this.generation++;
    };
  }
  async reload() {
    if (!this.active || this.state.phase === "saving") return;
    const generation = ++this.generation;
    this.publish({ phase: "loading", error: null, diagnosticPending: false });
    try {
      const data = await this.port.read();
      if (this.active && generation === this.generation)
        this.publish({ data, draft: data.preferences, phase: "ready", saved: false });
    } catch (error) {
      if (this.active && generation === this.generation)
        this.publish({ phase: "blocked", error: this.message(error) });
    }
  }
  edit(patch: Partial<TerminalPreferences>) {
    if (!this.state.draft || this.state.phase === "saving") return;
    this.publish({ draft: { ...this.state.draft, ...patch }, saved: false });
  }
  async save() {
    const { data, draft, phase } = this.state;
    if (!this.active || !data || !draft || phase !== "ready") return;
    const patch: Partial<TerminalPreferences> = {};
    if (draft.terminalTitleMode !== data.preferences.terminalTitleMode)
      patch.terminalTitleMode = draft.terminalTitleMode;
    if (draft.terminalTitleIncludePaths !== data.preferences.terminalTitleIncludePaths)
      patch.terminalTitleIncludePaths = draft.terminalTitleIncludePaths;
    if (draft.defaultTerminalShell !== data.preferences.defaultTerminalShell)
      patch.defaultTerminalShell = draft.defaultTerminalShell;
    if (Object.keys(patch).length === 0) return;
    const generation = this.generation;
    this.publish({ phase: "saving", error: null, saved: false });
    try {
      const accepted = await this.port.save(data.revision, patch);
      if (this.active && generation === this.generation)
        this.publish({ data: accepted, draft: accepted.preferences, phase: "ready", saved: true });
    } catch (error) {
      if (this.active && generation === this.generation)
        this.publish({ phase: "blocked", error: this.message(error) });
    }
  }
  async diagnose() {
    if (!this.active || this.state.diagnosticPending) return;
    const generation = this.generation;
    this.publish({ diagnosticPending: true, diagnosticError: null });
    try {
      const diagnostic = await this.port.diagnose();
      if (this.active && generation === this.generation)
        this.publish({ diagnostic, diagnosticPending: false });
    } catch (error) {
      if (this.active && generation === this.generation)
        this.publish({ diagnosticPending: false, diagnosticError: this.message(error) });
    }
  }
  private message(error: unknown) {
    return error instanceof Error
      ? error.message
      : "The host could not complete the terminal operation.";
  }
}

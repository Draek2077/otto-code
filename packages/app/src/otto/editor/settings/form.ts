import type { EditorPreferences, EditorSettings } from "@getpaseo/plugin/otto/editor";

export interface EditorSettingsPort {
  read(): Promise<EditorSettings>;
  save(revision: string, patch: Partial<EditorPreferences>): Promise<EditorSettings>;
}
interface Snapshot {
  phase: "loading" | "ready" | "saving" | "blocked";
  saved: EditorSettings | null;
  draft: EditorPreferences | null;
  error: string | null;
  dirty: boolean;
}
function equal(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** One revision origin and one writer per open form. A failed/hidden write is
 * never rebased against a later peer snapshot or retried automatically. */
export class EditorSettingsForm {
  private snapshot: Snapshot = {
    phase: "loading",
    saved: null,
    draft: null,
    error: null,
    dirty: false,
  };
  private listeners = new Set<() => void>();
  private activation = 0;
  private active = false;
  private pending = false;
  constructor(private readonly port: EditorSettingsPort) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    this.activation++;
    if (!this.snapshot.saved && !this.pending) void this.reload();
    return () => {
      this.active = false;
      this.activation++;
      if (this.pending)
        this.publish({
          phase: "blocked",
          error: "Settings may have changed. Reload before saving again.",
        });
    };
  }
  edit(patch: Partial<EditorPreferences>) {
    const { draft, saved, phase } = this.snapshot;
    if (!draft || !saved || phase === "loading") return;
    const next = { ...draft, ...patch };
    this.publish({ draft: next, dirty: !equal(next, saved.preferences) });
  }
  async reload() {
    if (this.pending || !this.active) return;
    const activation = this.activation;
    this.publish({ phase: "loading", error: null });
    try {
      const saved = await this.port.read();
      if (this.active && this.activation === activation)
        this.publish({ saved, draft: saved.preferences, phase: "ready", dirty: false });
    } catch (error) {
      if (this.active && this.activation === activation)
        this.publish({ phase: "blocked", error: message(error) });
    }
  }
  async save() {
    const { saved, draft, phase } = this.snapshot;
    if (!saved || !draft || this.pending || phase !== "ready" || !this.active) return;
    const activation = this.activation;
    this.pending = true;
    this.publish({ phase: "saving", error: null });
    try {
      const accepted = await this.port.save(saved.revision, draft);
      if (!this.active || activation !== this.activation) return;
      const current = this.snapshot.draft ?? draft;
      const next = mergeAcknowledgment(current, draft, accepted.preferences);
      this.publish({
        saved: accepted,
        draft: next,
        phase: "ready",
        dirty: !equal(next, accepted.preferences),
      });
    } catch (error) {
      if (this.active && activation === this.activation)
        this.publish({ phase: "blocked", error: message(error) });
    } finally {
      this.pending = false;
    }
  }
}
function mergeAcknowledgment(
  current: EditorPreferences,
  submitted: EditorPreferences,
  accepted: EditorPreferences,
): EditorPreferences {
  return {
    enabled: current.enabled === submitted.enabled ? accepted.enabled : current.enabled,
    languages: equal(current.languages, submitted.languages)
      ? accepted.languages
      : current.languages,
    csharpProjectScope:
      current.csharpProjectScope === submitted.csharpProjectScope
        ? accepted.csharpProjectScope
        : current.csharpProjectScope,
    maxRunningServers:
      current.maxRunningServers === submitted.maxRunningServers
        ? accepted.maxRunningServers
        : current.maxRunningServers,
    idleMinutes:
      current.idleMinutes === submitted.idleMinutes ? accepted.idleMinutes : current.idleMinutes,
    backgroundIdleMinutes:
      current.backgroundIdleMinutes === submitted.backgroundIdleMinutes
        ? accepted.backgroundIdleMinutes
        : current.backgroundIdleMinutes,
    solutionEnabled:
      current.solutionEnabled === submitted.solutionEnabled
        ? accepted.solutionEnabled
        : current.solutionEnabled,
    solutionMaxProbes:
      current.solutionMaxProbes === submitted.solutionMaxProbes
        ? accepted.solutionMaxProbes
        : current.solutionMaxProbes,
    solutionIdleMinutes:
      current.solutionIdleMinutes === submitted.solutionIdleMinutes
        ? accepted.solutionIdleMinutes
        : current.solutionIdleMinutes,
    dotnetMaxProcesses:
      current.dotnetMaxProcesses === submitted.dotnetMaxProcesses
        ? accepted.dotnetMaxProcesses
        : current.dotnetMaxProcesses,
  };
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Code settings could not be saved. Reload to check the host.";
}

import type { GitFetchPreferences, GitFetchSettings } from "@getpaseo/plugin/otto/workspace-git";
import { gitFetchError, type GitFetchPort } from "./port";

interface State {
  phase: "loading" | "ready" | "saving" | "blocked";
  saved: GitFetchSettings | null;
  draft: GitFetchPreferences | null;
  dirty: boolean;
  notice: string | null;
}
/** Local explicit-save draft only. No polling, configuration cache or automatic writes. */
export class GitFetchForm {
  private state: State = { phase: "loading", saved: null, draft: null, dirty: false, notice: null };
  private readonly listeners = new Set<() => void>();
  private authority: object | null = null;
  private busy = false;
  constructor(private readonly port: Pick<GitFetchPort, "read" | "save">) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    const authority = {};
    this.authority = authority;
    if (!this.state.saved && !this.busy) void this.read(authority);
    return () => {
      if (this.authority !== authority) return;
      this.authority = null;
      if (this.busy)
        this.publish({
          phase: "blocked",
          notice: "The operation may have finished on the host. Reload settings before saving.",
        });
    };
  }
  edit(patch: Partial<GitFetchPreferences>) {
    if (
      !this.authority ||
      this.busy ||
      this.state.phase !== "ready" ||
      !this.state.draft ||
      !this.state.saved
    )
      return;
    const draft = { ...this.state.draft, ...patch };
    const saved = this.state.saved.preferences;
    this.publish({
      draft,
      dirty: draft.enabled !== saved.enabled || draft.intervalSeconds !== saved.intervalSeconds,
      notice: null,
    });
  }
  private async read(authority: object) {
    this.busy = true;
    this.publish({ phase: "loading", notice: null });
    try {
      const saved = await this.port.read();
      if (this.authority === authority)
        this.publish({ saved, draft: { ...saved.preferences }, dirty: false, phase: "ready" });
    } catch (error) {
      if (this.authority === authority)
        this.publish({ phase: "blocked", notice: gitFetchError(error) });
    } finally {
      this.busy = false;
    }
  }
  async reload(confirm: () => Promise<boolean>) {
    const authority = this.authority;
    if (!authority || this.busy) return;
    if (this.state.dirty && !(await confirm())) return;
    if (this.authority === authority && !this.busy) await this.read(authority);
  }
  async save() {
    const { saved, draft, dirty, phase } = this.state;
    const authority = this.authority;
    if (!authority || this.busy || phase !== "ready" || !dirty || !saved || !draft) return;
    const patch: Partial<GitFetchPreferences> = {};
    if (draft.enabled !== saved.preferences.enabled) patch.enabled = draft.enabled;
    if (draft.intervalSeconds !== saved.preferences.intervalSeconds)
      patch.intervalSeconds = draft.intervalSeconds;
    this.busy = true;
    this.publish({ phase: "saving", notice: null });
    try {
      const accepted = await this.port.save(saved.revision, patch);
      if (this.authority === authority)
        this.publish({
          saved: accepted,
          draft: { ...accepted.preferences },
          dirty: false,
          phase: "ready",
          notice: "Git fetch settings saved.",
        });
    } catch (error) {
      if (this.authority === authority)
        this.publish({ phase: "blocked", notice: gitFetchError(error) });
    } finally {
      this.busy = false;
    }
  }
}

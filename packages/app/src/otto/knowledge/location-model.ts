import type { KnowledgeCatalog } from "@getpaseo/plugin/otto/project-knowledge";
interface LocationState {
  location: "repository" | "host";
  busy: boolean;
  blocked: boolean;
  error: string;
}
/** One explicit migration draft, pinned to the Project Settings revision when opened. */
export class KnowledgeLocationModel {
  private state: LocationState;
  private closed = false;
  private active = true;
  private authority = 0;
  private completed = false;
  private readonly originRevision: string;
  private listeners = new Set<() => void>();
  constructor(
    readonly seed: KnowledgeCatalog["settings"],
    private readonly submit: (
      location: LocationState["location"],
      revision: string,
    ) => Promise<{ ok: true } | { ok: false; message: string }>,
  ) {
    this.originRevision = seed.revision;
    this.state = { location: seed.location, busy: false, blocked: false, error: "" };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  select(location: LocationState["location"]) {
    if (!this.closed && !this.state.busy) this.publish({ ...this.state, location });
  }
  close() {
    this.closed = true;
    this.active = false;
    this.authority += 1;
    this.listeners.clear();
  }
  activate() {
    this.closed = false;
    this.active = true;
  }
  getAuthority() {
    return this.authority;
  }
  setActive(active: boolean) {
    if (this.active && !active) this.authority += 1;
    this.active = active;
  }
  async save(authority = this.authority) {
    if (
      this.closed ||
      !this.active ||
      authority !== this.authority ||
      this.state.busy ||
      this.state.blocked ||
      this.completed
    )
      return false;
    this.publish({ ...this.state, busy: true, error: "" });
    try {
      const result = await this.submit(this.state.location, this.originRevision);
      if (this.closed) return false;
      if (authority !== this.authority) {
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          error:
            "The storage write settled while hidden. Reload Project Settings before another attempt.",
        });
        return false;
      }
      this.publish({
        ...this.state,
        busy: false,
        blocked: !result.ok,
        error: result.ok ? "" : result.message,
      });
      this.completed = result.ok;
      return result.ok;
    } catch {
      if (!this.closed)
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          error:
            "The storage change outcome is unknown. Reload Project Settings before another attempt.",
        });
      return false;
    }
  }
  private publish(state: LocationState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

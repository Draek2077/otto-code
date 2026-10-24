import type { KnowledgeHostDefaults } from "@getpaseo/plugin/otto/project-knowledge";
type Outcome =
  | { ok: true; value: KnowledgeHostDefaults }
  | { ok: false; error: { message: string } };
interface HostDefaultState {
  origin: KnowledgeHostDefaults | null;
  location: "repository" | "host";
  busy: boolean;
  blocked: boolean;
  error: string;
  success: string;
}
/** One explicit host preference draft. Peer invalidation never rebases its origin. */
export class KnowledgeHostDefaultModel {
  private state: HostDefaultState = {
    origin: null,
    location: "repository",
    busy: false,
    blocked: false,
    error: "",
    success: "",
  };
  private active = false;
  private closed = false;
  private authority = 0;
  private listeners = new Set<() => void>();
  constructor(
    private readonly ports: {
      read(): Promise<Outcome>;
      save(input: {
        expectedRevision: string;
        defaultStoreLocation: "repository" | "host";
      }): Promise<Outcome>;
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
    this.setActive(false);
    this.closed = true;
    this.listeners.clear();
  }
  setActive(active: boolean) {
    if (this.active && !active) this.authority++;
    this.active = active;
    if (active && !this.state.origin && !this.state.busy && !this.state.error) void this.reload();
  }
  getAuthority() {
    return this.authority;
  }
  select(location: HostDefaultState["location"]) {
    if (!this.closed && this.active && !this.state.busy) this.publish({ ...this.state, location });
  }
  private admitted(authority: number) {
    return !this.closed && this.active && authority === this.authority && !this.state.busy;
  }
  async reload(authority = this.authority) {
    if (!this.admitted(authority)) return;
    this.publish({ ...this.state, busy: true, error: "", success: "" });
    try {
      const result = await this.ports.read();
      if (this.closed) return;
      if (authority !== this.authority) {
        this.publish({ ...this.state, busy: false });
        return;
      }
      if (!result.ok) {
        this.failed(result.error.message);
        return;
      }
      this.authority++;
      this.publish({
        origin: result.value,
        location: result.value.defaultStoreLocation,
        busy: false,
        blocked: false,
        error: "",
        success: "",
      });
    } catch {
      if (!this.closed)
        this.failed(
          "Host defaults could not be read. Your selection is retained; reload explicitly.",
        );
    }
  }
  async save(authority = this.authority) {
    const { origin, location, blocked } = this.state;
    if (!this.admitted(authority) || !origin || blocked || location === origin.defaultStoreLocation)
      return;
    this.publish({ ...this.state, busy: true, error: "", success: "" });
    try {
      const result = await this.ports.save({
        expectedRevision: origin.revision,
        defaultStoreLocation: location,
      });
      if (this.closed) return;
      if (authority !== this.authority) {
        this.failed(
          "The host-default write settled while hidden. Reload before another explicit save.",
        );
        return;
      }
      if (!result.ok) {
        this.failed(result.error.message);
        return;
      }
      this.publish({
        origin: result.value,
        location: result.value.defaultStoreLocation,
        busy: false,
        blocked: false,
        error: "",
        success: "Host default saved. Existing stores remain in place.",
      });
      this.ports.changed();
    } catch {
      if (!this.closed)
        this.failed(
          "The host-default write outcome is unknown. Reload before another explicit save.",
        );
    }
  }
  private failed(error: string) {
    this.publish({ ...this.state, busy: false, blocked: true, error });
  }
  private publish(state: HostDefaultState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export type ArtifactStorageValue = "repository" | "host" | "inherit";
export interface ArtifactStorageSeed {
  value: ArtifactStorageValue;
  revision: string;
}
interface Snapshot extends ArtifactStorageSeed {
  dirty: boolean;
  busy: boolean;
  blocked: boolean;
  message: string;
}
/** One captured revision per explicit settings opening; live query churn never rebases a draft. */
export class ArtifactStorageForm {
  private state: Snapshot;
  private listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  constructor(seed: ArtifactStorageSeed) {
    this.state = { ...seed, dirty: false, busy: false, blocked: false, message: "" };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    const authority = ++this.authority;
    return () => {
      if (authority === this.authority) {
        this.active = false;
        this.authority++;
        if (this.state.busy)
          this.set({
            blocked: true,
            message: "The saved outcome may have changed while hidden. Reload before another save.",
          });
      }
    };
  }
  select(value: ArtifactStorageValue) {
    if (!this.state.busy) this.set({ value, dirty: true });
  }
  async save(write: (seed: ArtifactStorageSeed) => Promise<string>) {
    if (!this.active || this.state.busy || this.state.blocked) return;
    const authority = this.authority,
      seed = { value: this.state.value, revision: this.state.revision };
    this.set({ busy: true, message: "" });
    try {
      const revision = await write(seed);
      if (authority !== this.authority) {
        this.set({ blocked: true });
        return;
      }
      this.set({
        revision,
        dirty: false,
        message: "Storage preference saved. Existing artifacts remain in their original locations.",
      });
    } catch {
      this.set({
        blocked: true,
        message:
          "The host could not acknowledge this save. Your selection is retained. Reload saved settings before trying again.",
      });
    } finally {
      this.set({ busy: false });
    }
  }
  async reload(read: () => Promise<ArtifactStorageSeed>, confirm: () => Promise<boolean>) {
    if (!this.active || this.state.busy) return;
    const authority = this.authority;
    this.set({ busy: true });
    try {
      if ((this.state.dirty || this.state.blocked) && !(await confirm())) return;
      if (authority !== this.authority) return;
      const seed = await read();
      if (authority === this.authority)
        this.set({ ...seed, dirty: false, blocked: false, message: "Saved settings reloaded." });
    } catch {
      this.set({ message: "Saved settings could not be read. Your draft is retained." });
    } finally {
      this.set({ busy: false });
    }
  }
}

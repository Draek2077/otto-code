import { z } from "zod";
export const HostBrowserBindingSchema = z.object({
  version: z.literal(1),
  hostId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(512),
});
export type HostBrowserBinding = z.infer<typeof HostBrowserBindingSchema>;
export type HostBrowserBindingState =
  | { phase: "loading" }
  | { phase: "ready"; value: HostBrowserBinding | null }
  | { phase: "error"; message: string };
interface Entry {
  state: HostBrowserBindingState;
  pending: Promise<void>;
  writing: Promise<void> | null;
  listeners: Set<() => void>;
}
/** Immutable ownership sidecars; Paseo's persisted BrowserRecord shape stays unchanged. */
export class HostBrowserBindings {
  private entries = new Map<string, Entry>();
  constructor(
    private readonly storage: {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
    },
  ) {}
  private key(browserId: string) {
    if (!browserId || browserId.length > 512) throw new Error("Invalid browser identity.");
    return `otto-host-browser-binding-v1/${encodeURIComponent(browserId)}`;
  }
  private publish(entry: Entry, state: HostBrowserBindingState) {
    entry.state = state;
    for (const listener of entry.listeners) listener();
  }
  resource(browserId: string) {
    let entry = this.entries.get(browserId);
    if (!entry) {
      const key = this.key(browserId);
      entry = {
        state: { phase: "loading" },
        pending: Promise.resolve(),
        writing: null,
        listeners: new Set(),
      };
      this.entries.set(browserId, entry);
      entry.pending = this.load(entry, key);
    }
    const resource = entry;
    return {
      getSnapshot: () => resource.state,
      subscribe: (listener: () => void) => {
        resource.listeners.add(listener);
        return () => {
          resource.listeners.delete(listener);
        };
      },
    };
  }
  private async load(entry: Entry, key: string) {
    try {
      const raw = await this.storage.getItem(key);
      if (raw === null) {
        this.publish(entry, { phase: "ready", value: null });
        return;
      }
      if (raw.length > 8192) throw new Error("Oversized browser binding.");
      const value = HostBrowserBindingSchema.parse(JSON.parse(raw));
      this.publish(entry, { phase: "ready", value });
    } catch {
      // Preserve bytes. An uncertain binding must never turn a host tab into an
      // Electron guest using the client's localhost or profile by mistake.
      this.publish(entry, {
        phase: "error",
        message:
          "This browser's host binding could not be read. Its saved data has been preserved.",
      });
    }
  }
  async bind(browserId: string, input: HostBrowserBinding): Promise<void> {
    const binding = HostBrowserBindingSchema.parse(input);
    this.resource(browserId);
    const entry = this.entries.get(browserId)!;
    await entry.pending;
    if (entry.writing) await entry.writing;
    if (entry.state.phase !== "ready") throw new Error("The saved browser binding is unavailable.");
    const old = entry.state.value;
    if (old) {
      if (old.hostId !== binding.hostId || old.workspaceId !== binding.workspaceId)
        throw new Error("This browser belongs to another host or workspace.");
      return;
    }
    const writing = this.storage.setItem(this.key(browserId), JSON.stringify(binding));
    entry.writing = writing;
    try {
      await writing;
      this.publish(entry, { phase: "ready", value: binding });
    } finally {
      if (entry.writing === writing) entry.writing = null;
    }
  }
  async read(browserId: string): Promise<HostBrowserBinding | null> {
    this.resource(browserId);
    const entry = this.entries.get(browserId)!;
    await entry.pending;
    if (entry.writing) await entry.writing;
    if (entry.state.phase !== "ready") throw new Error("The saved browser binding is unavailable.");
    return entry.state.value;
  }
}

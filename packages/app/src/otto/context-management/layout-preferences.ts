export const CONTEXT_LAYOUT_KEY = "otto-context-layout";
export const DEFAULT_CONTEXT_WIDTH = 320;
export interface ContextReadingLayout {
  width: number;
  summaryRatio: number;
}
export function contextReadingWidth(width: number, available: number): number {
  const maximum = Math.max(0, Math.min(720, available - Math.min(360, available / 2)));
  return Math.min(maximum, Math.max(Math.min(240, maximum), width));
}
export function contextSummaryRatio(value: number): number {
  return Math.max(0.2, Math.min(0.8, value));
}
interface StoragePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function decode(raw: string): Record<string, unknown> {
  if (raw.length > 2 * 1024 * 1024)
    throw new Error("Layout preference exceeds its supported size.");
  const value: unknown = JSON.parse(raw);
  if (!object(value)) throw new Error("Layout preference is not an object.");
  return value;
}
function legacyWidth(raw: string | null): number {
  if (raw === null) return DEFAULT_CONTEXT_WIDTH;
  try {
    const saved = decode(raw);
    if (object(saved.state) && finite(saved.state.contextSidebarWidth))
      return Math.max(240, Math.min(720, saved.state.contextSidebarWidth));
  } catch {
    /* An unreadable legacy preference is left intact, not replaced or migrated. */
  }
  return DEFAULT_CONTEXT_WIDTH;
}
/** Own app-local preference only. The dormant 0.9 panel-state is read but never rewritten. */
export class ContextLayoutPreferences {
  private state: ContextReadingLayout & { loaded: boolean; error: string } = {
    width: DEFAULT_CONTEXT_WIDTH,
    summaryRatio: 0.5,
    loaded: false,
    error: "",
  };
  private readonly listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private writes = Promise.resolve();
  private writable = false;
  private envelope: Record<string, unknown> = {};
  constructor(private readonly storage: StoragePort) {}
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  load(): Promise<void> {
    return (this.loading ??= this.read());
  }
  private async read() {
    try {
      const raw = await this.storage.getItem(CONTEXT_LAYOUT_KEY);
      if (raw !== null) {
        const saved = decode(raw);
        if (saved.version !== 1 || !finite(saved.width) || !finite(saved.summaryRatio))
          throw new Error("Unsupported layout preference.");
        this.envelope = saved;
        this.publish({
          width: Math.max(240, Math.min(720, saved.width)),
          summaryRatio: contextSummaryRatio(saved.summaryRatio),
        });
      } else {
        // COMPAT(context09Layout): added v0.10.0; review after 2027-04-26. Preserve the original panel-state bytes and all unrelated fields.
        const legacy = await this.storage.getItem("panel-state");
        this.publish({ width: legacyWidth(legacy) });
      }
      this.writable = true;
    } catch {
      this.publish({
        error:
          "Context layout preferences could not be read. Existing saved data was preserved; this view uses the default layout.",
      });
    } finally {
      this.publish({ loaded: true });
    }
  }
  set(patch: Partial<ContextReadingLayout>): Promise<void> {
    if (!this.state.loaded) return Promise.resolve();
    const width = finite(patch.width)
      ? Math.max(240, Math.min(720, patch.width))
      : this.state.width;
    const summaryRatio = finite(patch.summaryRatio)
      ? contextSummaryRatio(patch.summaryRatio)
      : this.state.summaryRatio;
    this.publish({ width, summaryRatio });
    if (!this.writable) return Promise.resolve();
    const value = { ...this.envelope, version: 1, width, summaryRatio };
    this.writes = this.writes.then(() => this.persist(value));
    return this.writes;
  }
  private async persist(value: Record<string, unknown>) {
    try {
      await this.storage.setItem(CONTEXT_LAYOUT_KEY, JSON.stringify(value));
      this.envelope = value;
      this.publish({ error: "" });
    } catch {
      this.publish({
        error:
          "The layout changed for this view but could not be saved on this device. Adjust the splitter again to retry saving.",
      });
    }
  }
}

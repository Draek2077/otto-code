import type { ContextReport } from "@getpaseo/plugin/otto/context-management";

export const CONTEXT_WARNING_PREFERENCE = "otto-context-warning-preference";
export const CONTEXT_WARNING_MUTE_MS = 8 * 60 * 60 * 1000;
export interface ContextHealthWarning {
  key: string;
  severity: "warning" | "blocked";
  summary: string;
}
export function contextModelWindow(
  observed: number | null | undefined,
  catalog: number | null | undefined,
): number | null {
  if (typeof observed === "number" && Number.isFinite(observed) && observed > 0) return observed;
  return typeof catalog === "number" && Number.isFinite(catalog) && catalog > 0 ? catalog : null;
}
/** Fixed estimates are not conversation usage; an unknown provider window is never invented. */
export function contextHealthWarning(
  report: ContextReport | undefined,
  knownWindow: number | null,
): ContextHealthWarning | null {
  if (!report) return null;
  const blocked = report.instructionState === "blocked";
  const share = knownWindow && knownWindow > 0 ? (report.fixedTokens / knownWindow) * 100 : null;
  if (!blocked && (share === null || share < 25)) return null;
  const severity = blocked || (share !== null && share >= 100) ? "blocked" : "warning";
  const key = `${severity}:${share === null ? "unknown" : Math.floor(share / 5)}`;
  const estimate = report.categories.some((category) => category.visibility === "convention")
    ? "Provider convention estimate"
    : "Measured text estimate";
  const summary =
    share === null
      ? "A required context instruction is unavailable. The provider's model window is unknown."
      : `${estimate}: ${report.fixedTokens.toLocaleString()} fixed tokens, ${share.toFixed(1)}% of this model's window on every request. Conversation history and unknown provider inputs are excluded.`;
  return {
    key,
    severity,
    summary: blocked ? `Required instructions are blocked. ${summary}` : summary,
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
interface StoragePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  legacyEnabled(): Promise<boolean | undefined>;
}
/** Device preference and bounded, workspace-scoped eight-hour mutes only; never a context-report cache. */
export class ContextHealthPreferences {
  private state = {
    enabled: true,
    loaded: false,
    writable: false,
    pending: false,
    error: "",
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private envelope: Record<string, unknown> = {};
  private loading: Promise<void> | null = null;
  private dismissals = new Map<string, { key: string; until: number }>();
  constructor(private readonly storage: StoragePort) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  load() {
    return (this.loading ??= this.read());
  }
  private async read() {
    try {
      const raw = await this.storage.getItem(CONTEXT_WARNING_PREFERENCE);
      if (raw !== null) {
        if (raw.length > 16384) throw new Error("Oversized preference");
        const value: unknown = JSON.parse(raw);
        if (!object(value) || value.version !== 1 || typeof value.enabled !== "boolean")
          throw new Error("Unsupported preference");
        this.envelope = value;
        this.publish({ enabled: value.enabled });
      } else {
        const enabled = await this.storage.legacyEnabled();
        this.publish({ enabled: enabled !== false });
      }
      this.publish({ writable: true, error: "" });
    } catch {
      this.publish({
        error:
          "Context warning preferences could not be read. Saved data is preserved; changes are disabled until explicit reload.",
        writable: false,
      });
    } finally {
      this.publish({ loaded: true });
    }
  }
  async reload() {
    if (!this.state.pending) {
      this.loading = this.read();
      await this.loading;
    }
  }
  async setEnabled(enabled: boolean) {
    if (!this.state.loaded || !this.state.writable || this.state.pending) return;
    this.publish({ pending: true, error: "" });
    try {
      const value = { ...this.envelope, version: 1, enabled };
      await this.storage.setItem(CONTEXT_WARNING_PREFERENCE, JSON.stringify(value));
      this.envelope = value;
      this.publish({ enabled });
    } catch {
      this.publish({
        error:
          "Context warning preference was not saved. Your previous choice remains active; try the explicit change again.",
      });
    } finally {
      this.publish({ pending: false });
    }
  }
  mute(hostId: string, workspaceId: string, warning: ContextHealthWarning, now = Date.now()) {
    const id = JSON.stringify([hostId, workspaceId]);
    this.dismissals.delete(id);
    this.dismissals.set(id, { key: warning.key, until: now + CONTEXT_WARNING_MUTE_MS });
    if (this.dismissals.size > 256) this.dismissals.delete(this.dismissals.keys().next().value!);
    this.publish({ revision: this.state.revision + 1 });
  }
  mutedUntil(
    hostId: string,
    workspaceId: string,
    warning: ContextHealthWarning,
    now = Date.now(),
    observedRevision = this.state.revision,
  ) {
    if (observedRevision !== this.state.revision) return null;
    const value = this.dismissals.get(JSON.stringify([hostId, workspaceId]));
    return value && value.key === warning.key && value.until > now ? value.until : null;
  }
}

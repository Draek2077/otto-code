import type { Profile } from "../config/schema.js";
import type { BrainTuiHost, TuiModel } from "./host.js";
import { requestHost, TuiActionError } from "./host.js";

/** Edits survive status events and failed writes. A conflict requires explicit
 * reload; it must never silently overwrite a profile changed by another client. */
export class ProfileDraft {
  profile: Profile;
  revision: string;
  private patch: Record<string, unknown> = {};
  private pending: Promise<void> | null = null;
  private epoch = 0;
  error: string | null = null;

  constructor(row: TuiModel) {
    this.profile = structuredClone(row.profile);
    this.revision = row.revision;
  }
  get dirty(): boolean {
    return Object.keys(this.patch).length > 0 || this.pending !== null;
  }
  get saving(): boolean {
    return this.pending !== null;
  }
  read(key: string): unknown {
    return this.profile[key];
  }
  write(key: string, value: unknown): void {
    this.profile = { ...this.profile, [key]: value };
    this.patch[key] = value;
  }
  receive(row: TuiModel): void {
    if (this.dirty || this.error) return;
    this.profile = structuredClone(row.profile);
    this.revision = row.revision;
  }
  discard(row: TuiModel): void {
    // Invalidates an outstanding response after a host-instance change.
    this.epoch += 1;
    this.patch = {};
    this.error = null;
    this.profile = structuredClone(row.profile);
    this.revision = row.revision;
  }
  save(host: BrainTuiHost, modelId: string, signal: AbortSignal): Promise<void> {
    if (this.pending) return this.pending;
    if (this.error) return Promise.reject(new TuiActionError("conflict", this.error));
    const epoch = this.epoch;
    const instanceId = host.getSnapshot().instanceId;
    const flush = async (): Promise<void> => {
      while (Object.keys(this.patch).length) {
        const sent = this.patch;
        this.patch = {};
        try {
          await requestHost(
            host,
            { type: "profile.save", modelId, patch: sent, expectedRevision: this.revision },
            signal,
          );
        } catch (error) {
          if (epoch !== this.epoch) return;
          this.patch = { ...sent, ...this.patch };
          this.error =
            error instanceof TuiActionError ? error.message : "The profile could not be saved.";
          throw error;
        }
        if (epoch !== this.epoch || instanceId !== host.getSnapshot().instanceId) return;
        const row = host.getSnapshot().models.find((entry) => entry.model.id === modelId);
        if (!row) {
          this.patch = { ...sent, ...this.patch };
          this.error = "The selected model is no longer available.";
          throw new TuiActionError("conflict", this.error);
        }
        this.revision = row.revision;
        this.profile = { ...structuredClone(row.profile), ...this.patch };
        this.error = null;
      }
    };
    this.pending = flush().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

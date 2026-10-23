import type {
  BrainProfile,
  BrainProfileField,
  BrainProfilePatch,
  BrainProfileRead,
  BrainProfileSaved,
} from "../contracts/models";

export type ProfileDraftValue = string | number | boolean | null;
export type ProfileDraft = Record<string, ProfileDraftValue>;

/** Shared by the editor's budget preview and its debounced profile writes. */
export const PROFILE_EDIT_DEBOUNCE_MS = 250;

// These choices have their own dialog, so the host does not list them as fields.
const HOSTING_KEYS = ["hostingProfileMode", "hostingProfileId"] as const;

function buildDraft(profile: BrainProfile | null, fields: BrainProfileField[]): ProfileDraft {
  const draft: ProfileDraft = {};
  for (const key of [...fields.map((field) => field.key), ...HOSTING_KEYS]) {
    const value = profile?.[key];
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      draft[key] = value;
    }
  }
  return draft;
}

function draftsMatch(a: ProfileDraft, b: ProfileDraft): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => a[key] === b[key]);
}

function acknowledgeDraft(
  current: ProfileDraft,
  submitted: ProfileDraft,
  accepted: ProfileDraft,
): ProfileDraft {
  if (draftsMatch(current, submitted)) return accepted;
  const next = { ...accepted };
  for (const key of new Set([...Object.keys(current), ...Object.keys(submitted)])) {
    if (current[key] !== submitted[key]) next[key] = current[key];
  }
  return next;
}

function changedHostingKeys(draft: ProfileDraft, saved: ProfileDraft): ProfileDraft {
  const patch = { ...draft };
  for (const key of HOSTING_KEYS) {
    // Resending an unchanged selection could fail if a peer deleted that profile.
    if (patch[key] === saved[key]) delete patch[key];
  }
  return patch;
}

export function profileDraftToOverrides(draft: ProfileDraft): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (HOSTING_KEYS.some((hostingKey) => key === hostingKey) || value === null) continue;
    overrides[key] = String(value);
  }
  return overrides;
}

export interface ProfileDraftSnapshot {
  profile: BrainProfileRead | null;
  draft: ProfileDraft;
  enabledComponents: string[];
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  saveBlocked: boolean;
  externalChange: boolean;
}

type ProfileApplied =
  | { kind: "read"; result: BrainProfileRead; acceptedDraft: ProfileDraft }
  | { kind: "save"; result: BrainProfileSaved; acceptedDraft: ProfileDraft };

interface ProfileDraftPort {
  readProfile: (modelId: string) => Promise<BrainProfileRead>;
  saveProfile: (
    modelId: string,
    patch: BrainProfilePatch,
    expectedRevision: string,
  ) => Promise<BrainProfileSaved>;
}

// Object identity is the authority. A later activation cannot revive an old reply.
interface Activation {
  active: boolean;
}

/**
 * Local graphical draft state only. The injected host still owns saved profiles.
 * Reads replace a draft only on initial load or explicit confirmed reload. Every
 * write uses that draft's revision and the same lock, including dialog actions.
 */
export class ProfileDraftController {
  private snapshot: ProfileDraftSnapshot = {
    profile: null,
    draft: {},
    enabledComponents: [],
    loading: true,
    saving: false,
    dirty: false,
    error: null,
    saveBlocked: false,
    externalChange: false,
  };
  private savedDraft: ProfileDraft = {};
  private savedComponents: string[] = [];
  private listeners = new Set<() => void>();
  private activation: Activation | null = null;
  private reading: Activation | null = null;
  private writing: Activation | null = null;
  private writable = false;
  private autosave: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly modelId: string,
    private readonly port: ProfileDraftPort,
    private readonly onApplied: (event: ProfileApplied) => void,
  ) {}

  getSnapshot = (): ProfileDraftSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  activate(): () => void {
    if (this.activation) this.deactivate(this.activation);
    const activation: Activation = { active: true };
    this.activation = activation;
    if (this.snapshot.profile === null) void this.read(activation);
    else this.scheduleAutosave();
    return () => this.deactivate(activation);
  }

  setWritable(writable: boolean): void {
    this.writable = writable;
    this.scheduleAutosave();
  }

  edit(patch: ProfileDraft): void {
    this.publish({ ...this.snapshot, draft: { ...this.snapshot.draft, ...patch } });
  }

  toggleComponent(id: string, enabled: boolean): void {
    const current = this.snapshot.enabledComponents;
    this.publish({
      ...this.snapshot,
      enabledComponents: enabled
        ? [...new Set([...current, id])]
        : current.filter((entry) => entry !== id),
    });
  }

  noteExternalChange(): void {
    this.publish({ ...this.snapshot, externalChange: true });
  }

  async reload(confirm: () => Promise<boolean>, onConfirmed?: () => void): Promise<boolean> {
    const activation = this.activation;
    if (!activation || this.writing || this.reading) return false;
    const confirmed = await confirm();
    if (!confirmed || !this.isCurrent(activation) || this.writing || this.reading) return false;
    onConfirmed?.();
    return this.read(activation);
  }

  async save(
    patch: BrainProfilePatch = {},
    confirm?: () => Promise<boolean>,
  ): Promise<BrainProfileSaved | null> {
    const activation = this.activation;
    if (!activation || !this.canSave()) return null;
    if (confirm && !(await confirm())) return null;
    if (!this.isCurrent(activation) || !this.canSave()) return null;
    const submitted = this.snapshot;
    if (!submitted.profile) return null;
    this.writing = activation;
    this.publish({ ...submitted, saving: true, error: null });
    try {
      const result = await this.port.saveProfile(
        this.modelId,
        {
          ...changedHostingKeys(submitted.draft, this.savedDraft),
          enabledComponents: submitted.enabledComponents,
          ...patch,
        },
        submitted.profile.revision,
      );
      if (!this.isCurrent(activation)) return null;
      const acceptedDraft = buildDraft(result.profile, result.fields);
      const enabled = result.profile?.enabledComponents ?? [];
      this.savedDraft = acceptedDraft;
      this.savedComponents = enabled;
      this.publish({
        ...this.snapshot,
        profile: result,
        draft: acknowledgeDraft(this.snapshot.draft, submitted.draft, acceptedDraft),
        enabledComponents:
          this.snapshot.enabledComponents === submitted.enabledComponents
            ? enabled
            : this.snapshot.enabledComponents,
        error: result.adjustments.length > 0 ? result.adjustments.join("; ") : null,
      });
      this.onApplied({ kind: "save", result, acceptedDraft });
      return result;
    } catch (error) {
      if (this.isCurrent(activation)) {
        const message = error instanceof Error ? error.message : String(error);
        this.publish({
          ...this.snapshot,
          saveBlocked: true,
          error: `Changes were not saved. ${message} Your draft has been kept. Reload the saved profile to continue saving.`,
        });
      }
      return null;
    } finally {
      this.writing = null;
      this.publish({ ...this.snapshot, saving: false });
    }
  }

  private isCurrent(activation: Activation): boolean {
    return activation.active && this.activation === activation;
  }

  private deactivate(activation: Activation): void {
    activation.active = false;
    if (this.activation !== activation) return;
    this.activation = null;
    this.reading = null;
    // The request may have committed on its host. Preserve the draft, but never
    // retry its old revision automatically after ignoring the hidden response.
    this.publish({
      ...this.snapshot,
      loading: false,
      saveBlocked: this.snapshot.saveBlocked || this.writing !== null,
      externalChange: this.snapshot.externalChange || this.writing !== null,
    });
  }

  private async read(activation: Activation): Promise<boolean> {
    if (!this.isCurrent(activation) || this.reading || this.writing) return false;
    this.reading = activation;
    this.publish({ ...this.snapshot, loading: true });
    try {
      const result = await this.port.readProfile(this.modelId);
      if (!this.isCurrent(activation) || this.reading !== activation) return false;
      const acceptedDraft = buildDraft(result.profile, result.fields);
      const enabled = result.profile?.enabledComponents ?? [];
      this.savedDraft = acceptedDraft;
      this.savedComponents = enabled;
      this.reading = null;
      this.publish({
        ...this.snapshot,
        profile: result,
        draft: acceptedDraft,
        enabledComponents: enabled,
        loading: false,
        error: null,
        saveBlocked: false,
        externalChange: false,
      });
      this.onApplied({ kind: "read", result, acceptedDraft });
      return true;
    } catch (error) {
      if (this.isCurrent(activation) && this.reading === activation) {
        this.reading = null;
        this.publish({
          ...this.snapshot,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  }

  private canSave(): boolean {
    return (
      this.activation !== null &&
      this.writable &&
      !this.reading &&
      !this.writing &&
      !this.snapshot.loading &&
      !this.snapshot.saveBlocked &&
      this.snapshot.profile !== null
    );
  }

  private publish(next: ProfileDraftSnapshot): void {
    this.snapshot = {
      ...next,
      dirty:
        !draftsMatch(next.draft, this.savedDraft) ||
        next.enabledComponents.join("\0") !== this.savedComponents.join("\0"),
    };
    this.scheduleAutosave();
    for (const listener of this.listeners) listener();
  }

  private scheduleAutosave(): void {
    if (this.autosave !== null) clearTimeout(this.autosave);
    this.autosave = null;
    if (!this.canSave() || !this.snapshot.dirty) return;
    this.autosave = setTimeout(() => {
      this.autosave = null;
      void this.save();
    }, PROFILE_EDIT_DEBOUNCE_MS);
  }
}

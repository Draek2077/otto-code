import {
  ArtifactCommand as CommandSchema,
  type ArtifactDocument,
  type ArtifactCommand,
  type ArtifactScope,
  type ArtifactSummary,
  type ArtifactRef,
} from "@getpaseo/plugin/otto/artifacts";

/** One draft per contributed surface and artifact. The plugin's Paseo API is
 * shared by every surface, so it cannot identify an editor's lifetime alone. */
export function artifactEditorKey(surface: string, reference: ArtifactRef) {
  return JSON.stringify([surface, reference]);
}

export interface ArtifactModelSelection {
  provider: string;
  model: string;
  providerLabel: string;
  modelLabel: string;
}

export interface ArtifactFields {
  name: string;
  description: string;
  json: string;
  instruction: string;
  provider: string;
  model: string;
}
export interface ArtifactDraftSnapshot {
  document: ArtifactDocument;
  latest: ArtifactDocument;
  fields: ArtifactFields;
  busy: boolean;
  blocked: boolean;
  error: string;
  notice: string;
  dirty: boolean;
  epoch: number;
  selection: ArtifactModelSelection | null;
}
/** Local draft authority only. Canonical reads and generation status remain in the app query layer. */
export class ArtifactDraft {
  private listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  private state: ArtifactDraftSnapshot;
  constructor(document: ArtifactDocument) {
    this.state = {
      document,
      latest: document,
      fields: this.fields(document),
      busy: false,
      blocked: false,
      error: "",
      notice: "",
      dirty: false,
      epoch: 0,
      selection:
        document.artifact.provider && document.artifact.model
          ? {
              provider: document.artifact.provider,
              model: document.artifact.model,
              providerLabel: document.artifact.provider,
              modelLabel: document.artifact.model,
            }
          : null,
    };
  }
  private fields(document: ArtifactDocument): ArtifactFields {
    const a = document.artifact;
    return {
      name: a.name,
      description: a.description,
      json: document.data ?? "",
      instruction: a.description,
      provider: a.provider ?? "",
      model: a.model ?? "",
    };
  }
  private selection(document: ArtifactDocument): ArtifactModelSelection | null {
    const { provider, model } = document.artifact;
    if (!provider || !model) return null;
    const previous = this.state.selection;
    return previous?.provider === provider && previous.model === model
      ? previous
      : { provider, model, providerLabel: provider, modelLabel: model };
  }
  getSnapshot = () => this.state;
  canEvict() {
    return (
      !this.active &&
      !this.listeners.size &&
      !this.state.dirty &&
      !this.state.busy &&
      !this.state.blocked
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<ArtifactDraftSnapshot>) {
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
            notice:
              "An operation may have completed while hidden. Reload saved output before another change.",
          });
      }
    };
  }
  edit(key: keyof ArtifactFields, value: string) {
    if (!this.state.busy) this.set({ fields: { ...this.state.fields, [key]: value }, dirty: true });
  }
  selectModel(selection: ArtifactModelSelection | null) {
    if (!this.state.busy)
      this.set({
        selection,
        fields: {
          ...this.state.fields,
          provider: selection?.provider ?? "",
          model: selection?.model ?? "",
        },
        dirty: true,
      });
  }
  external(document: ArtifactDocument) {
    if (document.artifact.revision === this.state.document.artifact.revision) return;
    if (this.active && !this.state.dirty && !this.state.busy && !this.state.blocked)
      this.set({
        document,
        latest: document,
        fields: this.fields(document),
        selection: this.selection(document),
        epoch: this.state.epoch + 1,
      });
    else
      this.set({
        latest: document,
        notice: "Saved output changed. Your draft is retained; reload to use the new revision.",
      });
  }
  async reload(
    read: () => Promise<ArtifactDocument>,
    confirm: () => Promise<boolean>,
  ): Promise<boolean> {
    if (this.state.busy || !this.active) return false;
    const authority = this.authority;
    this.set({ busy: true, error: "" });
    try {
      if ((this.state.dirty || this.state.blocked) && !(await confirm())) return false;
      if (!this.active || authority !== this.authority) return false;
      const doc = await read();
      if (!this.active || authority !== this.authority) return false;
      this.set({
        document: doc,
        latest: doc,
        fields: this.fields(doc),
        selection: this.selection(doc),
        dirty: false,
        blocked: false,
        notice: "",
        epoch: this.state.epoch + 1,
      });
      return true;
    } catch {
      if (authority === this.authority)
        this.set({ error: "Saved artifact could not be reloaded. Your draft is retained." });
      return false;
    } finally {
      this.set({ busy: false });
    }
  }
  async execute(
    command: ArtifactCommand,
    ports: {
      confirm(): Promise<boolean>;
      write(command: ArtifactCommand, revision: string): Promise<ArtifactDocument | null>;
    },
  ): Promise<boolean> {
    if (this.state.busy || this.state.blocked || !this.active) return false;
    if (!CommandSchema.safeParse(command).success) {
      this.set({ error: "Check the artifact fields before saving." });
      return false;
    }
    if (command.type === "data")
      try {
        JSON.parse(command.json);
      } catch {
        this.set({ error: "Enter valid JSON. No data update was sent." });
        return false;
      }
    const authority = this.authority,
      revision = this.state.document.artifact.revision;
    this.set({ busy: true, error: "" });
    try {
      if (!(await ports.confirm())) return false;
      if (!this.active || authority !== this.authority) return false;
      const document = await ports.write(command, revision);
      if (!this.active || authority !== this.authority) {
        this.set({
          blocked: true,
          notice: "The saved outcome may have changed. Reload before another write.",
        });
        return false;
      }
      if (document) {
        const acknowledged = this.fields(document);
        const fields = { ...this.state.fields };
        if (command.type === "metadata") {
          fields.name = acknowledged.name;
          fields.description = acknowledged.description;
        }
        if (command.type === "data") fields.json = acknowledged.json;
        this.set({
          document,
          latest: document,
          fields,
          dirty: JSON.stringify(fields) !== JSON.stringify(acknowledged),
          notice: "Saved.",
          epoch: this.state.epoch + 1,
        });
      }
      return true;
    } catch {
      this.set({
        error:
          "The host could not acknowledge this action. Your draft is retained. Reload saved output before another write.",
        blocked: true,
      });
      return false;
    } finally {
      this.set({ busy: false });
    }
  }
}
const drafts = new WeakMap<object, Map<string, ArtifactDraft>>();
export function artifactDraftFor(owner: object, key: string, document: ArtifactDocument) {
  let scope = drafts.get(owner);
  if (!scope) {
    scope = new Map();
    drafts.set(owner, scope);
  }
  let draft = scope.get(key);
  if (!draft) {
    for (const [oldKey, candidate] of scope) {
      if (scope.size < 50) break;
      if (candidate.canEvict()) scope.delete(oldKey);
    }
    if (scope.size >= 50)
      throw new Error("Close or discard existing artifact drafts before opening more.");
    draft = new ArtifactDraft(document);
    scope.set(key, draft);
  }
  return draft;
}
export function releaseArtifactDraft(owner: object, key: string) {
  drafts.get(owner)?.delete(key);
}

interface CreateSnapshot {
  name: string;
  description: string;
  selection: ArtifactModelSelection | null;
  busy: boolean;
  blocked: boolean;
  error: string;
  created: ArtifactSummary | null;
}
export class ArtifactCreateDraft {
  private state: CreateSnapshot = {
    name: "",
    description: "",
    selection: null,
    busy: false,
    blocked: false,
    error: "",
    created: null,
  };
  private listeners = new Set<() => void>();
  private active = false;
  private authority = 0;
  constructor(readonly scope: ArtifactScope) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<CreateSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  edit(field: "name" | "description", value: string) {
    if (!this.state.busy) this.set({ [field]: value });
  }
  selectModel(selection: ArtifactModelSelection | null) {
    if (!this.state.busy) this.set({ selection });
  }
  activate() {
    this.active = true;
    const current = ++this.authority;
    return () => {
      if (current === this.authority) {
        this.active = false;
        this.authority++;
        if (this.state.busy) this.set({ blocked: true });
      }
    };
  }
  async submit(
    create: (input: {
      scope: ArtifactScope;
      name: string;
      description: string;
      selection?: { provider: string; model: string };
    }) => Promise<ArtifactSummary>,
  ): Promise<ArtifactSummary | null> {
    if (!this.active || this.state.busy || this.state.blocked) return null;
    if (
      !this.state.name.trim() ||
      !this.state.description.trim() ||
      this.state.name.length > 200 ||
      this.state.description.length > 12000
    ) {
      this.set({
        error: "Enter a name (up to 200 characters) and a description (up to 12,000 characters).",
      });
      return null;
    }
    const authority = this.authority;
    this.set({ busy: true, error: "" });
    try {
      const created = await create({
        scope: this.scope,
        name: this.state.name.trim(),
        description: this.state.description.trim(),
        ...(this.state.selection
          ? {
              selection: {
                provider: this.state.selection.provider,
                model: this.state.selection.model,
              },
            }
          : {}),
      });
      this.set({ created });
      if (authority !== this.authority || !this.active) {
        this.set({ blocked: true });
        return null;
      }
      return created;
    } catch {
      this.set({
        blocked: true,
        error:
          "Creation could not be acknowledged. Your draft is retained. Refresh the library to check for an existing artifact before explicitly discarding this draft and trying again.",
      });
      return null;
    } finally {
      this.set({ busy: false });
    }
  }
}
const createDrafts = new WeakMap<object, Map<string, ArtifactCreateDraft>>();
export function artifactCreateDraftFor(owner: object, scope: ArtifactScope) {
  let entries = createDrafts.get(owner);
  if (!entries) {
    entries = new Map();
    createDrafts.set(owner, entries);
  }
  const key = JSON.stringify(scope);
  let draft = entries.get(key);
  if (!draft) {
    if (entries.size >= 50) throw new Error("Close existing artifact creation drafts first.");
    draft = new ArtifactCreateDraft(scope);
    entries.set(key, draft);
  }
  return draft;
}
export function discardArtifactCreateDraft(owner: object, scope: ArtifactScope) {
  createDrafts.get(owner)?.delete(JSON.stringify(scope));
}

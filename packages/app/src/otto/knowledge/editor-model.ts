import type { KnowledgeCommand, KnowledgeRecord } from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeCommandSchema } from "@getpaseo/plugin/otto/project-knowledge";

export interface EditorSeed {
  action?: KnowledgeCommand["action"];
  page?: KnowledgeRecord;
  root?: {
    slug: "background" | "architecture" | "flow" | "mindmap" | "stack" | "roadmap";
    body: string;
    revision: string | null;
  };
}
export type EditorReloadTarget =
  | { type: "page"; kind: KnowledgeRecord["kind"]; id: string }
  | { type: "root"; slug: NonNullable<EditorSeed["root"]>["slug"] };
type Action = KnowledgeCommand["action"];
export interface EditorFields {
  action: Action;
  kind: KnowledgeRecord["kind"];
  id: string;
  title: string;
  body: string;
  tags: string;
  reason: string;
  status: KnowledgeRecord["status"];
  deliveryStatus: NonNullable<KnowledgeRecord["deliveryStatus"]>;
  completed: string;
  total: string;
  unit: string;
  disposition: NonNullable<KnowledgeRecord["referenceDisposition"]>;
  sourceUrl: string;
}
export interface EditorState {
  fields: EditorFields;
  busy: boolean;
  blocked: boolean;
  error: string;
  saved: boolean;
  reloading: boolean;
  reloadVersion: number;
  lockBlocked: boolean;
}

function initialFields(seed: EditorSeed): EditorFields {
  const page = seed.page;
  const fields: EditorFields = {
    action: "create",
    kind: "requirement",
    id: "",
    title: "",
    body: "",
    tags: "",
    reason: "",
    status: "proposed",
    deliveryStatus: "charter",
    completed: "",
    total: "",
    unit: "",
    disposition: "unevaluated",
    sourceUrl: "",
  };
  if (page)
    Object.assign(fields, {
      action: "truth",
      kind: page.kind,
      id: page.id,
      title: page.title,
      body: page.statement,
      tags: page.tags.join(", "),
      status: page.status,
      deliveryStatus: page.deliveryStatus ?? "charter",
      disposition: page.referenceDisposition ?? "unevaluated",
      sourceUrl: page.sourceUrl ?? "",
    });
  if (page?.progress)
    Object.assign(fields, {
      completed: String(page.progress.completed),
      total: String(page.progress.total),
      unit: page.progress.unit,
    });
  if (seed.root) Object.assign(fields, { action: "root", body: seed.root.body });
  if (seed.action) fields.action = seed.action;
  if (fields.action === "evidence") fields.body = "";
  return fields;
}
function sameEditorTarget(target: EditorReloadTarget, next: EditorSeed): boolean {
  if (target.type === "root") return next.root?.slug === target.slug;
  return next.page?.id === target.id && next.page?.kind === target.kind;
}

/** Local edit state only. Origin revisions never follow peer/catalog refreshes. */
export class KnowledgeEditorModel {
  private listeners = new Set<() => void>();
  private closed = false;
  private active = true;
  private authority = 0;
  private state: EditorState;
  private originRevision: string | undefined;
  private rootRevision: string | null;
  private seedValue: EditorSeed;
  private submittedCreate: Extract<KnowledgeCommand, { action: "create" }> | null = null;
  get seed() {
    return this.seedValue;
  }
  constructor(
    seed: EditorSeed,
    private readonly submit: (
      command: KnowledgeCommand,
    ) => Promise<{ ok: true } | { ok: false; message: string; code?: string }>,
    private readonly readSaved?: (target: EditorReloadTarget) => Promise<EditorSeed>,
  ) {
    this.seedValue = {
      ...seed,
      ...(seed.page ? { page: { ...seed.page, tags: [...seed.page.tags] } } : {}),
      ...(seed.root ? { root: { ...seed.root } } : {}),
    };
    this.originRevision = seed.page?.revision;
    this.rootRevision = seed.root?.revision ?? null;
    this.state = {
      fields: initialFields(seed),
      busy: false,
      blocked: false,
      error: "",
      saved: false,
      reloading: false,
      reloadVersion: 0,
      lockBlocked: false,
    };
  }
  getSnapshot = () => this.state;
  hasChanges() {
    return JSON.stringify(this.state.fields) !== JSON.stringify(initialFields(this.seed));
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
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
  set<K extends keyof EditorFields>(key: K, value: EditorFields[K]) {
    if (this.closed || this.state.busy) return;
    this.publish({
      ...this.state,
      fields: { ...this.state.fields, [key]: value },
      error: this.state.blocked ? this.state.error : "",
    });
  }
  supportsReload() {
    return Boolean(this.readSaved && this.reloadTarget());
  }
  private reloadTarget(): EditorReloadTarget | null {
    if (this.seed.root) return { type: "root", slug: this.seed.root.slug };
    const page = this.seed.page ?? this.submittedCreate;
    return page ? { type: "page", kind: page.kind, id: page.id } : null;
  }
  private current(authority: number) {
    return !this.closed && this.active && authority === this.authority;
  }
  private finishReload(authority: number, failed = false) {
    if (this.closed) return;
    this.publish({
      ...this.state,
      busy: false,
      reloading: false,
      ...(failed && authority === this.authority
        ? {
            error:
              "Saved Knowledge could not be read. Your local draft and its original revision are retained.",
          }
        : {}),
    });
  }
  private applyReload(
    next: EditorSeed,
    action: EditorFields["action"],
    target: EditorReloadTarget,
  ) {
    if (!sameEditorTarget(target, next)) throw new Error("Knowledge reload changed the target");
    this.seedValue = { ...next, action: action === "create" ? "truth" : action };
    this.originRevision = next.page?.revision;
    this.rootRevision = next.root?.revision ?? null;
    this.publish({
      fields: initialFields(this.seedValue),
      busy: false,
      reloading: false,
      blocked: false,
      lockBlocked: false,
      saved: false,
      error: "",
      reloadVersion: this.state.reloadVersion + 1,
    });
  }
  async reload(confirm: () => Promise<boolean>): Promise<boolean> {
    const target = this.reloadTarget();
    if (!this.current(this.authority) || this.state.busy || !this.readSaved || !target)
      return false;
    const authority = this.authority;
    const action = this.state.fields.action;
    this.publish({ ...this.state, busy: true, reloading: true });
    try {
      if (!(await confirm()) || !this.current(authority)) {
        this.finishReload(authority);
        return false;
      }
      const next = await this.readSaved(target);
      if (!this.current(authority)) {
        this.finishReload(authority);
        return false;
      }
      this.applyReload(next, action, target);
      return true;
    } catch {
      this.finishReload(authority, true);
      return false;
    }
  }
  command(): KnowledgeCommand {
    const fields = this.state.fields;
    const target = { kind: fields.kind, id: fields.id, expectedRevision: this.originRevision };
    const tags = fields.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    let command: unknown;
    switch (fields.action) {
      case "create":
        command = {
          action: "create",
          kind: fields.kind,
          id: fields.id,
          title: fields.title,
          tags,
          statement: fields.body,
        };
        break;
      case "root":
        command = {
          action: "root",
          slug: this.seed.root?.slug,
          expectedRevision: this.rootRevision,
          body: fields.body,
        };
        break;
      case "truth":
        command = { ...target, action: "truth", statement: fields.body, reason: fields.reason };
        break;
      case "describe":
        command = {
          ...target,
          action: "describe",
          title: fields.title,
          tags,
          reason: fields.reason,
        };
        break;
      case "evidence":
        command = {
          ...target,
          action: "evidence",
          text: fields.body,
          source: fields.sourceUrl || undefined,
        };
        break;
      case "review":
        command = { ...target, action: "review", status: fields.status, reason: fields.reason };
        break;
      case "delivery":
        command = {
          ...target,
          action: "delivery",
          deliveryStatus: fields.deliveryStatus,
          progress:
            fields.completed || fields.total || fields.unit
              ? {
                  completed: Number(fields.completed),
                  total: Number(fields.total),
                  unit: fields.unit,
                }
              : null,
          reason: fields.reason,
        };
        break;
      case "reference":
        command = {
          ...target,
          action: "reference",
          disposition: fields.disposition,
          sourceUrl: fields.sourceUrl || null,
          reason: fields.reason,
        };
        break;
      case "purge":
        command = { ...target, action: "purge", reason: fields.reason };
        break;
      case "initialize":
        throw new Error("Initialization is not an editor action");
    }
    return KnowledgeCommandSchema.parse(command);
  }
  async save(authority = this.authority): Promise<boolean> {
    if (
      this.closed ||
      !this.active ||
      authority !== this.authority ||
      this.state.busy ||
      this.state.blocked ||
      this.state.saved
    )
      return false;
    let command: KnowledgeCommand;
    try {
      command = this.command();
    } catch {
      this.publish({
        ...this.state,
        error: "Complete the required fields, including a reason for changes.",
      });
      return false;
    }
    this.publish({ ...this.state, busy: true, error: "", lockBlocked: false });
    if (command.action === "create") this.submittedCreate = command;
    try {
      const result = await this.submit(command);
      if (this.closed) return false;
      if (authority !== this.authority) {
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          error:
            "This write settled after the page was hidden. Your draft is retained; reload before editing again.",
        });
        return false;
      }
      if (!result.ok) {
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          error: result.message,
          lockBlocked: result.code === "busy",
        });
        return false;
      }
      this.publish({ ...this.state, busy: false, saved: true });
      return true;
    } catch {
      if (!this.closed)
        this.publish({
          ...this.state,
          busy: false,
          blocked: true,
          error:
            "The write outcome is unknown. Your draft is retained; cancel and reload before another save.",
        });
      return false;
    }
  }
  private publish(state: EditorState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

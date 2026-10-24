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

/** Local edit state only. Origin revisions never follow peer/catalog refreshes. */
export class KnowledgeEditorModel {
  private listeners = new Set<() => void>();
  private closed = false;
  private active = true;
  private authority = 0;
  private state: EditorState;
  private readonly originRevision: string | undefined;
  private readonly rootRevision: string | null;
  constructor(
    readonly seed: EditorSeed,
    private readonly submit: (
      command: KnowledgeCommand,
    ) => Promise<{ ok: true } | { ok: false; message: string }>,
  ) {
    this.originRevision = seed.page?.revision;
    this.rootRevision = seed.root?.revision ?? null;
    this.state = {
      fields: initialFields(seed),
      busy: false,
      blocked: false,
      error: "",
      saved: false,
    };
  }
  getSnapshot = () => this.state;
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
    this.publish({ ...this.state, fields: { ...this.state.fields, [key]: value }, error: "" });
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
    this.publish({ ...this.state, busy: true, error: "" });
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
        this.publish({ ...this.state, busy: false, blocked: true, error: result.message });
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

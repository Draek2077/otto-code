import type { ContextSourceFile } from "@getpaseo/plugin/otto/context-management";
import type { ContextEdgeEdit } from "./edge-edit";

export interface ContextSourcePort {
  read(): Promise<ContextSourceFile>;
  save(input: {
    expectedRevision: string;
    text: string;
    userApprovedGlobal: boolean;
  }): Promise<{ ok: true; revision: string } | { ok: false; message: string }>;
}
export interface ContextSourceDraft {
  file: ContextSourceFile | null;
  text: string;
  dirty: boolean;
  reading: boolean;
  writing: boolean;
  error: string;
  inputVersion: number;
}
/** Local retained edit intent only. The daemon owns file membership and all CAS revisions. */
export class ContextSourceModel {
  private state: ContextSourceDraft = {
    file: null,
    text: "",
    dirty: false,
    reading: false,
    writing: false,
    error: "",
    inputVersion: 0,
  };
  private readonly listeners = new Set<() => void>();
  private activation: object | null = null;
  private readSequence = 0;
  private reloadPending = false;
  constructor(private readonly port: ContextSourcePort) {}
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<ContextSourceDraft>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    const activation = {};
    this.activation = activation;
    if (!this.state.file || (!this.state.dirty && !this.state.writing)) void this.read(activation);
    return () => {
      if (this.activation === activation) this.activation = null;
    };
  }
  setText(text: string) {
    if (!this.activation || !this.state.file?.writable || this.state.reading || this.state.writing)
      return;
    this.publish({ text, dirty: text !== this.state.file.text });
  }
  private async read(activation: object): Promise<boolean> {
    const sequence = ++this.readSequence;
    this.publish({ reading: true, error: "" });
    try {
      const file = await this.port.read();
      if (this.activation !== activation || sequence !== this.readSequence) return false;
      this.publish({
        file,
        text: file.text,
        dirty: false,
        inputVersion: this.state.inputVersion + 1,
      });
      return true;
    } catch (error) {
      if (this.activation === activation && sequence === this.readSequence)
        this.publish({
          error: error instanceof Error ? error.message : "The current source could not be read.",
        });
      return false;
    } finally {
      if (sequence === this.readSequence) this.publish({ reading: false });
    }
  }
  async reload(confirmDiscard: () => Promise<boolean>): Promise<boolean> {
    const activation = this.activation;
    if (!activation || this.state.reading || this.state.writing || this.reloadPending) return false;
    const sequence = this.readSequence;
    let delegated = false;
    this.reloadPending = true;
    this.publish({ reading: true });
    try {
      if (this.state.dirty && !(await confirmDiscard())) return false;
      if (this.activation !== activation) return false;
      delegated = true;
      return await this.read(activation);
    } catch {
      if (this.activation === activation)
        this.publish({ error: "Source reload was not confirmed. The local draft was retained." });
      return false;
    } finally {
      this.reloadPending = false;
      if (!delegated && sequence === this.readSequence) this.publish({ reading: false });
    }
  }
  async save(
    lane: ContextEdgeEdit,
    confirm: (global: boolean) => Promise<boolean>,
    changed: () => void,
  ): Promise<void> {
    const activation = this.activation,
      file = this.state.file,
      text = this.state.text;
    if (
      !activation ||
      !file?.writable ||
      !this.state.dirty ||
      this.state.reading ||
      this.state.writing
    )
      return;
    this.publish({ writing: true, error: "" });
    let revision: string | null = null;
    try {
      await lane.change(
        () => confirm(file.scope === "host"),
        async () => {
          const result = await this.port.save({
            expectedRevision: file.revision,
            text,
            userApprovedGlobal: file.scope === "host",
          });
          if (!result.ok) return result;
          revision = result.revision;
          return { ok: true };
        },
        () => {
          if (revision === null) return;
          this.publish({ file: { ...file, revision, text }, dirty: false });
          changed();
        },
        () => this.activation === activation,
        `source:${file.nodeId}`,
      );
    } finally {
      this.publish({ writing: false });
    }
  }
}

/** A workspace view retains drafts across source selection, polling and compact back navigation. */
export class ContextSourceDrafts {
  private readonly models = new Map<string, ContextSourceModel>();
  open(key: string, port: ContextSourcePort): ContextSourceModel {
    let model = this.models.get(key);
    if (!model) {
      model = new ContextSourceModel(port);
      this.models.set(key, model);
    }
    return model;
  }
}

export function contextLineSelection(text: string, line: number, lineEnd: number) {
  const rows = text.split("\n");
  const from = Math.max(0, Math.min(rows.length - 1, line - 1));
  const through = Math.max(from, Math.min(rows.length - 1, lineEnd - 1));
  const start = rows.slice(0, from).reduce((length, row) => length + row.length + 1, 0);
  const end = start + rows.slice(from, through + 1).join("\n").length;
  return { start, end };
}

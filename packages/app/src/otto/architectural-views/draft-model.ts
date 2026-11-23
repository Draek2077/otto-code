import type {
  ViewDraft,
  ViewDocument,
  ViewSpecification,
  ViewSummary,
} from "@getpaseo/plugin/otto/architectural-views";
import { parseViewSpecification } from "@getpaseo/plugin/otto/architectural-views";
import { ViewRequestError } from "./errors";

export type DraftDocument = Extract<ViewDocument, { kind: "draft" }>;
interface DraftState {
  draft: ViewDraft;
  text: string;
  title: string;
  dirty: boolean;
  busy: boolean;
  blocked: boolean;
  peerChanged: boolean;
  error: string | null;
  operationId: string | null;
  epoch: number;
}
export interface DraftPorts {
  read(): Promise<DraftDocument>;
  save(input: {
    expectedRevision: string;
    specification: ViewSpecification;
    title: string;
  }): Promise<ViewDraft>;
  publish(expectedRevision: string, operationId: string): Promise<ViewSummary>;
  discard(expectedRevision: string, operationId: string): Promise<unknown>;
  changed(): void;
}
function source(value: ViewSpecification) {
  return JSON.stringify(value, null, 2);
}
function parseSource(value: string): ViewSpecification {
  try {
    return parseViewSpecification(JSON.parse(value));
  } catch (cause) {
    throw new ViewRequestError(
      "invalid",
      cause instanceof Error ? cause.message.slice(0, 500) : "The View source is invalid.",
      { cause },
    );
  }
}
/** Local explicit-save intent only. Canonical records, rendering, sessions and publication remain host-owned. */
export class ViewDraftModel {
  private state: DraftState;
  private readonly listeners = new Set<() => void>();
  private active = 0;
  private authority = 0;
  private source: string;
  private editVersion = 0;
  constructor(
    document: DraftDocument,
    private ports: DraftPorts,
  ) {
    this.source = source(document.specification);
    this.state = {
      draft: document.draft,
      text: this.source,
      title: document.draft.title,
      dirty: false,
      busy: false,
      blocked: false,
      peerChanged: false,
      error: null,
      operationId: null,
      epoch: 0,
    };
  }
  getSnapshot = () => this.state;
  canForget() {
    return !this.active && !this.state.dirty && !this.state.busy && !this.state.blocked;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  setPorts(ports: DraftPorts) {
    this.ports = ports;
  }
  private publish(patch: Partial<DraftState>) {
    this.state = { ...this.state, ...patch };
    this.state.dirty =
      this.state.text !== this.source || this.state.title !== this.state.draft.title;
    for (const listener of this.listeners) listener();
  }
  retain(): () => void {
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.active > 0) return;
      this.authority++;
      if (this.state.busy)
        this.publish({
          blocked: true,
          error:
            "A hidden operation may have changed this draft. Inspect its outcome, then reload explicitly.",
        });
    };
  }
  editText(value: string) {
    this.editVersion++;
    this.publish({ text: value });
  }
  editTitle(value: string) {
    this.editVersion++;
    this.publish({ title: value });
  }
  observe(document: DraftDocument) {
    if (document.draft.revision !== this.state.draft.revision) this.publish({ peerChanged: true });
  }
  acceptMetadata(draft: ViewDraft, expectedRevision: string) {
    if (this.state.draft.revision !== expectedRevision || this.state.busy) {
      this.publish({ peerChanged: true });
      return;
    }
    this.publish({ draft, peerChanged: false });
  }
  private begin(operationId: string | null): number | null {
    if (!this.active || this.state.busy || this.state.blocked) return null;
    this.publish({ busy: true, error: null, operationId });
    return this.authority;
  }
  private current(authority: number) {
    return this.active > 0 && this.authority === authority;
  }
  private failure(error: unknown) {
    this.publish({
      error:
        error instanceof Error
          ? error.message
          : "The View action was not acknowledged. Inspect before another write.",
      blocked:
        this.state.blocked || !(error instanceof ViewRequestError && error.code === "invalid"),
    });
  }
  async save(): Promise<boolean> {
    const authority = this.begin(null);
    if (authority === null) return false;
    const submitted = this.state.text,
      title = this.state.title;
    try {
      if (new TextEncoder().encode(submitted).length > 524288)
        throw new ViewRequestError("invalid", "View specifications are limited to 512 KiB.");
      const specification = parseSource(submitted);
      const draft = await this.ports.save({
        expectedRevision: this.state.draft.revision,
        specification,
        title,
      });
      if (!this.current(authority)) return false;
      this.source = source(specification);
      this.publish({
        draft,
        text: this.state.text === submitted ? this.source : this.state.text,
        title: this.state.title === title ? draft.title : this.state.title,
        peerChanged: false,
      });
      this.ports.changed();
      return true;
    } catch (error) {
      if (this.current(authority)) {
        this.failure(error);
      }
      return false;
    } finally {
      this.publish({ busy: false });
    }
  }
  async publishView(confirm: () => Promise<boolean>): Promise<ViewSummary | null> {
    if (this.state.dirty || this.state.draft.starter || this.state.draft.base.status !== "reviewed")
      return null;
    const authority = this.begin(globalThis.crypto.randomUUID());
    const edits = this.editVersion;
    if (authority === null) return null;
    try {
      if (!(await confirm()) || !this.current(authority) || this.editVersion !== edits) return null;
      const result = await this.ports.publish(this.state.draft.revision, this.state.operationId!);
      if (!this.current(authority)) return null;
      if (this.editVersion !== edits) {
        this.publish({
          blocked: true,
          error:
            "Publication may have completed while local edits changed. Inspect the operation; local text is kept.",
        });
        return null;
      }
      this.ports.changed();
      return result;
    } catch (error) {
      if (this.current(authority)) this.failure(error);
      return null;
    } finally {
      this.publish({ busy: false });
    }
  }
  async discard(confirm: () => Promise<boolean>): Promise<boolean> {
    const authority = this.begin(globalThis.crypto.randomUUID());
    const edits = this.editVersion;
    if (authority === null) return false;
    try {
      if (!(await confirm()) || !this.current(authority) || this.editVersion !== edits)
        return false;
      await this.ports.discard(this.state.draft.revision, this.state.operationId!);
      if (!this.current(authority)) return false;
      if (this.editVersion !== edits) {
        this.publish({
          blocked: true,
          error:
            "The draft may have been discarded while local edits changed. Inspect the operation; local text is kept.",
        });
        return false;
      }
      this.ports.changed();
      return true;
    } catch (error) {
      if (this.current(authority)) this.failure(error);
      return false;
    } finally {
      this.publish({ busy: false });
    }
  }
  async reload(confirm: () => Promise<boolean>): Promise<boolean> {
    if (!this.active || this.state.busy) return false;
    const authority = this.authority;
    const edits = this.editVersion;
    this.publish({ busy: true });
    try {
      if (!(await confirm()) || !this.current(authority) || this.editVersion !== edits)
        return false;
      const document = await this.ports.read();
      if (!this.current(authority)) return false;
      if (this.editVersion !== edits) {
        this.publish({
          error: "Local edits changed during the read and were kept. Review again when ready.",
        });
        return false;
      }
      this.source = source(document.specification);
      this.publish({
        draft: document.draft,
        text: this.source,
        title: document.draft.title,
        error: null,
        blocked: false,
        peerChanged: false,
        operationId: null,
        epoch: this.state.epoch + 1,
      });
      return true;
    } catch (error) {
      if (this.current(authority)) this.failure(error);
      return false;
    } finally {
      this.publish({ busy: false });
    }
  }
  async metadata(
    action: (revision: string, current: () => boolean) => Promise<ViewDraft | null>,
  ): Promise<boolean> {
    const authority = this.begin(null);
    if (authority === null) return false;
    try {
      const draft = await action(this.state.draft.revision, () => this.current(authority));
      if (!draft || !this.current(authority)) return false;
      this.publish({ draft, peerChanged: false });
      this.ports.changed();
      return true;
    } catch (error) {
      if (this.current(authority)) this.failure(error);
      return false;
    } finally {
      this.publish({ busy: false });
    }
  }
}

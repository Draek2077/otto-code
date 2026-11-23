import {
  ViewId,
  type ViewDraft,
  type ViewKind,
  type ViewReference,
  type createViewDraft,
} from "@getpaseo/plugin/otto/architectural-views";
import type { z } from "zod";
interface State {
  title: string;
  diagramType: ViewKind;
  references: ViewReference[];
  busy: boolean;
  blocked: boolean;
  error: string | null;
}
export class CreateViewModel {
  private state: State;
  private readonly listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  readonly viewId = `view-${globalThis.crypto.randomUUID()}`;
  readonly draftId = `draft-${globalThis.crypto.randomUUID()}`;
  readonly operationId = globalThis.crypto.randomUUID();
  constructor(reference?: ViewReference) {
    this.state = {
      title: "",
      diagramType: "architecture",
      references: reference ? [reference] : [],
      busy: false,
      blocked: false,
      error: null,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    const authority = ++this.authority;
    return () => {
      if (authority !== this.authority) return;
      this.active = false;
      this.authority++;
      if (this.state.busy) this.publish({ blocked: true });
    };
  }
  title(value: string) {
    if (this.state.busy || this.state.blocked) return;
    this.publish({ title: value });
  }
  kind(value: ViewKind) {
    if (this.state.busy || this.state.blocked) return;
    this.publish({ diagramType: value });
  }
  add(reference: ViewReference) {
    if (this.state.busy || this.state.blocked) return;
    if (
      this.state.references.length >= 32 ||
      this.state.references.some(
        (entry) => entry.kind === reference.kind && entry.id === reference.id,
      )
    )
      return;
    this.publish({ references: [...this.state.references, reference] });
  }
  remove(reference: ViewReference) {
    if (this.state.busy || this.state.blocked) return;
    this.publish({
      references: this.state.references.filter(
        (entry) => entry.kind !== reference.kind || entry.id !== reference.id,
      ),
    });
  }
  async create(
    save: (input: Omit<z.infer<typeof createViewDraft.input>, "scope">) => Promise<ViewDraft>,
  ): Promise<ViewDraft | null> {
    if (!this.active || this.state.busy || this.state.blocked) return null;
    const title = this.state.title.trim();
    if (
      !title ||
      title.length > 200 ||
      !this.state.references.length ||
      !ViewId.safeParse(this.viewId).success
    ) {
      this.publish({ error: "Enter a title and choose at least one Knowledge source." });
      return null;
    }
    const authority = this.authority;
    const input = {
      viewId: this.viewId,
      draftId: this.draftId,
      operationId: this.operationId,
      title,
      diagramType: this.state.diagramType,
      knowledgeReferences: this.state.references,
      published: null,
    };
    this.publish({ busy: true, error: null });
    try {
      const draft = await save(input);
      return this.active && authority === this.authority ? draft : null;
    } catch (error) {
      if (this.active && authority === this.authority)
        this.publish({
          blocked: true,
          error:
            error instanceof Error
              ? error.message
              : "Creation was not acknowledged. Inspect the library before creating another draft.",
        });
      return null;
    } finally {
      this.publish({ busy: false });
    }
  }
}

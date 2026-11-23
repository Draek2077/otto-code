import type { KnowledgeScope } from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeEditorModel, type EditorSeed } from "./editor-model";

interface Entry {
  model: KnowledgeEditorModel;
  consumers: number;
}
interface OpenDraft {
  scope: KnowledgeScope;
  seed: EditorSeed;
  submit: ConstructorParameters<typeof KnowledgeEditorModel>[1];
  readSaved?: ConstructorParameters<typeof KnowledgeEditorModel>[2];
}
/** Installation-owned local intent, keyed by actual host/workspace-or-project
 * scope. No canonical records, filesystem paths, feeds or query cache live here. */
export class KnowledgeEditorDrafts {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private version = 0;
  getSnapshot = () => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private key(scope: KnowledgeScope) {
    return JSON.stringify([scope.hostId, scope.target.kind, scope.target.id]);
  }
  get(scope: KnowledgeScope): KnowledgeEditorModel | null {
    return this.entries.get(this.key(scope))?.model ?? null;
  }
  open(input: OpenDraft): KnowledgeEditorModel {
    const key = this.key(input.scope);
    const current = this.entries.get(key);
    if (current) return current.model;
    if (this.entries.size >= 50)
      throw new Error("Finish or discard an existing Knowledge draft before opening more.");
    const model = new KnowledgeEditorModel(input.seed, input.submit, input.readSaved);
    this.entries.set(key, { model, consumers: 0 });
    this.changed();
    return model;
  }
  retain(scope: KnowledgeScope, model: KnowledgeEditorModel): () => void {
    const key = this.key(scope);
    const entry = this.entries.get(key);
    if (entry?.model !== model) return () => {};
    entry.consumers++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.consumers--;
      if (!entry.consumers) model.setActive(false);
      // React's effect replay can release and reacquire the same open form in
      // one turn. Prune only untouched, unowned intent after that replay.
      queueMicrotask(() => {
        const state = model.getSnapshot();
        if (
          this.entries.get(key) !== entry ||
          entry.consumers ||
          state.busy ||
          state.blocked ||
          model.hasChanges()
        )
          return;
        this.entries.delete(key);
        model.close();
        this.changed();
      });
    };
  }
  discard(scope: KnowledgeScope, model: KnowledgeEditorModel): boolean {
    const key = this.key(scope);
    if (model.getSnapshot().busy || this.entries.get(key)?.model !== model) return false;
    this.entries.delete(key);
    model.close();
    this.changed();
    return true;
  }
  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

// The public API object is stable for one plugin installation. Weak ownership
// releases all session-local drafts when that installation becomes unreachable;
// app reload/uninstall does not pretend to provide durable draft storage.
const installations = new WeakMap<object, KnowledgeEditorDrafts>();
export function knowledgeEditorDraftsFor(installation: object): KnowledgeEditorDrafts {
  let drafts = installations.get(installation);
  if (!drafts) {
    drafts = new KnowledgeEditorDrafts();
    installations.set(installation, drafts);
  }
  return drafts;
}

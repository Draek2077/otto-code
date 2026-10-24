import type { ProjectConfiguration } from "../shared/model.js";
import { openTargetForm, type TargetFormModel } from "./target-form.js";

type SaveTarget = Parameters<typeof openTargetForm>[0]["save"];
interface OpenDraft {
  model: TargetFormModel;
  consumers: number;
  unsubscribe(): void;
}

/** Installation-owned edit drafts only. Host resources and transport remain daemon/app owned. */
export class ProjectTargetDrafts {
  private readonly entries = new Map<string, OpenDraft>();

  private key(binding: ProjectConfiguration["binding"]): string {
    return JSON.stringify([binding.hostId, binding.projectId]);
  }

  private prune(key: string, entry: OpenDraft): void {
    const state = entry.model.getSnapshot();
    if (entry.consumers || state.dirty || state.busy || this.entries.get(key) !== entry) return;
    entry.unsubscribe();
    this.entries.delete(key);
  }

  private remember(model: TargetFormModel): OpenDraft {
    const key = this.key(model.binding);
    const entry: OpenDraft = { model, consumers: 0, unsubscribe: () => {} };
    entry.unsubscribe = model.subscribe(() => this.prune(key, entry));
    this.entries.set(key, entry);
    return entry;
  }

  open(snapshot: ProjectConfiguration, save: SaveTarget): TargetFormModel {
    const key = this.key(snapshot.binding);
    const existing = this.entries.get(key);
    if (existing) {
      const state = existing.model.getSnapshot();
      if (state.dirty || state.busy || existing.model.getRevision() === snapshot.settingsRevision)
        return existing.model;
      existing.unsubscribe();
    }
    return this.remember(openTargetForm({ snapshot, save })).model;
  }

  retain(model: TargetFormModel): () => void {
    const key = this.key(model.binding);
    const existing = this.entries.get(key);
    const entry = existing?.model === model ? existing : this.remember(model);
    entry.consumers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.consumers -= 1;
      this.prune(key, entry);
    };
  }

  discard(model: TargetFormModel): boolean {
    if (model.getSnapshot().busy) return false;
    const key = this.key(model.binding);
    const entry = this.entries.get(key);
    if (entry?.model === model) {
      entry.unsubscribe();
      this.entries.delete(key);
    }
    return true;
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.unsubscribe();
    this.entries.clear();
  }
}

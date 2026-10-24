import type { ProjectBinding } from "../shared/model.js";
import { openBoardAction, type BoardActionModel } from "./action-form.js";

/** Local edit intent survives host/route changes. It never caches canonical board resources. */
export class BoardActionDrafts {
  private readonly entries = new Map<string, BoardActionModel>();
  private key(binding: ProjectBinding) {
    return JSON.stringify([binding.hostId, binding.projectId]);
  }
  get(binding: ProjectBinding): BoardActionModel | null {
    return this.entries.get(this.key(binding)) ?? null;
  }
  open(input: Parameters<typeof openBoardAction>[0]): BoardActionModel {
    const existing = this.get(input.origin.binding);
    if (existing) return existing;
    const model = openBoardAction(input);
    this.entries.set(this.key(input.origin.binding), model);
    return model;
  }
  discard(model: BoardActionModel): boolean {
    if (model.getSnapshot().busy) return false;
    const key = this.key(model.origin.binding);
    if (this.entries.get(key) !== model) return false;
    this.entries.delete(key);
    model.close();
    return true;
  }
  dispose() {
    for (const model of this.entries.values()) model.close();
    this.entries.clear();
  }
}

import { withKnowledgeWrite } from "../project-knowledge/knowledge-files.js";
import type { ViewStore } from "./records.js";
import { ArchitecturalViewError } from "./specification.js";

/** Shutdown revokes queued transactions and drains only admitted filesystem work,
 * never a provider turn. No write may enter after the host closes. */
export class ViewWrites {
  private closed = false;
  private readonly pending = new Set<Promise<unknown>>();
  run = <T>(store: ViewStore, action: () => Promise<T>): Promise<T> => {
    this.assertOpen();
    const work = withKnowledgeWrite(store, async () => {
      this.assertOpen();
      return action();
    });
    this.pending.add(work);
    void work.then(
      () => this.pending.delete(work),
      () => this.pending.delete(work),
    );
    return work;
  };
  assertOpen() {
    if (this.closed) throw new ArchitecturalViewError("unavailable", "The host is shutting down.");
  }
  async close() {
    this.closed = true;
    await Promise.allSettled(this.pending);
  }
}

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  type OrchestrationGraph,
  OrchestrationGraphSchema,
} from "@otto-code/protocol/orchestration";

import { writeJsonFileAtomic } from "../atomic-file.js";

// File-backed persistence for orchestration Graphs — the reusable templates a
// User orchestration executes (projects/orchestration-graphs). One JSON file
// per graph under `$OTTO_HOME/orchestration-graphs/{graphId}.json`, mirroring
// RunStore: atomic writes (temp + rename), per-id serialized mutation so
// concurrent saves can't interleave, no migrations — forward-compat is via
// optional schema fields (see docs/data-model.md). Host-level by design:
// graphs are generic and reusable across workspaces; an orchestration binds a
// graph to a workspace only at start time.
export type GraphsChangeListener = (graphs: OrchestrationGraph[]) => void;

export class GraphStore {
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly changeListeners = new Set<GraphsChangeListener>();

  constructor(private readonly dir: string) {}

  /** Notified with the full list after every save/delete (client cache sync). */
  onChange(listener: GraphsChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private async notifyChanged(): Promise<void> {
    if (this.changeListeners.size === 0) {
      return;
    }
    const graphs = await this.list();
    for (const listener of this.changeListeners) {
      listener(graphs);
    }
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<OrchestrationGraph[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir, { withFileTypes: true });
    const graphs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.dir, entry.name), "utf-8");
          return OrchestrationGraphSchema.parse(JSON.parse(content));
        }),
    );
    return graphs.sort((left, right) => left.name.localeCompare(right.name));
  }

  async get(id: string): Promise<OrchestrationGraph | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(id), "utf-8");
      return OrchestrationGraphSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(graph: OrchestrationGraph): Promise<void> {
    const validated = OrchestrationGraphSchema.parse(graph);
    await this.serializeMutation(validated.id, async () => {
      await this.ensureDir();
      await writeJsonFileAtomic(this.filePath(validated.id), validated);
    });
    await this.notifyChanged();
  }

  async delete(id: string): Promise<void> {
    await this.serializeMutation(id, async () => {
      await this.ensureDir();
      await rm(this.filePath(id), { force: true });
    });
    await this.notifyChanged();
  }

  private async serializeMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(mutation);
    this.mutations.set(key, next);
    try {
      return await next;
    } finally {
      if (this.mutations.get(key) === next) {
        this.mutations.delete(key);
      }
    }
  }
}

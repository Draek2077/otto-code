import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { type PromptTemplate, PromptTemplateSchema } from "@otto-code/protocol/orchestration";

import { writeJsonFileAtomic } from "../atomic-file.js";

// File-backed persistence for prompt templates (projects/orchestration-graphs,
// Stage 5). One JSON file per template under `$OTTO_HOME/prompt-templates/`,
// mirroring GraphStore exactly — atomic writes, per-id serialized mutation, no
// migrations. Host-level for the same reason graphs are: a prompt worth reusing
// is worth reusing across every workspace on the machine.
export type PromptTemplatesChangeListener = (templates: PromptTemplate[]) => void;

export class PromptTemplateStore {
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly changeListeners = new Set<PromptTemplatesChangeListener>();

  constructor(private readonly dir: string) {}

  onChange(listener: PromptTemplatesChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private async notifyChanged(): Promise<void> {
    if (this.changeListeners.size === 0) {
      return;
    }
    const templates = await this.list();
    for (const listener of this.changeListeners) {
      listener(templates);
    }
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<PromptTemplate[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir, { withFileTypes: true });
    const templates = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.dir, entry.name), "utf-8");
          return PromptTemplateSchema.parse(JSON.parse(content));
        }),
    );
    return templates.sort((left, right) => left.name.localeCompare(right.name));
  }

  async get(id: string): Promise<PromptTemplate | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(id), "utf-8");
      return PromptTemplateSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(template: PromptTemplate): Promise<void> {
    const validated = PromptTemplateSchema.parse(template);
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

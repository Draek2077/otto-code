import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { type Run, RunSchema } from "@otto-code/protocol/orchestration";

import { writeJsonFileAtomic } from "../atomic-file.js";

// File-backed persistence for orchestration Runs — one JSON file per run under
// `$OTTO_HOME/runs/{runId}.json`, mirroring ScheduleStore. Runs are write-heavy
// projections (the engine emits on every phase change), so the surface is
// save/get/list/delete rather than create/update: the RunService owns the
// mutable run and calls `save` on each emit. Writes are atomic (temp + rename)
// and serialized per-id so concurrent emits can't interleave. No migrations —
// forward-compat is via optional schema fields (see docs/data-model.md).
export class RunStore {
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<Run[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir, { withFileTypes: true });
    const runs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.dir, entry.name), "utf-8");
          return RunSchema.parse(JSON.parse(content));
        }),
    );
    return runs.sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
  }

  async get(id: string): Promise<Run | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(id), "utf-8");
      return RunSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(run: Run): Promise<void> {
    const validated = RunSchema.parse(run);
    await this.serializeMutation(validated.id, async () => {
      await this.ensureDir();
      await writeJsonFileAtomic(this.filePath(validated.id), validated);
    });
  }

  async delete(id: string): Promise<void> {
    await this.serializeMutation(id, async () => {
      await this.ensureDir();
      await rm(this.filePath(id), { force: true });
    });
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

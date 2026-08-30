import path from "node:path";

import type { Run } from "@otto-code/protocol/orchestration";

import { RunStore } from "./run-store.js";

interface WorkflowStorageProvenance {
  source?: string;
  projectRoot?: string;
  storeKey?: string;
}

interface WorkflowStoreAccess {
  discoverAllProjectStores(): Promise<Array<{ runsDirectory: string }>>;
  resolveRecordedStore(input: {
    projectRoot: string;
    storeKey: string;
  }): Promise<{ runsDirectory: string }>;
}

/**
 * Project-scoped run persistence behind the existing RunStore-shaped port.
 *
 * A record chooses its location exactly once, in the initial snapshot. Future
 * status writes use that recorded store key, so a settings change can never
 * relocate a live or historical Workflow. Records without project provenance
 * are the pre-0.9 daemon-global library and stay there as legacy material.
 */
export class WorkflowRunStore {
  private readonly stores = new Map<string, RunStore>();
  private readonly locations = new Map<string, RunStore>();

  constructor(
    private readonly registry: WorkflowStoreAccess,
    legacyDirectory: string,
  ) {
    this.legacy = this.storeAt(legacyDirectory);
  }

  private readonly legacy: RunStore;

  async list(): Promise<Run[]> {
    const locations = await this.registry.discoverAllProjectStores();
    const stores = [
      this.legacy,
      ...locations.map((location) => this.storeAt(location.runsDirectory)),
    ];
    const results = await Promise.all(
      stores.map(async (store) => ({ store, runs: await store.list() })),
    );
    const byId = new Map<string, Run>();
    for (const { store, runs } of results) {
      for (const run of runs) {
        const previous = byId.get(run.id);
        if (previous) {
          // Do not silently choose one side of a collision. Startup remains
          // available, but the visible record names the recovery boundary and
          // leaves both on disk for export or an explicit transfer.
          byId.set(run.id, {
            ...previous,
            status: "failed",
            error:
              "Workflow id collision across storage locations. Both copies were preserved; export one copy and use an explicit verified transfer to recover.",
          });
          continue;
        }
        byId.set(run.id, run);
        this.locations.set(run.id, store);
      }
    }
    return [...byId.values()];
  }

  async get(id: string): Promise<Run | null> {
    const known = this.locations.get(id);
    if (known) return known.get(id);
    return (await this.list()).find((run) => run.id === id) ?? null;
  }

  async save(run: Run): Promise<void> {
    const store = await this.storeFor(run);
    await store.save(run);
    this.locations.set(run.id, store);
  }

  async delete(id: string): Promise<void> {
    const store = this.locations.get(id);
    if (store) {
      await store.delete(id);
      this.locations.delete(id);
      return;
    }
    // A delete is never a discovery-triggered destructive fan-out. Unknown
    // ids preserve every store until the caller has explicitly reloaded it.
    const legacy = await this.legacy.get(id);
    if (legacy) await this.legacy.delete(id);
  }

  private async storeFor(run: Run): Promise<RunStore> {
    const provenance = run.workflowStorage as WorkflowStorageProvenance | undefined;
    if (provenance?.source !== "project-store" || !provenance.projectRoot || !provenance.storeKey) {
      return this.legacy;
    }
    const location = await this.registry.resolveRecordedStore({
      projectRoot: provenance.projectRoot,
      storeKey: provenance.storeKey,
    });
    return this.storeAt(location.runsDirectory);
  }

  private storeAt(directory: string): RunStore {
    const key = path.resolve(directory);
    let store = this.stores.get(key);
    if (!store) {
      store = new RunStore(key);
      this.stores.set(key, store);
    }
    return store;
  }
}

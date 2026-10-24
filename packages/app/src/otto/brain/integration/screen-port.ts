import { z } from "zod";
import {
  BrainInventorySchema,
  BrainCatalogSchema,
  BrainRuntimeListSchema,
  BrainJobListSchema,
  BrainAdmittedJobSchema,
  BrainProfileReadSchema,
  BrainProfileSavedSchema,
  BrainBudgetPreviewSchema,
  BrainQuantsSchema,
  BrainSearchSchema,
  BrainEvalsSchema,
  BrainResourcesSchema,
} from "@getpaseo/protocol/otto/brain-library";
import type { BrainAction, BrainQuery } from "@getpaseo/protocol/otto/brain";
import type {
  BrainScreenPort,
  BrainScreenOperations,
  BrainScreenSnapshot,
  BrainResourceKey,
  BrainDemand,
  BrainView,
} from "../screens/contracts/port";
import type { BrainUiBridge, BrainUiSnapshot } from "../bridge";
import type { BrainJob } from "../screens/contracts/models";
import type { BrainResources, BrainTelemetry } from "../screens/contracts/host";
import { BrainSettingsOperationError } from "../settings/contracts";
import { BrainConnectionState } from "./connection-state";
import { BrainResource } from "./resource";
import { statusToView, screenAccess } from "./status-mapping";
import {
  catalogToView,
  quantsToView,
  profileToView,
  jobToView,
  evalsToView,
} from "./library-mapping";

const Accepted = z.object({ accepted: z.literal(true) });
const Candidate = z.object({ id: z.string(), build: z.string(), variant: z.string() });
function derived<T>(data: T, refresh: () => Promise<void>): BrainView<T> {
  return {
    data,
    refetch: refresh,
    error: null,
    isLoading: false,
    isFetching: false,
    isError: false,
  };
}
export class BrainScreenFacade implements BrainScreenPort {
  readonly version = 1;
  readonly ui: BrainUiBridge;
  readonly operations: BrainScreenOperations;
  private readonly listeners = new Set<() => void>();
  private snapshot!: BrainScreenSnapshot;
  private uiSnapshot!: BrainUiSnapshot;
  private resources: BrainResources | null = null;
  private telemetry: BrainTelemetry | null = null;
  private resourceDemand = 0;
  private resourceTimer: ReturnType<typeof setTimeout> | null = null;
  private resourcePending = false;
  private resourceReadId: string | null = null;
  private ownerKey = "";
  private modelKey = "";
  private jobRevision = -1;
  private libraryRevision = -1;
  private preferences: { contentMaxWidth: number | null; outlinePadding: number } = {
    contentMaxWidth: null,
    outlinePadding: 16,
  };
  private readonly releaseCore: () => void;
  private readonly reads;
  constructor(
    readonly core: BrainConnectionState,
    private readonly host: { serverId: string; label: string },
    navigation: { openBrain(): void; openSettings(): void },
  ) {
    const changed = () => this.publish();
    const inventory = new BrainResource(
      async () => this.query({ resource: "inventory" }, BrainInventorySchema),
      changed,
    );
    this.reads = {
      inventory,
      catalog: new BrainResource(
        async () => catalogToView(await this.query({ resource: "catalog" }, BrainCatalogSchema)),
        changed,
      ),
      modelNames: new BrainResource(
        async () =>
          (await inventory.read()).models.map((model) => ({
            modelId: model.id,
            label: model.displayName,
          })),
        changed,
      ),
      runtimes: new BrainResource(
        async () => (await this.query({ resource: "runtimes" }, BrainRuntimeListSchema)).runtimes,
        changed,
      ),
      jobs: new BrainResource(
        async () =>
          (await this.query({ resource: "jobs" }, BrainJobListSchema)).jobs.map(jobToView),
        changed,
      ),
      evals: new BrainResource(
        async () => evalsToView(await this.query({ resource: "evals" }, BrainEvalsSchema)),
        changed,
      ),
    };
    this.ui = {
      version: 1,
      getSnapshot: () => this.uiSnapshot,
      subscribe: this.subscribe,
      retainStatus: core.retain,
      ...navigation,
    };
    this.operations = this.createOperations();
    this.releaseCore = core.subscribe(() => this.coreChanged());
    this.publish();
  }
  getSnapshot = () => this.snapshot;
  setPresentation(label: string, contentMaxWidth: number, outlinePadding: number): void {
    if (
      this.host.label === label &&
      this.preferences.contentMaxWidth === contentMaxWidth &&
      this.preferences.outlinePadding === outlinePadding
    )
      return;
    this.host.label = label;
    this.preferences = { contentMaxWidth, outlinePadding };
    this.publish();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(): void {
    const state = this.core.getSnapshot();
    const status = statusToView(state, this.resources, this.telemetry);
    const mode = state.connection?.config.mode ?? "local";
    this.uiSnapshot = {
      serverId: this.host.serverId,
      enabled: state.connection?.config.enabled,
      connection: state.connected ? "connected" : "disconnected",
      status,
    };
    this.snapshot = {
      host: {
        ...this.host,
        connected: state.connected,
        connectionStatus: state.connected ? "connected" : "disconnected",
        mode,
        access: screenAccess(state),
      },
      preferences: {
        runtimeSelectionId: state.owner?.config.runtime.selectionId ?? null,
        ...this.preferences,
      },
      modelRevision: state.feed?.status?.libraryRevision ?? 0,
      status: derived(status, () => this.core.refresh()),
      logs: derived(
        {
          lines: state.feed?.logs.map((line) => line.line) ?? [],
          total: state.feed?.nextLogIndex ?? 0,
          state: status.state ?? "stopped",
        },
        async () => {},
      ),
      inventory: this.reads.inventory.getSnapshot(),
      catalog: this.reads.catalog.getSnapshot(),
      modelNames: this.reads.modelNames.getSnapshot(),
      runtimes: this.reads.runtimes.getSnapshot(),
      jobs: this.reads.jobs.getSnapshot(),
      evals: this.reads.evals.getSnapshot(),
    };
    for (const listener of this.listeners) listener();
  }
  private coreChanged(): void {
    const state = this.core.getSnapshot();
    const key = JSON.stringify([state.connection?.revision, state.feed?.status?.instanceId]);
    if (key !== this.ownerKey) {
      this.ownerKey = key;
      this.resources = null;
      this.telemetry = null;
      for (const read of Object.values(this.reads)) read.invalidate();
      for (const read of Object.values(this.reads)) read.refreshDemanded();
    }
    const models = JSON.stringify(
      state.feed?.status?.residents.map((row) => [row.modelId, row.residentId, row.state]),
    );
    if (models !== this.modelKey) {
      this.modelKey = models;
      this.reads.inventory.refreshDemanded();
      this.reads.modelNames.refreshDemanded();
    }
    const revision = state.feed?.status?.jobRevision ?? -1;
    if (revision !== this.jobRevision) {
      this.jobRevision = revision;
      this.reads.jobs.refreshDemanded();
    }
    const library = state.feed?.status?.libraryRevision ?? -1;
    if (library !== this.libraryRevision) {
      this.libraryRevision = library;
      for (const [resourceKey, read] of Object.entries(this.reads))
        if (resourceKey !== "jobs") read.refreshDemanded();
    }
    this.publish();
  }
  private async request<T>(method: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
    const revision = this.core.getSnapshot().connection?.revision;
    const instance = this.core.getSnapshot().feed?.status?.instanceId;
    const result = await this.core.rpc.request(method, input, schema);
    if (
      revision !== this.core.getSnapshot().connection?.revision ||
      instance !== this.core.getSnapshot().feed?.status?.instanceId
    )
      throw new BrainSettingsOperationError(
        "conflict",
        "The Brain connection changed. Refresh before continuing.",
      );
    return result;
  }
  private query<T>(query: BrainQuery, schema: z.ZodType<T>): Promise<T> {
    return this.request("brain.query", query, schema);
  }
  private action<T>(action: BrainAction, schema: z.ZodType<T>): Promise<T> {
    return this.request("brain.action", action, schema);
  }
  retain = (demand: BrainDemand): (() => void) => {
    const releaseCore = demand === "logs" ? this.core.retainLogs() : this.core.retain();
    let releaseResource = () => {};
    if (demand === "statusResources") {
      if (++this.resourceDemand === 1) void this.sampleResources();
      releaseResource = () => {
        if (--this.resourceDemand === 0) {
          this.cancelResourceRead();
          if (this.resourceTimer) clearTimeout(this.resourceTimer);
          this.resourceTimer = null;
        }
      };
    } else if (demand !== "status" && demand !== "logs")
      releaseResource = this.reads[demand].retain();
    let released = false;
    return () => {
      if (!released) {
        released = true;
        releaseResource();
        releaseCore();
      }
    };
  };
  private cancelResourceRead(): void {
    if (!this.resourceReadId) return;
    const requestId = this.resourceReadId;
    this.resourceReadId = null;
    void this.core.rpc
      .request("brain.resources.release", { requestId }, z.object({ released: z.literal(true) }))
      .catch(() => {});
  }
  private async sampleResources(): Promise<void> {
    if (!this.resourceDemand || this.resourcePending) return;
    this.resourcePending = true;
    const requestId = globalThis.crypto.randomUUID();
    this.resourceReadId = requestId;
    try {
      const value = await this.query({ resource: "resources", requestId }, BrainResourcesSchema);
      if (this.resourceDemand && this.resourceReadId === requestId) {
        this.telemetry = value.telemetry;
        this.resources = {
          ...value,
          gpu: value.gpu
            ? {
                ...value.gpu,
                driver: value.gpu.driver ?? null,
                usedBytes: value.gpu.usedBytes ?? null,
                utilization: value.gpu.utilization ?? null,
                temperature: value.gpu.temperature ?? null,
              }
            : null,
        };
        this.publish();
      }
    } catch {
      if (this.resourceDemand) {
        this.resources = null;
        this.publish();
      }
    } finally {
      if (this.resourceReadId === requestId) this.resourceReadId = null;
      this.resourcePending = false;
      if (this.resourceDemand)
        this.resourceTimer = setTimeout(() => {
          this.resourceTimer = null;
          void this.sampleResources();
        }, 2000);
    }
  }
  private async refresh(keys: readonly BrainResourceKey[]): Promise<void> {
    await Promise.all(
      keys.map((key) => {
        if (key === "status") return this.core.refresh();
        if (key === "logs") return Promise.resolve();
        return this.reads[key].refetch();
      }),
    );
  }
  private observeJob = (job: BrainJob): void => {
    const jobs = this.reads.jobs.getSnapshot().data ?? [];
    this.reads.jobs.accept([...jobs.filter((row) => row.id !== job.id), job]);
  };
  private async admit(action: BrainAction): Promise<BrainJob> {
    const job = jobToView((await this.action(action, BrainAdmittedJobSchema)).job);
    this.observeJob(job);
    return job;
  }
  private createOperations(): BrainScreenOperations {
    const lifecycle = async (action: "start" | "stop" | "restart", modelId: string | null) => {
      await this.request(
        "brain.lifecycle",
        { action, modelId },
        z.object({ accepted: z.literal(true) }),
      );
      await this.core.refresh();
    };
    const mutate = async (action: BrainAction) => {
      await this.action(action, Accepted);
      await this.refresh(["inventory", "catalog", "modelNames"]);
    };
    return {
      startHost: (id) => lifecycle("start", id),
      stopHost: () => lifecycle("stop", null),
      restartHost: (id) => lifecycle("restart", id),
      installRuntime: async (build) => {
        const candidate = await this.action(
          { action: "runtime-candidate", build: build ?? "latest" },
          Candidate,
        );
        return this.admit({ action: "install-runtime", runtimeId: candidate.id });
      },
      removeRuntime: (runtimeId) => this.admit({ action: "remove-runtime", runtimeId }),
      removeRuntimeElevated: async () => {
        throw new Error("Administrator runtime removal is not available on this host");
      },
      selectRuntime: async (runtimeId) => {
        await this.action({ action: "select-runtime", runtimeId }, Accepted);
        await this.core.refresh();
        await this.refresh(["runtimes"]);
      },
      readInventory: () => this.reads.inventory.read(),
      searchModels: async (query, limit) =>
        (await this.query({ resource: "search", query, limit }, BrainSearchSchema)).models,
      readQuants: async (repo) =>
        quantsToView(await this.query({ resource: "quants", repo }, BrainQuantsSchema)),
      pullModel: (input) =>
        this.admit({
          action: "pull",
          modelId: input.modelId,
          quant: input.quant,
          components: input.components,
        }),
      addModel: (input) =>
        this.admit({
          action: "add",
          repo: input.repo,
          quant: input.quant,
          components: input.components,
        }),
      loadModel: (modelId) => mutate({ action: "load", modelId }),
      unloadModel: (modelId) => mutate({ action: "unload", modelId }),
      renameModel: (modelId, displayName) => mutate({ action: "rename", modelId, displayName }),
      resetModelName: (modelId) => mutate({ action: "reset-name", modelId }),
      deleteModel: (modelId) => mutate({ action: "delete", modelId }),
      deleteComponent: (modelId, componentId) =>
        mutate({ action: "delete-component", modelId, componentId }),
      readProfile: async (modelId) =>
        profileToView(await this.query({ resource: "profile", modelId }, BrainProfileReadSchema)),
      saveProfile: async (modelId, patch, expectedRevision) => {
        const values = z
          .record(z.string(), z.json())
          .parse(
            Object.fromEntries(Object.entries(patch).filter((entry) => entry[1] !== undefined)),
          );
        const value = await this.action(
          { action: "save-profile", modelId, patch: values, expectedRevision },
          BrainProfileSavedSchema,
        );
        return { ...value, ...profileToView(value) };
      },
      previewBudget: (modelId, patch) =>
        this.action({ action: "budget", modelId, patch }, BrainBudgetPreviewSchema),
      calibrate: (modelId) => this.admit({ action: "job", operation: "calibrate", modelId }),
      sweep: (modelId) => this.admit({ action: "job", operation: "sweep", modelId }),
      benchmark: async (requested) => {
        const inventory = await this.reads.inventory.read();
        const modelId =
          requested ?? this.core.getSnapshot().feed?.status?.modelId ?? inventory.lastModelId;
        if (!modelId) throw new Error("Load a model before starting a benchmark");
        return this.admit({ action: "job", operation: "benchmark", modelId });
      },
      cancelJob: async (jobId) => {
        await this.action({ action: "cancel-job", jobId }, Accepted);
        return this.reads.jobs.read();
      },
      refresh: (keys) => this.refresh(keys),
      observeJob: this.observeJob,
      observeJobs: (jobs) => this.reads.jobs.accept(jobs),
      previewLifecycle: () => {
        /* Authoritative resident transitions arrive on the shared feed. */
      },
    };
  }
  close(): void {
    this.releaseCore();
    this.resourceDemand = 0;
    this.cancelResourceRead();
    if (this.resourceTimer) clearTimeout(this.resourceTimer);
    this.listeners.clear();
    for (const read of Object.values(this.reads)) read.invalidate();
  }
}

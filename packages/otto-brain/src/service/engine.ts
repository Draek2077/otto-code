/** Standalone composition of the existing host-owned model and scheduler libraries. */
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import type { Model, GpuInfo, Runtime } from "../types.js";
import type { Profile, ProfilesStore } from "../config/schema.js";
import { loadCatalog, loadProfilesStore, saveProfilesStore } from "../config/store.js";
import { forModel, getCalibrationForBudget } from "../config/profiles.js";
import {
  scanModels,
  pickModel,
  diskUsage,
  totalModelBytes,
  managedModelsDir,
  downloadRepoFiles,
  listRepoQuants,
  searchModels,
  resolveHfToken,
} from "../models/index.js";
import { listAllRuntimes, resolveRuntime, runtimeBuild } from "../runtime/index.js";
import { query, usedBytes } from "../gpu.js";
import { budget, fitToBudget, reserveBytesForGpu } from "../vram.js";
import { createCpuSampler, SlotActivityTracker, type SlotInfo } from "../sysmon.js";
import { resolveVersion } from "../version.js";
import { EngineProcess, allocateEnginePort } from "./engine-process.js";
import { Supervisor } from "./supervisor.js";
import { Scheduler } from "./scheduler.js";
import { ModelProcessPool, type ManagedModelProcess } from "./process-pool.js";
import { ReasoningTracker } from "./activity.js";
import { BrainStatusPublisher, BrainLogPublisher } from "./status-events.js";
import { decideModelGate } from "./model-gate.js";
import { engineJson } from "./engine-http.js";
import { readObject, requestLifetime, RequestError, sendJson } from "./http-body.js";
import { proxyCompletion } from "./inference-proxy.js";
import { serveEngineEvents } from "./engine-events.js";
import type { BrainRuntime, BrainRuntimeContext } from "./serve.js";
import { BrainJobs } from "./jobs.js";
import { ModelProfiles } from "./model-profiles.js";
import { ModelOperations } from "./model-operations.js";
import { EngineManagement } from "./engine-management.js";
import { buildInventoryRow, type InventoryState } from "./inventory.js";
import { providerModel } from "./provider-catalog.js";
import {
  loadAll,
  rankModels,
  latestPerConfig,
  variance,
  type RankedModel,
  type RunRecord,
} from "../ops/results.js";
import { ModelLibrary } from "./model-library.js";
import { createRuntimeManagement } from "./runtime-host.js";
import type { RuntimeManagement } from "./runtime-management.js";
import { ModelAcquisition } from "./model-acquisition.js";
import { BrainOwnerSettings } from "./owner-settings.js";
import { handleOwnerSettings } from "./owner-settings-http.js";
import { BrainResourceReader, type BrainHostResources } from "./resource-reader.js";
import { CompletionTelemetry } from "./completion-telemetry.js";

interface ResidentSignals {
  reasoning: ReasoningTracker;
  slots: SlotActivityTracker;
}
export interface HostEnginePorts {
  scan?(): Model[];
  profiles?(): ProfilesStore;
  saveProfiles?(store: ProfilesStore): void;
  createSupervisor?(): Promise<Supervisor>;
  gpu?(signal: AbortSignal): Promise<GpuInfo | null>;
  readUsedBytes?(signal?: AbortSignal): Promise<number | null>;
  runtime?(): Runtime | null;
  runtimeList?(): Runtime[];
  ranking?(): RankedModel[];
  results?(): RunRecord[];
  resourceSample?(signal: AbortSignal): Promise<BrainHostResources>;
}
const COMPLETIONS = new Set([
  "/v1/chat/completions",
  "/v1/completions",
  "/completion",
  "/v1/messages",
]);
const MODEL_LISTS = new Set(["/v1/models", "/api/v0/models"]);

export class HostEngine implements BrainRuntime {
  readonly pool: ModelProcessPool<EngineProcess>;
  readonly events = new BrainStatusPublisher();
  readonly logs = new BrainLogPublisher();
  private jobRevision = 0;
  private libraryRevision = 0;
  private terminalJobs = "";
  private settingsRevision: string | null = null;
  private settingsCheckedAt = 0;
  readonly jobs = new BrainJobs(() => {
    this.jobRevision++;
    const terminal = this.jobs
      .summaries()
      .filter((job) => job.state !== "queued" && job.state !== "running")
      .map((job) => `${job.id}:${job.state}`)
      .join(",");
    if (terminal !== this.terminalJobs) {
      this.terminalJobs = terminal;
      this.libraryRevision++;
    }
    this.events.notify();
  });
  readonly modelProfiles: ModelProfiles;
  readonly modelOperations: ModelOperations;
  private readonly management: EngineManagement;
  private readonly library: ModelLibrary;
  private readonly runtimeManagement: RuntimeManagement;
  private readonly acquisition: ModelAcquisition;
  private readonly settings: BrainOwnerSettings;
  private readonly resources: BrainResourceReader<BrainHostResources>;
  private readonly telemetry = new CompletionTelemetry();
  get capabilities() {
    return {
      apiVersion: 3,
      writable: this.context.config.allowRemoteConfig,
      load: true,
      inventory: true,
      events: true,
      liveInference: true,
      logEvents: true,
      logCursors: true,
      processPool: true,
      profiles: true,
      profileRevisions: true,
      budget: true,
      jobs: true,
      delete: true,
      rename: true,
      reset: true,
      runtimes: true,
      catalog: true,
      hfSearch: true,
      modelAcquisition: true,
      benchmarkOptions: true,
      ownerSettings: true,
      ownerSettingsChoices: true,
      networkDiscovery: true,
      resources: true,
    };
  }
  private readonly lifetime = new AbortController();
  private signals = new WeakMap<EngineProcess, ResidentSignals>();
  private readonly scan: () => Model[];
  private catalogCache: Model[] | null = null;
  private readonly profiles: () => ProfilesStore;
  private readonly gpu: NonNullable<HostEnginePorts["gpu"]>;
  private readonly runtime: () => Runtime | null;
  private readonly ranking: () => RankedModel[];
  private readonly results: () => RunRecord[];

  models(refresh = false): Model[] {
    if (refresh || !this.catalogCache) this.catalogCache = this.scan();
    return this.catalogCache;
  }

  constructor(
    readonly context: BrainRuntimeContext,
    ports: HostEnginePorts = {},
  ) {
    this.scan = ports.scan ?? (() => scanModels(context.config, context.env));
    this.profiles = ports.profiles ?? (() => loadProfilesStore(context.paths));
    this.runtime = ports.runtime ?? (() => resolveRuntime(context.config, context.env));
    this.results = ports.results ?? (() => loadAll(context.env));
    this.ranking = ports.ranking ?? (() => rankModels(this.results()));
    const ownedRuntime = ports.runtime;
    this.settings = new BrainOwnerSettings(context, {
      runtimes: ports.runtimeList ?? (() => listAllRuntimes(context.env)),
      resolve: ownedRuntime
        ? () => ownedRuntime()
        : (config) => resolveRuntime(config, context.env),
      changed: () => {
        this.settingsCheckedAt = 0;
        this.events.notify();
      },
      models: () => this.models().map((model) => ({ id: model.id, label: model.displayName })),
    });
    this.gpu = ports.gpu ?? (async (signal) => query(this.availableRuntime(), signal));
    const cpu = createCpuSampler();
    this.resources = new BrainResourceReader(
      ports.resourceSample ??
        (async (signal) => {
          const gpu = await this.gpu(signal);
          signal.throwIfAborted();
          const ramTotalBytes = os.totalmem();
          return {
            cpu: cpu(),
            cpuCount: os.cpus().length,
            ramUsedBytes: ramTotalBytes - os.freemem(),
            ramTotalBytes,
            gpu,
          };
        }),
    );
    const create =
      ports.createSupervisor ??
      (async () => {
        const runtime = this.runtime();
        if (!runtime) throw new Error("Install a Brain runtime before loading a model");
        return new Supervisor({
          runtime,
          paths: context.paths,
          getProfilesStore: this.profiles,
          internalPort: await allocateEnginePort(),
          readUsedBytes: ports.readUsedBytes ?? usedBytes,
        });
      });
    const createProcess = () => {
      const process = new EngineProcess(create);
      const reasoning = new ReasoningTracker();
      this.signals.set(process, { reasoning, slots: new SlotActivityTracker() });
      reasoning.onChange(() => this.events.notify());
      process.on("state", () => this.events.notify());
      process.on("log", (line: string) => this.logs.publish(line));
      return process;
    };
    this.pool = new ModelProcessPool({
      initialSupervisor: createProcess(),
      maxModels: context.config.maxLoadedModels,
      createSupervisor: createProcess,
      createScheduler: (supervisor, loadModel, onChange) =>
        new Scheduler({
          supervisor,
          loadModel,
          onChange,
          freeSlots: async () => {
            const slots = await this.sampleSlots(supervisor);
            return slots ? { idle: slots.idle, ids: slots.idleSlots } : null;
          },
          eraseSlot: async (slot) => {
            await engineJson(
              supervisor.upstream,
              `/slots/${slot}?action=erase`,
              this.lifetime.signal,
              "POST",
            );
          },
        }),
      loadModel: async (process, model, reserved, profile, signal) =>
        this.load(process, model, reserved, profile, signal),
      onChange: () => this.events.notify(),
    });
    this.events.setSource(() => this.snapshot());
    this.modelProfiles = new ModelProfiles(context.config, {
      read: this.profiles,
      write: ports.saveProfiles ?? ((store) => saveProfilesStore(store, context.paths)),
      runtimeBuild: () => runtimeBuild(this.availableRuntime()),
    });
    this.modelOperations = new ModelOperations(this.jobs, {
      env: context.env,
      profiles: this.modelProfiles,
      gpu: this.gpu,
      readUsedBytes: ports.readUsedBytes ?? usedBytes,
      operation: (model, kind, run, signal) => this.operation(model, kind, run, signal),
    });
    this.management = new EngineManagement({
      config: context.config,
      models: (refresh) => this.models(refresh),
      profiles: this.modelProfiles,
      readProfiles: this.profiles,
      gpu: this.gpu,
      operations: this.modelOperations,
      jobs: this.jobs,
      requireWrite: (request) => this.requireWrite(request),
      changed: () => this.libraryChanged(),
      inventory: (signal) => this.inventory(signal),
      requiresRestart: (modelId, revision) => this.requiresRestart(modelId, revision),
    });
    this.library = new ModelLibrary({
      paths: context.paths,
      models: (refresh) => this.models(refresh),
      isModelInUse: (id) => this.pool.isModelInUse(id),
      jobs: this.jobs,
      changed: () => this.libraryChanged(),
      requireWrite: (request) => this.requireWrite(request),
    });
    this.runtimeManagement = createRuntimeManagement(context, {
      jobs: this.jobs,
      list: ports.runtimeList,
      selected: this.runtime,
      isRuntimeInUse: (runtime) => this.runtimeInUse(runtime),
      changed: () => this.libraryChanged(),
      requireWrite: (request) => this.requireWrite(request),
    });
    this.acquisition = new ModelAcquisition({
      jobs: this.jobs,
      models: () => this.models(),
      catalog: () => loadCatalog(context.paths).models,
      destination: () => managedModelsDir(context.config, context.env),
      token: () => resolveHfToken(context.config, context.env),
      quants: listRepoQuants,
      search: (searchText, limit, token, signal) =>
        searchModels(searchText, { limit, token, signal }),
      download: downloadRepoFiles,
      changed: () => {
        this.models(true);
        this.libraryChanged();
      },
      requireWrite: (request) => this.requireWrite(request),
    });
  }

  private libraryChanged(): void {
    this.libraryRevision++;
    this.events.notify();
  }
  private ownerRevision(): string | null {
    const now = Date.now();
    if (now - this.settingsCheckedAt >= 1000) {
      this.settingsCheckedAt = now;
      this.settingsRevision = this.settings.revision();
    }
    return this.settingsRevision;
  }

  private runtimeInUse(runtime: Runtime): boolean {
    if (this.pool.stats().queued > 0) return true;
    if (
      this.jobs
        .summaries()
        .some(
          (job) =>
            (job.state === "queued" || job.state === "running") && job.subject.modelId !== null,
        )
    )
      return true;
    return this.pool
      .supervisors()
      .some(
        (process) =>
          process.state === "starting" ||
          process.state === "stopping" ||
          (process.runtime?.exe === runtime.exe && process.state !== "stopped"),
      );
  }

  /** Discovery and settings remain usable while an explicit saved executable needs repair. */
  private availableRuntime(): Runtime | null {
    try {
      return this.runtime();
    } catch {
      return null;
    }
  }

  async inventory(signal: AbortSignal) {
    const gpu = await this.gpu(signal);
    signal.throwIfAborted();
    const catalog = this.models();
    const store = this.profiles();
    const ranking = this.ranking();
    const build = runtimeBuild(this.availableRuntime());
    const models = catalog.map((model) => ({
      ...buildInventoryRow({
        model,
        store,
        defaults: this.context.config.defaults,
        gpu,
        ranking,
        state: this.inventoryState(model.id),
        runtimeBuild: build,
      }),
      revision: this.modelProfiles.revision(model, store),
    }));
    const disk = await diskUsage(managedModelsDir(this.context.config, this.context.env));
    signal.throwIfAborted();
    return {
      models,
      lastModelId: store.lastModelId,
      disk: disk ? { ...disk, modelBytes: totalModelBytes(catalog) } : null,
    };
  }

  private inventoryState(modelId: string): InventoryState {
    const resident = this.pool.supervisorFor(modelId);
    if (resident?.state === "starting") return "loading";
    if (resident?.state === "stopping") return "unloading";
    const stats = this.pool.stats();
    if (
      stats.active?.modelId === modelId ||
      (resident && (this.signals.get(resident)?.reasoning.snapshot.activeRequests ?? 0) > 0)
    )
      return "active";
    if ((stats.waitingModelIds[modelId] ?? 0) > 0) return "queued";
    return resident?.state === "ready" ? "loaded" : "not-loaded";
  }

  private async load(
    process: EngineProcess,
    model: Model,
    reserved: number,
    temporary: Profile | undefined,
    signal: AbortSignal,
  ): Promise<number> {
    const store = this.profiles();
    const profile = temporary ?? forModel(store, model, this.context.config.defaults);
    const revision = temporary ? null : this.modelProfiles.revision(model, store);
    if (!temporary) process.logVerbosity = this.context.config.runtime.logVerbosity;
    process.profileRevision = null;
    const calibration = getCalibrationForBudget(store, model, profile);
    const gpu = await this.gpu(signal);
    signal.throwIfAborted();
    let selected = profile;
    let reservation = 0;
    process.fit = null;
    process.gpu = gpu;
    if (gpu) {
      const fit = fitToBudget({
        model,
        profile,
        calibration,
        totalVramBytes: gpu.totalBytes,
        reserveBytes: reserveBytesForGpu(gpu) + reserved,
      });
      if (!fit.budget.fits) throw new Error("Brain model does not fit the available memory budget");
      // An explicit calibration/sweep profile must be measured exactly as requested.
      if (temporary && fit.adjusted)
        throw new Error("Brain operation profile exceeds the available memory budget");
      selected = fit.profile;
      process.fit = fit;
      reservation = budget({
        model,
        profile: selected,
        calibration,
        totalVramBytes: gpu.totalBytes,
      }).totalBytes;
    }
    await process.stop();
    this.signals.set(process, {
      reasoning: new ReasoningTracker(),
      slots: new SlotActivityTracker(),
    });
    this.signals.get(process)!.reasoning.onChange(() => this.events.notify());
    signal.throwIfAborted();
    await process.start(model, selected, signal);
    this.telemetry.resetModel(model.id);
    process.profileRevision = revision;
    return reservation;
  }

  status(): { state: string; model: string | null; modelId: string | null } {
    const residents = this.pool.residentSupervisors();
    const primary =
      residents.find((process) => process.model?.id === this.context.config.defaultModel) ??
      residents[0];
    return {
      state: primary?.state ?? "stopped",
      model: primary?.model?.displayName ?? null,
      modelId: primary?.model?.id ?? null,
    };
  }

  private async sampleSlots(process: EngineProcess): Promise<SlotInfo | null> {
    if (process.state !== "ready") return null;
    const residentId = process.residentId;
    try {
      const rows = await engineJson(process.upstream, "/slots", this.lifetime.signal);
      if (residentId !== process.residentId || process.state !== "ready" || !Array.isArray(rows))
        return null;
      return this.signals.get(process)!.slots.sample(rows);
    } catch {
      return null;
    }
  }

  async snapshot(): Promise<Record<string, unknown>> {
    const residents = await Promise.all(
      this.pool.residentSupervisors().map(async (process) => {
        const slots = await this.sampleSlots(process);
        const inference = this.signals.get(process)!.reasoning.snapshot;
        return Object.assign(this.statusFor(process), {
          slots,
          inference,
          reasoning: inference.thinking > 0,
        });
      }),
    );
    const stats = this.pool.stats();
    return {
      ...this.status(),
      version: resolveVersion(),
      apiVersion: 3,
      instanceId: this.context.instanceId,
      running: true,
      reachable: true,
      residents,
      scheduler: stats,
      queued: stats.queued,
      jobs: this.jobs.summaries(),
      jobRevision: this.jobRevision,
      libraryRevision: this.libraryRevision,
      ownerSettingsRevision: this.ownerRevision(),
      telemetry: this.telemetry.snapshot(),
      capabilities: this.capabilities,
    };
  }

  private statusFor(process: EngineProcess) {
    return {
      residentId: process.residentId,
      modelId: process.model?.id ?? null,
      model: process.model?.displayName ?? null,
      state: process.state,
      loadSeconds: process.loadSeconds,
      vramBytes: process.vramAtReadyBytes,
      startedAt: process.startedAt?.toISOString() ?? null,
    };
  }

  /** All model-targeted operations share the same process pool as inference. */
  async operation<T>(
    model: Model,
    kind: "calibrate" | "sweep" | "benchmark",
    run: (process: ManagedModelProcess<EngineProcess>) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return (await this.pool.submitOperation(model, run, {
      kind,
      signal: signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal,
    })) as T;
  }

  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const route = request.url?.split("?")[0] ?? "";
    if (request.method === "GET" && route === "/__host/events") {
      serveEngineEvents(response, this.events, this.logs, this.context.instanceId);
      return true;
    }
    const lifetime = requestLifetime(response, this.lifetime.signal);
    try {
      if (await this.handleManagement(request, response, route, lifetime.signal)) return true;
      if (request.method === "GET" && MODEL_LISTS.has(route)) {
        const profiles = this.profiles();
        const models = [...this.models()].sort(
          (left, right) =>
            Number(right.id === this.context.config.defaultModel) -
            Number(left.id === this.context.config.defaultModel),
        );
        sendJson(response, 200, {
          object: "list",
          data: models.map((model) => {
            const resident = this.pool.supervisorFor(model.id);
            return providerModel(
              model,
              resident?.profile ?? forModel(profiles, model, this.context.config.defaults),
              resident?.state ?? "not-loaded",
            );
          }),
        });
        return true;
      }
      if (
        request.method === "POST" &&
        (route === "/__host/model/load" || route === "/__host/model/unload")
      ) {
        await this.control(request, route, lifetime.signal);
        sendJson(response, 200, { ok: true });
        return true;
      }
      if (request.method !== "POST" || !COMPLETIONS.has(route)) return false;
      if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json"))
        throw new RequestError(415, "Brain completions require application/json");
      await this.complete(request, response, route, lifetime.signal);
      return true;
    } catch (error) {
      sendEngineError(response, error);
      return true;
    } finally {
      lifetime.dispose();
    }
  }

  private async handleManagement(
    request: IncomingMessage,
    response: ServerResponse,
    route: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (request.method === "GET" && route === "/__host/evals") {
      const records = this.results();
      sendJson(response, 200, {
        rankings: rankModels(records),
        latest: latestPerConfig(records),
        variance: variance(records),
        runCount: records.length,
      });
      return true;
    }
    if (request.method === "GET" && route === "/__host/resources") {
      sendJson(response, 200, {
        ...(await this.resources.read(signal)),
        telemetry: this.telemetry.snapshot(),
      });
      return true;
    }
    if (
      await handleOwnerSettings(this.settings, request, response, signal, (ownerRequest) =>
        this.requireWrite(ownerRequest),
      )
    )
      return true;
    for (const handler of [this.runtimeManagement, this.acquisition, this.library, this.management])
      if (await handler.handle(request, response, signal)) return true;
    return false;
  }

  private async control(
    request: IncomingMessage,
    route: string,
    signal: AbortSignal,
  ): Promise<void> {
    this.requireWrite(request);
    const modelId = new URL(request.url!, "http://brain.local").searchParams.get("id") ?? undefined;
    if (route === "/__host/model/load") {
      if (!modelId) throw new RequestError(400, "A model id is required");
      const model = pickModel(this.models(), modelId);
      await this.pool.reload(
        model,
        () => this.requiresRestart(model.id, this.modelProfiles.revision(model)),
        signal,
      );
    } else await this.pool.unload(modelId);
  }

  private requiresRestart(modelId: string, revision: string): boolean {
    const resident = this.pool.supervisorFor(modelId);
    if (!resident || resident.state !== "ready") return false;
    if (resident.profileRevision !== revision) return true;
    try {
      return resident.runtime?.exe !== this.runtime()?.exe;
    } catch {
      return true;
    }
  }

  private async complete(
    request: IncomingMessage,
    response: ServerResponse,
    route: string,
    signal: AbortSignal,
  ): Promise<void> {
    const body = await readObject(request, signal, 64 * 1024 * 1024);
    const requested = typeof body.model === "string" ? body.model : null;
    const models = this.models();
    const resolved = this.resolveModel(models, requested);
    const selected = new Set(this.context.config.lockedModels);
    if (selected.size === 0 && this.context.config.defaultModel)
      selected.add(this.context.config.defaultModel);
    const gate = decideModelGate({
      lockModel: this.context.config.lockModel,
      requestedName: requested,
      pinned: null,
      pinnedModels: models.filter((model) => selected.has(model.id)),
      resolved,
    });
    if (!gate.ok) throw new RequestError(gate.status, gate.message);
    let slot: number | null = null;
    await this.pool.submit(
      gate.model,
      (process) =>
        proxyCompletion({
          engine: process,
          model: gate.model,
          body,
          slot,
          route,
          response,
          tracker: this.signals.get(process)!.reasoning,
          telemetry: this.telemetry,
          signal,
        }),
      {
        signal,
        session: typeof body.prompt_cache_key === "string" ? body.prompt_cache_key : null,
        onSlotFree: (id) => {
          slot = id;
        },
        abandoned: () => response.destroyed,
      },
    );
  }

  private resolveModel(models: Model[], requested: string | null): Model | null {
    const name = requested ?? this.context.config.defaultModel;
    if (name)
      return models.find((model) => model.id === name || model.displayName === name) ?? null;
    const resident = this.pool.residentSupervisors()[0]?.model;
    return resident ?? (models.length === 1 ? models[0]! : null);
  }

  private requireWrite(request: IncomingMessage): void {
    // Management goes through the owning CLI/daemon, never a web page's ambient localhost access.
    if (request.headers.origin)
      throw new RequestError(403, "Use the owning daemon to manage Brain");
    const address = request.socket.remoteAddress;
    if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") return;
    if (!this.context.config.allowRemoteConfig)
      throw new RequestError(403, "Remote Brain management is read-only");
  }

  async stop(_signal: AbortSignal): Promise<void> {
    this.lifetime.abort(new Error("Brain host stopped"));
    this.events.close();
    const resourcesStopped = this.resources.close();
    const jobsStopped = this.jobs.close();
    await this.pool.stop();
    await jobsStopped;
    await resourcesStopped;
    this.signals = new WeakMap();
  }
}

function sendEngineError(response: ServerResponse, error: unknown): void {
  if (!response.destroyed && !response.headersSent)
    sendJson(response, error instanceof RequestError ? error.status : 503, {
      error: error instanceof RequestError ? error.message : "Brain operation failed",
    });
  else if (!response.writableEnded) response.destroy();
}

/** Used by both the standalone command and the daemon controller after claiming a home. */
export function createHostRuntime(
  context: BrainRuntimeContext,
  ports?: HostEnginePorts,
): HostEngine {
  return new HostEngine(context, ports);
}

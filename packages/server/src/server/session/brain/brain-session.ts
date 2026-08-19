import type pino from "pino";
import type { BrainManager } from "../../brain/brain-manager.js";
import type { BrainOpsManager } from "../../brain/brain-ops-manager.js";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import {
  BrainBudgetSchema,
  BrainCalibrationInfoSchema,
  BrainCatalogModelSchema,
  BrainDiskUsageSchema,
  BrainHfSearchResultSchema,
  BrainHostingProfileSchema,
  BrainInventoryModelSchema,
  BrainJobSchema,
  BrainProfileFieldSchema,
  BrainProfileSchema,
  BrainProfileWarningSchema,
  BrainRepoQuantSchema,
  BrainRuntimeSchema,
} from "@otto-code/protocol/messages";
import type { BrainHostStatus, BrainJob } from "@otto-code/protocol/messages";
import type { SessionOutboundMessage } from "../../messages.js";
import { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";

/** Shown when the daemon lacks the brain-ops manager (feature not built in). */
const BRAIN_OPS_UNAVAILABLE = "Managing models is not available on this daemon.";

/** Shown when the daemon has no brain manager at all. */
const BRAIN_UNAVAILABLE = "The local AI host is not available on this daemon.";

/** True for a JSON object (not an array, not null). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate each element of an array the brain returned, dropping the ones that
 * do not parse. A single malformed row must not blank the whole list: the brain
 * is a separate process on a possibly older version, and partial data beats an
 * empty table with no explanation.
 */
function parseBrainArray<T>(
  value: unknown,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: T[] = [];
  for (const entry of value) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) {
      rows.push(parsed.data);
    }
  }
  return rows;
}

/** The string members of an array the brain returned. */
function parseBrainStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Everything the brain RPCs need from the owning session. Kept to `emit` so the
 * session stays the only thing that knows how to reach the wire.
 */
export interface BrainSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface BrainSessionOptions {
  host: BrainSessionHost;
  brainManager: BrainManager | null;
  brainOpsManager: BrainOpsManager | null;
  providerSnapshotManager: ProviderSnapshotManager;
  logger: pino.Logger;
}

/**
 * The Otto Brain session domain: model management, jobs, the Console proxy, and
 * host lifecycle. Extracted from `session.ts` so the dispatcher dispatches and
 * the domain owns its own logic, matching the shape Paseo uses for checkout,
 * files, voice and the rest.
 */
export class BrainSession {
  private readonly host: BrainSessionHost;
  private readonly brainManager: BrainManager | null;
  private readonly brainOpsManager: BrainOpsManager | null;
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly logger: pino.Logger;

  constructor(options: BrainSessionOptions) {
    this.host = options.host;
    this.brainManager = options.brainManager;
    this.brainOpsManager = options.brainOpsManager;
    this.providerSnapshotManager = options.providerSnapshotManager;
    this.logger = options.logger.child({ module: "brain-session" });
  }

  // The brain.host.* lifecycle RPCs, each answering with the derived host status
  // plus an error string. A start/stop/restart returns a best-effort status even
  // on failure so the dashboard can show what state the brain landed in.
  async handleBrainHostStatusRequest(requestId: string, resources: boolean): Promise<void> {
    const { status, error } = await this.resolveBrainStatus({ resources });
    this.host.emit({ type: "brain.host.status.response", payload: { status, error, requestId } });
  }

  async handleBrainHostStartRequest(model: string | null, requestId: string): Promise<void> {
    let error: string | null = null;
    if (!this.brainManager) {
      error = "The local AI host is not available on this daemon.";
    } else {
      try {
        await this.brainManager.ensureRunning(model);
      } catch (err) {
        error = getErrorMessage(err);
      }
    }
    const { status, error: statusError } = await this.resolveBrainStatus();
    this.host.emit({
      type: "brain.host.start.response",
      payload: { status, error: error ?? statusError, requestId },
    });
  }

  async handleBrainHostStopRequest(requestId: string): Promise<void> {
    let error: string | null = null;
    if (!this.brainManager) {
      error = "The local AI host is not available on this daemon.";
    } else {
      try {
        await this.brainManager.stop();
      } catch (err) {
        error = getErrorMessage(err);
      }
    }
    const { status, error: statusError } = await this.resolveBrainStatus();
    this.host.emit({
      type: "brain.host.stop.response",
      payload: { status, error: error ?? statusError, requestId },
    });
  }

  async handleBrainHostRestartRequest(model: string | null, requestId: string): Promise<void> {
    let error: string | null = null;
    if (!this.brainManager) {
      error = "The local AI host is not available on this daemon.";
    } else {
      try {
        if (this.brainManager.isRemote()) {
          await this.brainManager.remoteRestart();
        } else {
          await this.brainManager.restart(model);
        }
      } catch (err) {
        error = getErrorMessage(err);
      }
    }
    const { status, error: statusError } = await this.resolveBrainStatus();
    this.host.emit({
      type: "brain.host.restart.response",
      payload: { status, error: error ?? statusError, requestId },
    });
  }

  async handleBrainEvalsGetRequest(requestId: string): Promise<void> {
    if (!this.brainManager) {
      this.host.emit({
        type: "brain.evals.get.response",
        payload: {
          evals: null,
          error: "The local AI host is not available on this daemon.",
          requestId,
        },
      });
      return;
    }
    try {
      const evals = await this.brainManager.evals();
      this.host.emit({
        type: "brain.evals.get.response",
        payload: { evals, error: null, requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.evals.get.response",
        payload: { evals: null, error: getErrorMessage(err), requestId },
      });
    }
  }

  async handleBrainModelsListRequest(requestId: string): Promise<void> {
    if (!this.brainManager) {
      this.host.emit({
        type: "brain.models.list.response",
        payload: {
          models: [],
          error: "The local AI host is not available on this daemon.",
          requestId,
        },
      });
      return;
    }
    try {
      const models = await this.brainManager.listModels();
      this.host.emit({
        type: "brain.models.list.response",
        payload: { models, error: null, requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.models.list.response",
        payload: { models: [], error: getErrorMessage(err), requestId },
      });
    }
  }

  async handleBrainRemoteConfigGetRequest(requestId: string): Promise<void> {
    if (!this.brainManager) {
      this.host.emit({
        type: "brain.remote.config.get.response",
        payload: {
          config: null,
          error: "The local AI host is not available on this daemon.",
          requestId,
        },
      });
      return;
    }
    try {
      const config = await this.brainManager.getRemoteConfig();
      this.host.emit({
        type: "brain.remote.config.get.response",
        payload: { config, error: config ? null : "The remote brain did not answer.", requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.remote.config.get.response",
        payload: { config: null, error: getErrorMessage(err), requestId },
      });
    }
  }

  async handleBrainRemoteConfigPatchRequest(
    patch: Record<string, unknown>,
    requestId: string,
  ): Promise<void> {
    if (!this.brainManager) {
      this.host.emit({
        type: "brain.remote.config.patch.response",
        payload: {
          config: null,
          error: "The local AI host is not available on this daemon.",
          requestId,
        },
      });
      return;
    }
    try {
      const config = await this.brainManager.patchRemoteConfig(patch);
      this.host.emit({
        type: "brain.remote.config.patch.response",
        payload: { config, error: null, requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.remote.config.patch.response",
        payload: { config: null, error: getErrorMessage(err), requestId },
      });
    }
  }

  async handleBrainNetworkDiscoverRequest(requestId: string): Promise<void> {
    if (!this.brainManager) {
      this.host.emit({
        type: "brain.network.discover.response",
        payload: {
          info: null,
          error: "The local AI host is not available on this daemon.",
          requestId,
        },
      });
      return;
    }
    try {
      const info = await this.brainManager.discoverNetwork();
      this.host.emit({
        type: "brain.network.discover.response",
        payload: { info, error: null, requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.network.discover.response",
        payload: { info: null, error: getErrorMessage(err), requestId },
      });
    }
  }

  async handleBrainModelsScanRequest(requestId: string): Promise<void> {
    if (!this.brainOpsManager) {
      this.host.emit({
        type: "brain.models.scan.response",
        payload: { models: [], error: BRAIN_OPS_UNAVAILABLE, requestId },
      });
      return;
    }
    try {
      const models = await this.brainOpsManager.scanModels();
      this.host.emit({
        type: "brain.models.scan.response",
        payload: { models, error: null, requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.models.scan.response",
        payload: { models: [], error: getErrorMessage(err), requestId },
      });
    }
  }

  async handleBrainCatalogListRequest(requestId: string): Promise<void> {
    if (this.brainManager?.isRemote()) {
      try {
        const data = await this.brainManager.remoteCatalog();
        this.host.emit({
          type: "brain.catalog.list.response",
          payload: {
            models: parseBrainArray(data?.models, BrainCatalogModelSchema),
            error: null,
            requestId,
          },
        });
      } catch (err) {
        this.host.emit({
          type: "brain.catalog.list.response",
          payload: { models: [], error: getErrorMessage(err), requestId },
        });
      }
      return;
    }
    if (!this.brainOpsManager) {
      this.host.emit({
        type: "brain.catalog.list.response",
        payload: { models: [], error: BRAIN_OPS_UNAVAILABLE, requestId },
      });
      return;
    }
    try {
      const models = await this.brainOpsManager.listCatalog();
      this.host.emit({
        type: "brain.catalog.list.response",
        payload: { models, error: null, requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.catalog.list.response",
        payload: { models: [], error: getErrorMessage(err), requestId },
      });
    }
  }

  async handleBrainRuntimeListRequest(requestId: string): Promise<void> {
    if (this.brainManager?.isRemote()) {
      try {
        const data = await this.brainManager.remoteRead("/__host/runtimes");
        this.host.emit({
          type: "brain.runtime.list.response",
          payload: {
            runtimes: parseBrainArray(data?.runtimes, BrainRuntimeSchema),
            error: null,
            requestId,
          },
        });
      } catch (err) {
        this.host.emit({
          type: "brain.runtime.list.response",
          payload: { runtimes: [], error: getErrorMessage(err), requestId },
        });
      }
      return;
    }
    if (!this.brainOpsManager) {
      this.host.emit({
        type: "brain.runtime.list.response",
        payload: { runtimes: [], error: BRAIN_OPS_UNAVAILABLE, requestId },
      });
      return;
    }
    try {
      const runtimes = await this.brainOpsManager.listRuntimes();
      this.host.emit({
        type: "brain.runtime.list.response",
        payload: { runtimes, error: null, requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.runtime.list.response",
        payload: { runtimes: [], error: getErrorMessage(err), requestId },
      });
    }
  }

  async handleBrainHfSearchRequest(
    query: string,
    limit: number | null,
    requestId: string,
  ): Promise<void> {
    if (this.brainManager?.isRemote()) {
      try {
        const params = new URLSearchParams({ query, limit: String(limit ?? 25) });
        const data = await this.brainManager.remoteRead(`/__host/hf/search?${params}`);
        const raw = Array.isArray(data?.results) ? data.results : [];
        const results = parseBrainArray(
          raw.map((row) =>
            typeof row === "object" && row !== null
              ? Object.assign(row, { gated: (row as { gated?: unknown }).gated === "yes" })
              : row,
          ),
          BrainHfSearchResultSchema,
        );
        this.host.emit({
          type: "brain.hf.search.response",
          payload: { results, error: null, requestId },
        });
      } catch (err) {
        this.host.emit({
          type: "brain.hf.search.response",
          payload: { results: [], error: getErrorMessage(err), requestId },
        });
      }
      return;
    }
    if (!this.brainOpsManager) {
      this.host.emit({
        type: "brain.hf.search.response",
        payload: { results: [], error: BRAIN_OPS_UNAVAILABLE, requestId },
      });
      return;
    }
    try {
      const results = await this.brainOpsManager.searchHf(query, limit);
      this.host.emit({
        type: "brain.hf.search.response",
        payload: { results, error: null, requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.hf.search.response",
        payload: { results: [], error: getErrorMessage(err), requestId },
      });
    }
  }

  async handleBrainHfQuantsRequest(repo: string, requestId: string): Promise<void> {
    if (this.brainManager?.isRemote()) {
      try {
        const data = await this.brainManager.remoteRead(
          `/__host/hf/quants?repo=${encodeURIComponent(repo)}`,
        );
        this.host.emit({
          type: "brain.hf.quants.response",
          payload: {
            quants: parseBrainArray(data?.quants, BrainRepoQuantSchema),
            error: null,
            requestId,
          },
        });
      } catch (err) {
        this.host.emit({
          type: "brain.hf.quants.response",
          payload: { quants: [], error: getErrorMessage(err), requestId },
        });
      }
      return;
    }
    if (!this.brainOpsManager) {
      this.host.emit({
        type: "brain.hf.quants.response",
        payload: { quants: [], error: BRAIN_OPS_UNAVAILABLE, requestId },
      });
      return;
    }
    try {
      const quants = await this.brainOpsManager.repoQuants(repo);
      this.host.emit({
        type: "brain.hf.quants.response",
        payload: { quants, error: null, requestId },
      });
    } catch (err) {
      this.host.emit({
        type: "brain.hf.quants.response",
        payload: { quants: [], error: getErrorMessage(err), requestId },
      });
    }
  }

  handleBrainModelsPullRequest(
    model: string,
    components: string[] | undefined,
    quant: string | undefined,
    expectedBytes: number | undefined,
    requestId: string,
  ): void {
    if (
      this.startRemoteBrainJob(
        "pull",
        {
          model,
          ...(components ? { components } : {}),
          ...(quant ? { quant } : {}),
          ...(expectedBytes !== undefined ? { expectedBytes } : {}),
        },
        requestId,
        "brain.models.pull.response",
      )
    )
      return;
    this.startBrainJob(requestId, "brain.models.pull.response", (ops) =>
      ops.pullModel(model, components, quant, expectedBytes),
    );
  }

  handleBrainModelsAddRequest(
    repo: string,
    quant: string,
    components: string[] | undefined,
    expectedBytes: number | undefined,
    requestId: string,
  ): void {
    if (
      this.startRemoteBrainJob(
        "add",
        { repo, quant, components, ...(expectedBytes !== undefined ? { expectedBytes } : {}) },
        requestId,
        "brain.models.add.response",
      )
    )
      return;
    this.startBrainJob(requestId, "brain.models.add.response", (ops) =>
      ops.addModel(repo, quant, components, expectedBytes),
    );
  }

  handleBrainRuntimeInstallRequest(build: string | null, requestId: string): void {
    if (
      this.startRemoteBrainJob(
        "runtime-install",
        { build },
        requestId,
        "brain.runtime.install.response",
      )
    )
      return;
    this.startBrainJob(requestId, "brain.runtime.install.response", (ops) =>
      ops.installRuntime(build),
    );
  }

  handleBrainRuntimeRemoveRequest(name: string, requestId: string): void {
    // A remote brain lists its own runtimes, so the remove has to land on that
    // host too. Falling through to the local ops manager would delete a
    // same-named runtime out of this machine's OTTO_HOME instead.
    if (
      this.startRemoteBrainJob(
        "runtime-remove",
        { name },
        requestId,
        "brain.runtime.remove.response",
      )
    )
      return;
    this.startBrainJob(requestId, "brain.runtime.remove.response", (ops) =>
      ops.removeRuntime(name),
    );
  }

  handleBrainCalibrateRequest(model: string, requestId: string): void {
    if (this.startRemoteBrainJob("calibrate", { model }, requestId, "brain.calibrate.response"))
      return;
    this.host.emit({
      type: "brain.calibrate.response",
      payload: { job: null, error: "The Brain service is not running on this host.", requestId },
    });
  }

  handleBrainSweepRequest(model: string, requestId: string): void {
    if (this.startRemoteBrainJob("sweep", { model }, requestId, "brain.sweep.response")) return;
    this.host.emit({
      type: "brain.sweep.response",
      payload: { job: null, error: "The Brain service is not running on this host.", requestId },
    });
  }

  handleBrainBenchRequest(model: string | null, requestId: string): void {
    if (this.brainManager) {
      void this.brainManager
        .hostJob("bench", { model })
        .then((data) => {
          const job = BrainJobSchema.safeParse(data?.job);
          this.host.emit({
            type: "brain.bench.response",
            payload: {
              job: job.success ? job.data : null,
              error: job.success ? null : "Invalid remote job response.",
              requestId,
            },
          });
          return null;
        })
        .catch((error) =>
          this.host.emit({
            type: "brain.bench.response",
            payload: { job: null, error: getErrorMessage(error), requestId },
          }),
        );
      return;
    }
    this.host.emit({
      type: "brain.bench.response",
      payload: { job: null, error: "The Brain service is not running on this host.", requestId },
    });
  }

  private startRemoteBrainJob(
    route: string,
    body: Record<string, unknown>,
    requestId: string,
    responseType:
      | "brain.models.pull.response"
      | "brain.models.add.response"
      | "brain.runtime.install.response"
      | "brain.runtime.remove.response"
      | "brain.calibrate.response"
      | "brain.sweep.response",
  ): boolean {
    if (!this.brainManager) return false;
    void this.brainManager
      .hostJob(route, body)
      .then((data) => {
        const job = BrainJobSchema.safeParse(data?.job);
        this.host.emit({
          type: responseType,
          payload: {
            job: job.success ? job.data : null,
            error: job.success ? null : "Invalid remote job response.",
            requestId,
          },
        });
        return null;
      })
      .catch((error) =>
        this.host.emit({
          type: responseType,
          payload: { job: null, error: getErrorMessage(error), requestId },
        }),
      );
    return true;
  }

  // Shared shape for the five job-starting RPCs: start the job (synchronously)
  // and reply with the created job, or the reason it was refused.
  private startBrainJob(
    requestId: string,
    responseType:
      | "brain.models.pull.response"
      | "brain.models.add.response"
      | "brain.runtime.install.response"
      | "brain.runtime.remove.response"
      | "brain.calibrate.response"
      | "brain.sweep.response"
      | "brain.bench.response",
    start: (ops: BrainOpsManager) => BrainJob,
  ): void {
    if (!this.brainOpsManager) {
      this.host.emit({
        type: responseType,
        payload: { job: null, error: BRAIN_OPS_UNAVAILABLE, requestId },
      });
      return;
    }
    try {
      const job = start(this.brainOpsManager);
      this.host.emit({ type: responseType, payload: { job, error: null, requestId } });
    } catch (err) {
      this.host.emit({
        type: responseType,
        payload: { job: null, error: getErrorMessage(err), requestId },
      });
    }
  }

  /**
   * Brain work runs in two lanes and both are real at the same time. Library
   * downloads and runtime installs are daemon-owned CLI jobs the Brain host
   * cannot see; calibrate, sweep, and bench are host-owned jobs the daemon does
   * not spawn. Preferring one owner made the other lane's jobs unreportable and
   * uncancellable, so every reader merges them.
   */
  private async listBrainJobs(): Promise<{ jobs: BrainJob[]; error: string | null }> {
    const localJobs = this.brainOpsManager?.jobs() ?? [];
    if (!this.brainManager) {
      return this.brainOpsManager
        ? { jobs: localJobs, error: null }
        : { jobs: [], error: BRAIN_OPS_UNAVAILABLE };
    }
    try {
      const data = await this.brainManager.hostJobs();
      return { jobs: [...localJobs, ...parseBrainArray(data?.jobs, BrainJobSchema)], error: null };
    } catch (error) {
      // An unreachable host must not hide in-flight daemon downloads. Report
      // what we do know, and name the lane that could not be read.
      return this.brainOpsManager
        ? { jobs: localJobs, error: null }
        : { jobs: [], error: getErrorMessage(error) };
    }
  }

  async handleBrainJobsListRequest(requestId: string): Promise<void> {
    const { jobs, error } = await this.listBrainJobs();
    this.host.emit({ type: "brain.jobs.list.response", payload: { jobs, error, requestId } });
  }

  async handleBrainJobsCancelRequest(jobId: string, requestId: string): Promise<void> {
    // Route Cancel to the lane that actually owns this job id, rather than to
    // whichever owner happens to exist.
    const ownedLocally = this.brainOpsManager?.jobs().some((job) => job.id === jobId) === true;
    if (ownedLocally && this.brainOpsManager) {
      try {
        await this.brainOpsManager.cancel(jobId);
      } catch (err) {
        const { jobs } = await this.listBrainJobs();
        this.host.emit({
          type: "brain.jobs.cancel.response",
          payload: { jobs, error: getErrorMessage(err), requestId },
        });
        return;
      }
    } else if (this.brainManager) {
      try {
        await this.brainManager.cancelHostJob(jobId);
      } catch (error) {
        const { jobs } = await this.listBrainJobs();
        this.host.emit({
          type: "brain.jobs.cancel.response",
          payload: { jobs, error: getErrorMessage(error), requestId },
        });
        return;
      }
    } else if (!this.brainOpsManager) {
      this.host.emit({
        type: "brain.jobs.cancel.response",
        payload: { jobs: [], error: BRAIN_OPS_UNAVAILABLE, requestId },
      });
      return;
    }
    const { jobs, error } = await this.listBrainJobs();
    this.host.emit({ type: "brain.jobs.cancel.response", payload: { jobs, error, requestId } });
  }

  // --- Brain Console: proxied management RPCs -------------------------------
  // These forward to the brain's own /__host/* API through BrainManager, which
  // already resolves its endpoint by mode, so local and remote share one path.
  //
  // Every response the brain returns is untrusted JSON crossing a process (and
  // possibly a network) boundary, so each handler re-validates it through the
  // wire schema before emitting. A brain that grew a field we do not know about
  // rides through on passthrough; a brain that returned nonsense degrades to the
  // empty default rather than putting an unparseable payload on the socket.

  /** Run one management call, collapsing "no brain" and a throw into an error string. */
  private async callBrainConsole(
    call: (manager: BrainManager) => Promise<Record<string, unknown> | null>,
  ): Promise<{ data: Record<string, unknown>; error: string | null }> {
    if (!this.brainManager) {
      return { data: {}, error: BRAIN_UNAVAILABLE };
    }
    try {
      return { data: (await call(this.brainManager)) ?? {}, error: null };
    } catch (err) {
      return { data: {}, error: getErrorMessage(err) };
    }
  }

  async handleBrainModelsInventoryRequest(requestId: string): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) => manager.inventory());
    const disk = BrainDiskUsageSchema.safeParse(data.disk);
    this.host.emit({
      type: "brain.models.inventory.response",
      payload: {
        models: parseBrainArray(data.models, BrainInventoryModelSchema),
        disk: disk.success ? disk.data : null,
        error,
        requestId,
      },
    });
  }

  async handleBrainModelProfileGetRequest(modelId: string, requestId: string): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) => manager.modelProfile(modelId));
    const profile = BrainProfileSchema.safeParse(data.profile);
    const calibration = BrainCalibrationInfoSchema.safeParse(data.calibration);
    this.host.emit({
      type: "brain.model.profile.get.response",
      payload: {
        profile: profile.success ? profile.data : null,
        fields: parseBrainArray(data.fields, BrainProfileFieldSchema),
        warnings: parseBrainArray(data.warnings, BrainProfileWarningSchema),
        calibration: calibration.success ? calibration.data : null,
        requiresRestart: data.requiresRestart === true,
        hostingProfiles: parseBrainArray(data.hostingProfiles, BrainHostingProfileSchema),
        familyHostingProfileId:
          typeof data.familyHostingProfileId === "string" ? data.familyHostingProfileId : null,
        error,
        requestId,
      },
    });
  }

  async handleBrainModelProfileSetRequest(
    modelId: string,
    patch: Record<string, unknown>,
    requestId: string,
  ): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) =>
      manager.setModelProfile(modelId, patch),
    );
    const profile = BrainProfileSchema.safeParse(data.profile);
    const calibration = BrainCalibrationInfoSchema.safeParse(data.calibration);
    const budget = BrainBudgetSchema.safeParse(data.budget);
    this.host.emit({
      type: "brain.model.profile.set.response",
      payload: {
        profile: profile.success ? profile.data : null,
        fields: parseBrainArray(data.fields, BrainProfileFieldSchema),
        adjustments: parseBrainStrings(data.adjustments),
        warnings: parseBrainArray(data.warnings, BrainProfileWarningSchema),
        calibration: calibration.success ? calibration.data : null,
        budget: budget.success ? budget.data : null,
        maxContextThatFits:
          typeof data.maxContextThatFits === "number" ? data.maxContextThatFits : null,
        requiresRestart: data.requiresRestart === true,
        hostingProfiles: parseBrainArray(data.hostingProfiles, BrainHostingProfileSchema),
        familyHostingProfileId:
          typeof data.familyHostingProfileId === "string" ? data.familyHostingProfileId : null,
        error,
        requestId,
      },
    });
  }

  async handleBrainModelBudgetGetRequest(
    modelId: string,
    overrides: Record<string, string>,
    requestId: string,
  ): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) =>
      manager.modelBudget(modelId, overrides),
    );
    const profile = BrainProfileSchema.safeParse(data.profile);
    const budget = BrainBudgetSchema.safeParse(data.budget);
    this.host.emit({
      type: "brain.model.budget.get.response",
      payload: {
        profile: profile.success ? profile.data : null,
        budget: budget.success ? budget.data : null,
        maxContextThatFits:
          typeof data.maxContextThatFits === "number" ? data.maxContextThatFits : null,
        gpu: isPlainRecord(data.gpu) ? data.gpu : null,
        warnings: parseBrainArray(data.warnings, BrainProfileWarningSchema),
        error,
        requestId,
      },
    });
  }

  async handleBrainModelLoadRequest(modelId: string, requestId: string): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) => manager.loadModel(modelId));
    const profile = BrainProfileSchema.safeParse(data.profile);
    // The load reply carries the brain's own status; re-derive ours so the client
    // sees the daemon's view (pid, endpoint) rather than the brain's partial one.
    const { status } = await this.resolveBrainStatus();
    this.host.emit({
      type: "brain.model.load.response",
      payload: {
        status,
        profile: profile.success ? profile.data : null,
        error,
        requestId,
      },
    });
  }

  async handleBrainModelUnloadRequest(requestId: string): Promise<void> {
    const { error } = await this.callBrainConsole((manager) => manager.unloadModel());
    const { status } = await this.resolveBrainStatus();
    this.host.emit({ type: "brain.model.unload.response", payload: { status, error, requestId } });
  }

  async handleBrainModelDeleteRequest(modelId: string, requestId: string): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) => manager.deleteModel(modelId));
    this.host.emit({
      type: "brain.model.delete.response",
      payload: {
        deleted: parseBrainStrings(data.deleted),
        freedBytes: typeof data.freedBytes === "number" ? data.freedBytes : 0,
        includesProjector: data.includesProjector === true,
        remaining: typeof data.remaining === "number" ? data.remaining : 0,
        error,
        requestId,
      },
    });
  }

  async handleBrainModelComponentDeleteRequest(
    modelId: string,
    componentId: string,
    requestId: string,
  ): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) =>
      manager.deleteModelComponent(modelId, componentId),
    );
    this.host.emit({
      type: "brain.model.component.delete.response",
      payload: {
        deleted: parseBrainStrings(data.deleted),
        freedBytes: typeof data.freedBytes === "number" ? data.freedBytes : 0,
        error,
        requestId,
      },
    });
  }

  async handleBrainModelRenameRequest(
    modelId: string,
    displayName: string,
    requestId: string,
  ): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) =>
      manager.renameModel(modelId, displayName),
    );
    if (!error) {
      // Brain is the lmstudio-compatible provider. Refresh every materialized
      // provider snapshot so settings, workspaces, and open pickers receive
      // the new display name through the normal push path.
      void this.providerSnapshotManager
        .refreshProviderEverywhere("lmstudio")
        .catch((refreshError: unknown) =>
          this.logger.warn(
            { err: refreshError },
            "Failed to refresh the Otto Brain provider snapshot after rename",
          ),
        );
    }
    this.host.emit({
      type: "brain.model.rename.response",
      payload: {
        displayName: typeof data.displayName === "string" ? data.displayName : null,
        error,
        requestId,
      },
    });
  }

  async handleBrainModelRenameResetRequest(modelId: string, requestId: string): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) =>
      manager.resetModelName(modelId),
    );
    if (!error) {
      void this.providerSnapshotManager
        .refreshProviderEverywhere("lmstudio")
        .catch((refreshError: unknown) =>
          this.logger.warn(
            { err: refreshError },
            "Failed to refresh the Otto Brain provider snapshot after name reset",
          ),
        );
    }
    this.host.emit({
      type: "brain.model.rename.reset.response",
      payload: {
        displayName: typeof data.displayName === "string" ? data.displayName : null,
        error,
        requestId,
      },
    });
  }

  async handleBrainLogsTailRequest(limit: number | null, requestId: string): Promise<void> {
    const { data, error } = await this.callBrainConsole((manager) => manager.hostLogs(limit));
    this.host.emit({
      type: "brain.logs.tail.response",
      payload: {
        lines: parseBrainStrings(data.lines),
        total: typeof data.total === "number" ? data.total : 0,
        state: typeof data.state === "string" ? data.state : null,
        command: typeof data.command === "string" ? data.command : null,
        error,
        requestId,
      },
    });
  }

  private async resolveBrainStatus(options?: { resources?: boolean }): Promise<{
    status: BrainHostStatus;
    error: string | null;
  }> {
    if (!this.brainManager) {
      return {
        status: { running: false },
        error: BRAIN_UNAVAILABLE,
      };
    }
    try {
      return { status: await this.brainManager.status(options), error: null };
    } catch (err) {
      return { status: { running: false }, error: getErrorMessage(err) };
    }
  }
}

import type { Profile } from "./src/config/schema.js";
import type { Model } from "./src/types.js";
import type {
  BrainTuiAction,
  BrainTuiActions,
  BrainTuiActionType,
  BrainTuiHost,
  BrainTuiResult,
  BrainTuiSnapshot,
  TuiModel,
} from "./src/tui/host.js";
import type { TuiScreen } from "./src/tui/screen.js";
import { stripStyles } from "./src/tui/screen.js";

/** In-memory host/terminal adapters. No homes, processes, sockets or raw TTYs. */
export function modelRow(id = "owner/model/Q4_K_M.gguf"): TuiModel {
  const model: Model = {
    id,
    displayName: id,
    modelPath: "fixture.gguf",
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q4_K_M",
    sizeBytes: 1024 ** 3,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: { contextLength: 32768 },
    catalogHfRepo: "owner/model",
  };
  const profile: Profile = {
    modelId: id,
    modelPath: null,
    mmprojPath: null,
    enabledComponents: [],
    componentPaths: {},
    contextSize: 8192,
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    flashAttention: true,
    gpuLayers: 999,
    vision: false,
    reasoningBudget: 1536,
    reasoningBudgetMessage: "Enough analysis.",
    preserveReasoning: null,
    temperature: 0.8,
    topP: 0.95,
    topK: 40,
    minP: 0.05,
    presencePenalty: 0,
    repeatPenalty: 1,
    parallelSlots: 1,
    cachedChats: 0,
    contextMultiplier: 1,
    calibrationRequired: true,
    batchSize: null,
    ubatchSize: null,
    extraArgs: [],
    hostingProfileId: null,
    hostingProfileMode: "inherit",
    chatTemplateFile: null,
    chatTemplateKwargs: {},
    chatSystemAddendum: null,
  };
  return {
    model: { ...model, repo: "owner/model", hasProjector: false },
    profile,
    revision: "revision-1",
    calibration: null,
    calibrationStale: false,
    budget: null,
    maxContext: null,
    sweep: null,
    renamed: true,
    deleteBytes: model.sizeBytes,
    deleteBlocked: null,
    fields: [
      {
        key: "contextSize",
        label: "Context",
        kind: "number",
        min: 1024,
        max: 32768,
        step: 8192,
        available: true,
      },
      {
        key: "temperature",
        label: "Temperature",
        kind: "number",
        min: 0,
        max: 2,
        step: 0.05,
        precision: 2,
        available: true,
      },
      {
        key: "preserveReasoning",
        label: "Preserve reasoning",
        kind: "cycle",
        options: ["default", "on", "off"],
        optionValues: [null, true, false],
        available: true,
      },
    ],
    warnings: [],
  };
}

export function snapshot(): BrainTuiSnapshot {
  return {
    instanceId: "host-instance-1",
    libraryRevision: 0,
    jobRevision: 0,
    version: "fixture",
    connection: "connected",
    endpoint: null,
    state: "stopped",
    message: null,
    runtime: null,
    gpu: null,
    system: null,
    models: [modelRow()],
    residents: [],
    logs: [],
    jobs: [],
    catalog: [],
    runtimes: [],
    storage: null,
    telemetry: { requests: 0, ok: 0, reasoningOnly: 0, truncated: 0, warning: null },
    rankings: [],
    benchmarks: [],
    availableActions: [
      "refresh",
      "profile.save",
      "profile.fit",
      "model.load",
      "model.unload",
      "model.rename",
      "model.resetName",
      "model.delete",
      "hf.search",
      "hf.quants",
      "hf.add",
      "catalog.pull",
      "runtime.install",
      "runtime.select",
      "runtime.remove",
      "job.start",
      "job.cancel",
    ],
  };
}

export class MemoryTuiHost implements BrainTuiHost {
  current = snapshot();
  actions: BrainTuiAction[] = [];
  listeners = new Set<() => void>();
  retained = 0;
  wait: Promise<void> | null = null;
  transportError: Error | null = null;
  failure: Exclude<BrainTuiResult, { status: "success" }> | null = null;
  signals: (AbortSignal | undefined)[] = [];
  readonly results: { [K in BrainTuiActionType]: BrainTuiActions[K]["result"] } = {
    refresh: undefined,
    "profile.save": undefined,
    "profile.fit": { contextSize: null },
    "model.load": undefined,
    "model.unload": undefined,
    "model.rename": undefined,
    "model.resetName": undefined,
    "model.delete": undefined,
    "hf.search": [],
    "hf.quants": { repo: "owner/model", quants: [], mmproj: null },
    "hf.add": { jobId: "download-1" },
    "catalog.pull": { jobId: "download-2" },
    "runtime.install": { jobId: "runtime-1" },
    "runtime.select": undefined,
    "runtime.remove": undefined,
    "job.start": { jobId: "operation-1" },
    "job.cancel": undefined,
  };
  getSnapshot(): BrainTuiSnapshot {
    return this.current;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  retainStatus(): () => void {
    this.retained += 1;
    return () => {
      this.retained -= 1;
    };
  }
  publish(): void {
    for (const listener of this.listeners) listener();
  }
  async execute<K extends BrainTuiActionType>(
    action: BrainTuiAction<K>,
    signal?: AbortSignal,
  ): Promise<BrainTuiResult<BrainTuiActions[K]["result"]>> {
    this.actions.push(action);
    this.signals.push(signal);
    const received = this.actions[this.actions.length - 1];
    await this.wait;
    if (this.transportError) throw this.transportError;
    if (this.failure) return this.failure;
    if (action.type === "profile.save") {
      const saved = received;
      if (saved?.type === "profile.save") {
        const row = this.current.models.find((entry) => entry.model.id === saved.modelId);
        if (row) {
          row.profile = { ...row.profile, ...saved.patch };
          row.revision += "+";
        }
      }
    }
    return { status: "success", value: this.results[action.type] };
  }
}

export class MemoryScreen implements TuiScreen {
  columns = 120;
  rows = 42;
  entered = false;
  frames: string[][] = [];
  resizes = new Set<() => void>();
  enter(): void {
    this.entered = true;
  }
  leave(): void {
    this.entered = false;
  }
  render(lines: string[]): void {
    this.frames.push(lines);
  }
  invalidate(): void {}
  onResize(listener: () => void): () => void {
    this.resizes.add(listener);
    return () => {
      this.resizes.delete(listener);
    };
  }
  get text(): string {
    return (this.frames.at(-1) ?? []).map(stripStyles).join("\n");
  }
}

export async function settle(): Promise<void> {
  // Flush the finite request/save/render promise chain, without wall-clock timers.
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

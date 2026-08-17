import { Screen, box, meter, style, pad, truncate, width, onKeys } from "./screen.js";

import {
  scanModels,
  managedModelsDir,
  diskUsage,
  totalModelBytes,
  planDelete,
  deleteModelFiles,
  listRepoQuants,
  searchModels,
  downloadRepoFiles,
  resolveHfToken,
} from "../models/index.js";
import type { DiskUsage, QuantOption, RepoQuants, ModelSearchResult } from "../models/index.js";
import * as profiles from "../config/profiles.js";
import {
  formatReasoningBudget,
  loadBrainConfig,
  loadProfilesStore,
  profileWarnings,
  saveProfilesStore,
  UNRESTRICTED_REASONING_BUDGET,
} from "../config/index.js";
import * as vram from "../vram.js";
import * as gpu from "../gpu.js";
import { calibrate } from "../ops/calibrate.js";
import { sweep } from "../ops/sweep.js";
import * as results from "../ops/results.js";
import * as archive from "../ops/archive.js";
import { deleteDisplayName, loadRenameMap, updateDisplayName } from "../models/rename-map.js";
import { readJsonBody, sendError, sendJson } from "../service/http-util.js";
import { Supervisor } from "../service/supervisor.js";
import { createRouter, Telemetry } from "../service/router.js";
import * as sysmon from "../sysmon.js";
import { resolveVersion } from "../version.js";

import http from "node:http";

import type { GpuInfo, Model, ModelMetadata, Runtime } from "../types.js";
import type { Budget } from "../vram.js";
import type { Calibration, Profile, ProfilesStore } from "../config/schema.js";
import type { BenchReport, RankedModel, RunRecord, SystemHealth } from "../ops/results.js";
import type { SweepReport } from "../ops/sweep.js";
import type { CpuSampler, SystemSample } from "../sysmon.js";

// The config panel holds short fields, so keep it compact and give the rest of
// the width to the model list (long model names need the room).
const CONFIG_MIN_WIDTH = 28;
const CONFIG_MAX_WIDTH = 46;
const MODEL_MIN_WIDTH = 24;
const CACHE_CYCLE = ["q4_0", "q5_1", "q8_0", "f16"];
const REASONING_CYCLE = [0, 512, 1024, 1536, 3072, -1];

// Capability nudges for the model-list ordering only - NOT the displayed score.
// Small and bounded so they reorder near-ties: a vision/thinking model edges
// ahead of a comparable one, but never beats a materially higher benchmark score
// (a 70% vision model stays below a 99% one). MTP is excluded on purpose - it is
// a performance potential, not a capability, and shows no benefit on local
// hardware; draft models likewise do not help, so nothing boosts for them.
const VISION_RANK_BONUS = 0.03;
const THINKING_RANK_BONUS = 0.02;
// Mirrors host-api.ts's MAX_DISPLAY_NAME - the rename form posts to the same
// wire shape (see startRouter), so both paths must enforce the same limit.
const MAX_DISPLAY_NAME = 200;

type Tone = "info" | "good" | "warn" | "bad";
type Focus = "models" | "config";
type ViewMode = "standard" | "logs" | "help" | "bench";

/** The model a field's callbacks are rendered against. */
interface FieldContext {
  model: Model | null;
}

/** A pending destructive action awaiting y/n. */
interface ConfirmState {
  kind: "delete" | "reset-name";
  model: Model;
}

/** One downloadable quant in the picker, with whether it is already on disk. */
interface PickerQuant extends QuantOption {
  installed: boolean;
}

/** The quant-download picker: a modal list of a repo's available quants. */
interface PickerState {
  model: Model | null;
  repo: string;
  loading: boolean;
  options: PickerQuant[];
  mmproj: RepoQuants["mmproj"];
  index: number;
}

/** The Hugging Face search modal: type a query, then browse GGUF repos. */
interface SearchState {
  query: string;
  input: boolean;
  loading: boolean;
  results: ModelSearchResult[];
  index: number;
}

/** One editable configuration field. */
interface Field {
  key: keyof Profile;
  label: string;
  kind: "number" | "cycle" | "toggle";
  format: (profile: Profile, ctx: FieldContext) => string;
  step?: number;
  min?: number;
  max?: number | ((ctx: FieldContext) => number);
  values?: Array<number | string>;
  note?: (profile: Profile) => string | null;
  enabled?: (ctx: FieldContext) => boolean;
}

/** The number field currently being typed into. */
interface EditingState {
  field: Field;
  buffer: string;
}

/** The current status line and its tone. */
interface StatusState {
  text: string;
  tone: Tone;
}

/** Constructor options for the interactive app. */
interface AppOptions {
  runtime: Runtime;
  listenPort: number;
  listenHost: string;
}

// The benchmark suite has no TypeScript port yet, so it is loaded lazily and
// described by these local interfaces (see runBenchmarkOnSelected).
interface BenchProgressEvent {
  phase: string;
  title: string;
  score: number;
  summary: string;
}

interface BenchRunOptions {
  host: string;
  port: number;
  concurrency: number;
  reasoningBudget: number | null;
  contextWindow: number | null;
  archiveId: string;
  onProgress: (event: BenchProgressEvent) => void;
}

interface BenchModule {
  runSuite(options: BenchRunOptions): Promise<BenchReport>;
}

interface HealthSampler {
  stop(): SystemHealth;
}

interface HealthModule {
  start(): HealthSampler;
}

/** A concurrency task's measured throughput detail. */
interface ConcurrencyDetail {
  concurrency?: number;
  genPerSecond?: number;
  promptPerSecond?: number;
}

/** An agentic task's peak context-window utilization (see tasks.ts). */
interface ContextDetail {
  contextUtilization?: number | null;
  peakPromptTokens?: number;
  contextWindow?: number | null;
}

/** Editable configuration fields, in display order. */
export const FIELDS: Field[] = [
  {
    key: "contextSize",
    label: "Context",
    kind: "number",
    format: (p, ctx) => {
      const native = ctx.model?.metadata?.contextLength;
      return `${p.contextSize.toLocaleString()}${native ? style.grey + " / " + native.toLocaleString() + style.reset : ""}`;
    },
    step: 8192,
    min: 1024,
    max: (ctx) => ctx.model?.metadata?.contextLength || 1_000_000,
  },
  {
    key: "cacheTypeK",
    label: "KV cache K",
    kind: "cycle",
    values: CACHE_CYCLE,
    format: (p) => p.cacheTypeK,
  },
  {
    key: "cacheTypeV",
    label: "KV cache V",
    kind: "cycle",
    values: CACHE_CYCLE,
    format: (p) => p.cacheTypeV,
  },
  {
    key: "parallelSlots",
    label: "Parallel slots",
    kind: "number",
    step: 1,
    min: 1,
    max: () => 16,
    format: (p) => String(p.parallelSlots),
    note: (p) =>
      p.parallelSlots > 1 ? `${p.parallelSlots} concurrent requests, sharing one KV pool` : null,
  },
  {
    key: "cachedChats",
    label: "Cached KVs",
    kind: "number",
    step: 1,
    min: 0,
    max: () => 64,
    format: (p) =>
      (p.cachedChats ?? 0) > 0 ? String(p.cachedChats) : `default ${style.grey}(0)${style.reset}`,
    // No inline note: the RAM estimate is the warning's job, and the warning
    // lives in one place (profile-edit.ts). The panel reads it from there.
  },
  {
    key: "flashAttention",
    label: "Flash attention",
    kind: "toggle",
    format: (p) =>
      p.flashAttention
        ? `${style.brightGreen}on${style.reset}`
        : `${style.yellow}off${style.reset}`,
    note: (p) =>
      !p.flashAttention && p.cacheTypeV !== "f16"
        ? "quantised V cache requires flash attention"
        : null,
  },
  {
    key: "vision",
    label: "Vision",
    kind: "toggle",
    format: (p, ctx) => {
      if (!ctx.model?.mmprojPath) return `${style.grey}no projector${style.reset}`;
      return p.vision ? `${style.brightGreen}on${style.reset}` : "off";
    },
    enabled: (ctx) => Boolean(ctx.model?.mmprojPath),
  },
  {
    key: "reasoningBudget",
    label: "Reasoning budget",
    kind: "cycle",
    values: REASONING_CYCLE,
    format: (p) => {
      if (p.reasoningBudget === UNRESTRICTED_REASONING_BUDGET)
        return `${style.red}${formatReasoningBudget(p.reasoningBudget)}${style.reset}`;
      if (p.reasoningBudget === 0) return `${style.cyan}thinking off${style.reset}`;
      return `${p.reasoningBudget} tokens`;
    },
    note: (p) =>
      p.reasoningBudget === -1 ? "unrestricted budget can consume every token on thinking" : null,
  },
  {
    key: "preserveReasoning",
    label: "Preserve reasoning",
    kind: "toggle",
    format: (p) =>
      p.preserveReasoning
        ? `${style.brightGreen}on${style.reset}`
        : `${style.yellow}off${style.reset}`,
    enabled: (ctx) => Boolean(ctx.model?.reasoningPreservation?.templateArgument),
  },
  {
    key: "gpuLayers",
    label: "GPU layers",
    kind: "number",
    step: 1,
    min: 0,
    max: () => 999,
    format: (p) =>
      p.gpuLayers >= 999 ? `all ${style.grey}(999)${style.reset}` : String(p.gpuLayers),
  },
];

export class App {
  runtime: Runtime;
  listenPort: number;
  listenHost: string;

  screen: Screen;
  store: ProfilesStore;
  catalog: Model[];
  filter: string;
  selected: number;
  scrollTop: number;
  focus: Focus;
  fieldIndex: number;
  editing: EditingState | null;
  busy: boolean;
  status: StatusState;
  gpuInfo: GpuInfo | null;
  profile: Profile | null;
  sweepResult: SweepReport | null;
  cpuSampler: CpuSampler;
  sys: SystemSample | null;
  viewMode: ViewMode;
  benchRunning: boolean;
  benchProgress: string[];
  benchResults: RunRecord[];
  benchModelId: string | null;
  rankings: Map<string, RankedModel>;
  rankedModels: RankedModel[];
  telemetry: Telemetry;
  supervisor: Supervisor;
  routerServer: http.Server | null;

  /**
   * The VRAM fit behind the resident model, so a benchmark can record whether
   * the profile it measured was the profile the user configured. Keyed by model
   * id because a fit computed for one model says nothing about the next.
   */
  lastFit: { modelId: string; fit: vram.FitResult } | null = null;

  filterMode = false;
  renaming = false;
  renameBuffer = "";
  /** ids with a persisted rename-map override, so "reset name" can tell the
   * user there is nothing to reset instead of round-tripping for a no-op. */
  renamedIds = new Set<string>();
  confirming: ConfirmState | null = null;
  picker: PickerState | null = null;
  search: SearchState | null = null;
  disk: DiskUsage | null = null;
  detach?: () => void;
  ticker?: NodeJS.Timeout;
  done?: () => void;

  constructor({ runtime, listenPort, listenHost }: AppOptions) {
    this.runtime = runtime;
    this.listenPort = listenPort;
    this.listenHost = listenHost;

    this.screen = new Screen();
    this.store = loadProfilesStore();
    this.catalog = [];
    this.filter = "";
    this.selected = 0;
    this.scrollTop = 0;
    this.focus = "models";
    this.fieldIndex = 0;
    this.editing = null;
    this.busy = false;
    this.status = { text: "loading model catalog…", tone: "info" };
    this.gpuInfo = null;
    this.profile = null;
    this.sweepResult = null;
    this.cpuSampler = sysmon.createCpuSampler();
    this.sys = null;
    this.viewMode = "standard"; // standard | logs | help | bench
    this.benchRunning = false; // a suite is executing right now
    this.benchProgress = []; // live per-task lines during a run
    this.benchResults = []; // cached leaderboard (results.latestPerConfig, ranked)
    this.benchModelId = null; // model id of the most recent / active run
    this.rankings = new Map(); // model id/name -> averaged benchmark rank + score
    this.rankedModels = []; // ranked list (mean of runs), best first | help
    this.telemetry = new Telemetry();
    this.supervisor = new Supervisor({ runtime, getProfilesStore: () => this.store });
    this.routerServer = null;

    this.supervisor.on("state", () => this.draw());
    this.supervisor.on("log", () => {
      if (this.viewMode === "logs") this.draw();
    });
    this.supervisor.on("ready", (payload: { loadSeconds: number; deltaBytes: number }) => {
      this.setStatus(
        `loaded in ${payload.loadSeconds.toFixed(1)}s, using ${vram.formatGiB(payload.deltaBytes)} VRAM`,
        "good",
      );
    });
    this.supervisor.on("crashed", (why: string) => this.setStatus(`server crashed: ${why}`, "bad"));
  }

  // ---------------------------------------------------------------- lifecycle

  async run(): Promise<void> {
    this.screen.enter();
    this.detach = onKeys((key) => this.onKey(key));
    process.stdout.on("resize", () => {
      this.screen.invalidate();
      this.draw();
    });

    this.gpuInfo = await gpu.query();
    this.reload();
    await this.startRouter();
    this.draw();

    this.ticker = setInterval(async () => {
      // One combined reading; only poll /slots while a server is actually up.
      this.sys = await sysmon.sample(
        this.cpuSampler,
        this.supervisor.state === "ready"
          ? { host: this.supervisor.host, port: this.supervisor.internalPort }
          : {},
      );
      if (this.sys.gpu) this.gpuInfo = this.sys.gpu;
      this.draw();
    }, 2000);

    await new Promise<void>((resolve) => {
      this.done = () => resolve();
    });
  }

  async shutdown(): Promise<void> {
    clearInterval(this.ticker);
    this.detach?.();
    this.screen.leave();
    await this.supervisor.stop();
    const server = this.routerServer;
    if (server)
      await new Promise<void>((r) => {
        server.close(() => r());
      });
    this.done?.();
  }

  /** Fit a model to the live VRAM budget and (re)start the server on it. */
  async loadModelFitted(target: Model): Promise<void> {
    const info = this.gpuInfo || (await gpu.query());
    let profile = profiles.forModel(this.store, target);
    this.lastFit = null;
    if (info) {
      const fit = vram.fitToBudget({
        model: target,
        profile,
        calibration: profiles.getCalibration(this.store, target, profile),
        totalVramBytes: info.totalBytes,
      });
      if (!fit.adjusted && !fit.budget.fits) throw new Error(fit.reason ?? undefined);
      // Held for the benchmark to record: once `fit.profile` is applied, the
      // context the user actually asked for is gone from every other source.
      this.lastFit = { modelId: target.id, fit };
      profile = fit.profile;
    }
    this.setStatus(`switching to ${target.displayName}…`, "info");
    await this.supervisor.start(target, profile);
  }

  async startRouter(): Promise<void> {
    const handler = createRouter({
      supervisor: this.supervisor,
      telemetry: this.telemetry,
      logger: { warn: (m: string) => this.setStatus(m, "warn") },
      getCatalog: () => this.catalog,
      loadModel: (m: Model) => this.loadModelFitted(m),
    });
    // The rename form posts to this local router (see submitRename) rather than
    // calling updateDisplayName in-process, so a future remote-brain TUI hits the
    // same code path this does. The full host-api surface is not wired in here -
    // only these two routes - since nothing else in the TUI needs it over HTTP.
    const server = http.createServer((req, res) => {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "POST" && path === "/__host/model/rename") {
        this.handleRenameRequest(req, res);
        return;
      }
      if (req.method === "POST" && path === "/__host/model/rename/reset") {
        this.handleResetRequest(req, res);
        return;
      }
      handler(req, res);
    });
    this.routerServer = server;
    server.keepAliveTimeout = 75_000;
    server.requestTimeout = 0;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.listenPort, this.listenHost, () => resolve());
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`could not bind ${this.listenHost}:${this.listenPort} - ${message}`, "bad");
      this.routerServer = null;
    });
  }

  /** POST /__host/model/rename?id=… - the one host-api route this embedded
   * router serves, so the TUI's rename form and a remote-brain client hit the
   * same wire shape. */
  handleRenameRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "", "http://brain.local");
    const id = url.searchParams.get("id");
    const model = id ? this.catalog.find((m) => m.id === id) : null;
    if (!model) {
      sendError(res, 404, id ? `model "${id}" was not found` : "an ?id= is required");
      return;
    }
    readJsonBody(req, 4096, (result) => {
      if (!result.ok) {
        sendError(res, 400, result.error);
        return;
      }
      const body = result.body as { displayName?: unknown };
      const displayName = body.displayName;
      if (typeof displayName !== "string" || displayName.trim().length === 0) {
        sendError(res, 400, "displayName must be a non-empty string");
        return;
      }
      if (displayName.length > MAX_DISPLAY_NAME) {
        sendError(res, 400, `displayName must be at most ${MAX_DISPLAY_NAME} characters`);
        return;
      }
      if (/[^\x20-\x7E]/.test(displayName)) {
        sendError(res, 400, "displayName must not contain control characters or non-ASCII");
        return;
      }
      // Same collision guard as host-api.ts's handleRename - both /v1/models
      // and defaultModel/switchTo resolve a model by displayName, so a
      // duplicate silently strands one of the two models unreachable by name.
      const conflict = this.catalog.find(
        (m) => m.id !== model.id && (m.displayName === displayName || m.id === displayName),
      );
      if (conflict) {
        sendError(res, 409, `another model is already named "${displayName}"`);
        return;
      }
      updateDisplayName(model.id, displayName);
      sendJson(res, { displayName });
    });
  }

  /** POST /__host/model/rename/reset?id=… - clears this model's rename-map
   * override and returns the scan-derived default name it reverted to. */
  handleResetRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "", "http://brain.local");
    const id = url.searchParams.get("id");
    const model = id ? this.catalog.find((m) => m.id === id) : null;
    if (!model) {
      sendError(res, 404, id ? `model "${id}" was not found` : "an ?id= is required");
      return;
    }
    readJsonBody(req, 4096, (result) => {
      if (!result.ok) {
        sendError(res, 400, result.error);
        return;
      }
      deleteDisplayName(model.id);
      const rescanned = scanModels(loadBrainConfig()).find((m) => m.id === model.id);
      sendJson(res, { displayName: rescanned ? rescanned.displayName : model.displayName });
    });
  }

  // -------------------------------------------------------------------- state

  reload(): void {
    const config = loadBrainConfig();
    this.catalog = scanModels(config);
    this.renamedIds = new Set(Object.keys(loadRenameMap()));
    this.loadRankings();
    this.selected = Math.min(this.selected, Math.max(0, this.visible.length - 1));
    this.syncProfile();
    void this.refreshDisk();
    this.setStatus(`${this.catalog.length} models found`, "info");
  }

  /** Mean-of-runs rank + score per model, for ordering and badging the list. */
  loadRankings(): void {
    let ranked: RankedModel[] = [];
    try {
      ranked = results.rankModels();
    } catch {
      /* no results yet */
    }
    const map = new Map<string, RankedModel>();
    for (const m of ranked) {
      if (m.id) map.set(m.id, m);
      map.set(m.displayName, m);
    }
    this.rankings = map;
    this.rankedModels = ranked;
  }

  rankOf(model: Model | null): RankedModel | null {
    if (!model) return null;
    return (
      (model.id && this.rankings.get(model.id)) || this.rankings.get(model.displayName) || null
    );
  }

  /** Small, bounded ordering nudge for more-capable models (vision, thinking). */
  capabilityBonus(model: Model): number {
    return (
      (model.mmprojPath ? VISION_RANK_BONUS : 0) +
      (model.metadata?.reasoning || model.thinking ? THINKING_RANK_BONUS : 0)
    );
  }

  get visible(): Model[] {
    let list = this.catalog;
    if (this.filter) {
      const needle = this.filter.toLowerCase();
      list = list.filter((m) => m.displayName.toLowerCase().includes(needle));
    }
    // Order: best known benchmark first (nudged up slightly for vision/thinking),
    // then any not-yet-benchmarked models by capability and name.
    return [...list].sort((a, b) => {
      const ra = this.rankOf(a);
      const rb = this.rankOf(b);
      if (ra && rb) {
        return rb.overall + this.capabilityBonus(b) - (ra.overall + this.capabilityBonus(a));
      }
      if (ra) return -1;
      if (rb) return 1;
      const bonus = this.capabilityBonus(b) - this.capabilityBonus(a);
      return bonus !== 0 ? bonus : a.displayName.localeCompare(b.displayName);
    });
  }

  get model(): Model | null {
    return this.visible[this.selected] || null;
  }

  syncProfile(): void {
    this.profile = this.model ? profiles.forModel(this.store, this.model) : null;
    this.sweepResult = null;
  }

  get calibration(): Calibration | null {
    const model = this.model;
    const profile = this.profile;
    if (!model || !profile) return null;
    return profiles.getCalibration(this.store, model, profile);
  }

  get budget(): Budget | null {
    const model = this.model;
    const profile = this.profile;
    const info = this.gpuInfo;
    if (!model || !profile || !info) return null;
    return vram.budget({
      model,
      profile,
      calibration: this.calibration,
      totalVramBytes: info.totalBytes,
    });
  }

  persist(): void {
    const model = this.model;
    const profile = this.profile;
    if (model && profile) {
      profiles.put(this.store, model, profile);
      this.store.lastModelId = model.id;
      saveProfilesStore(this.store);
    }
  }

  setStatus(text: string, tone: Tone = "info"): void {
    this.status = { text, tone };
    this.draw();
  }

  // -------------------------------------------------------------------- input

  onKey(key: string): void {
    if (this.renaming) return this.onRenameKey(key);
    if (this.editing) return this.onEditKey(key);
    if (this.filterMode) return this.onFilterKey(key);
    if (this.confirming) return this.onConfirmKey(key);
    if (this.picker) return this.onPickerKey(key);
    if (this.search) return this.onSearchKey(key);

    // Esc always returns to the standard view from logs / help / bench.
    if (key === "escape" && this.viewMode !== "standard") {
      this.viewMode = "standard";
      this.draw();
      return;
    }

    // Benchmark mode is a full second workspace with its own keys.
    if (this.viewMode === "bench") return this.onBenchKey(key);

    switch (key) {
      case "ctrl-c":
      case "q":
        this.shutdown();
        return;
      case "tab":
      case "shifttab":
        this.focus = this.focus === "models" ? "config" : "models";
        break;
      case "up":
        this.move(-1);
        break;
      case "down":
        this.move(1);
        break;
      case "pageup":
        this.move(-8);
        break;
      case "pagedown":
        this.move(8);
        break;
      case "left":
        this.adjust(-1);
        break;
      case "right":
        this.adjust(1);
        break;
      case "-":
      case "_":
        this.adjust(-1);
        break;
      case "+":
      case "=":
        this.adjust(1);
        break;
      case "enter":
      case "space":
        if (this.focus === "config") this.activateField();
        else this.focus = "config";
        break;
      case "/":
        this.filterMode = true;
        break;
      case "s":
        this.startModel();
        break;
      case "x":
        this.stopModel();
        break;
      case "c":
        this.runCalibration();
        break;
      case "w":
        this.runSweep();
        break;
      case "m":
        this.applyMaxContext();
        break;
      case "g":
        void this.beginDownload();
        break;
      case "f":
        this.beginSearch();
        break;
      case "D":
        this.beginDelete();
        break;
      case "R":
        if (this.focus === "models") this.beginRename();
        break;
      case "u":
        if (this.focus === "models") this.beginResetName();
        break;
      case "r":
        this.reload();
        break;
      case "b":
        this.enterBench();
        break;
      case "l":
        this.viewMode = this.viewMode === "logs" ? "standard" : "logs";
        break;
      case "?":
        this.viewMode = this.viewMode === "help" ? "standard" : "help";
        break;
      default:
        return;
    }
    this.draw();
  }

  onFilterKey(key: string): void {
    if (key === "enter" || key === "escape") {
      this.filterMode = false;
      if (key === "escape") this.filter = "";
    } else if (key === "backspace") {
      this.filter = this.filter.slice(0, -1);
    } else if (key === "space") {
      // decodeKey names the space bar 'space'; a model name can contain one.
      this.filter += " ";
    } else if (key.length === 1 && key >= " ") {
      this.filter += key;
    }
    this.selected = 0;
    this.scrollTop = 0;
    this.syncProfile();
    this.draw();
  }

  onEditKey(key: string): void {
    const active = this.editing;
    if (!active) return;
    const { field } = active;
    if (key === "escape") {
      this.editing = null;
    } else if (key === "enter") {
      const value = Number.parseInt(active.buffer, 10);
      if (Number.isFinite(value)) {
        const rawMax = field.max;
        const max =
          typeof rawMax === "function"
            ? rawMax({ model: this.model })
            : (rawMax ?? Number.MAX_SAFE_INTEGER);
        this.writeField(field.key, Math.max(field.min ?? 0, Math.min(max, value)));
        this.persist();
      }
      this.editing = null;
    } else if (key === "backspace") {
      active.buffer = active.buffer.slice(0, -1);
    } else if (/^[0-9-]$/.test(key)) {
      active.buffer += key;
    }
    this.draw();
  }

  beginRename(): void {
    const model = this.model;
    if (!model) return;
    this.renaming = true;
    this.renameBuffer = "";
    this.setStatus(`rename "${model.displayName}" → `, "info");
  }

  onRenameKey(key: string): void {
    if (key === "escape") {
      this.renaming = false;
      this.renameBuffer = "";
      this.setStatus("rename cancelled", "info");
      return;
    }
    if (key === "enter") {
      void this.submitRename();
      return;
    }
    if (key === "backspace") {
      this.renameBuffer = this.renameBuffer.slice(0, -1);
    } else if (key === "space") {
      if (this.renameBuffer.length < 80) this.renameBuffer += " ";
    } else if (key.length === 1 && key >= " " && this.renameBuffer.length < 80) {
      this.renameBuffer += key;
    }
    this.draw();
  }

  /** POST the new display name to this TUI's own local router (see
   * handleRenameRequest / startRouter), then rescan so the renamed catalog
   * entry - and its persisted override - are reflected immediately. */
  async submitRename(): Promise<void> {
    const model = this.model;
    if (!model) {
      this.renaming = false;
      this.draw();
      return;
    }
    const newName = this.renameBuffer.trim();
    if (!newName) {
      this.renaming = false;
      this.renameBuffer = "";
      this.setStatus("rename cancelled - name cannot be empty", "warn");
      return;
    }
    await this.guard("rename", async () => {
      const url = `http://127.0.0.1:${this.listenPort}/__host/model/rename?id=${encodeURIComponent(model.id)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: newName }),
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error?.message) message = body.error.message;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message);
      }
      this.renaming = false;
      this.renameBuffer = "";
      this.reload();
      this.setStatus(`renamed to ${newName}`, "good");
    });
  }

  beginResetName(): void {
    const model = this.model;
    if (!model) return;
    if (!this.renamedIds.has(model.id)) {
      this.setStatus(`"${model.displayName}" has no custom name to reset`, "info");
      return;
    }
    this.confirming = { kind: "reset-name", model };
    this.setStatus(`reset "${model.displayName}" to its default name?   y / n`, "warn");
    this.draw();
  }

  /** POST to this TUI's own local router (see handleResetRequest), then
   * rescan so the reverted name is reflected immediately. */
  async submitResetName(model: Model): Promise<void> {
    await this.guard("reset name", async () => {
      const url = `http://127.0.0.1:${this.listenPort}/__host/model/rename/reset?id=${encodeURIComponent(model.id)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error?.message) message = body.error.message;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message);
      }
      const body = (await res.json()) as { displayName?: string };
      this.reload();
      this.setStatus(`reset to ${body.displayName ?? "its default name"}`, "good");
    });
  }

  move(delta: number): void {
    if (this.focus === "models") {
      const list = this.visible;
      if (!list.length) return;
      this.selected = Math.max(0, Math.min(list.length - 1, this.selected + delta));
      this.syncProfile();
    } else {
      const usable = this.usableFields();
      if (!usable.length) return;
      const current = usable.indexOf(this.fieldIndex);
      const next = Math.max(0, Math.min(usable.length - 1, (current < 0 ? 0 : current) + delta));
      this.fieldIndex = usable[next];
    }
  }

  usableFields(): number[] {
    return FIELDS.map((f, i) => ({ f, i }))
      .filter(({ f }) => !f.enabled || f.enabled({ model: this.model }))
      .map(({ i }) => i);
  }

  /** Read a profile field by key, without narrowing to a single value type. */
  readField(key: keyof Profile): unknown {
    return this.profile ? (this.profile as unknown as Record<string, unknown>)[key] : undefined;
  }

  /** Write a profile field by key; a no-op when no model is selected. */
  writeField(key: keyof Profile, value: number | string | boolean): void {
    if (!this.profile) return;
    (this.profile as unknown as Record<string, unknown>)[key] = value;
  }

  adjust(direction: number): void {
    if (this.focus !== "config" || !this.profile) return;
    const field = FIELDS[this.fieldIndex];
    if (!field) return;

    if (field.kind === "toggle") {
      this.writeField(field.key, !this.readField(field.key));
    } else if (field.kind === "cycle") {
      const values = field.values ?? [];
      const at = values.indexOf(this.readField(field.key) as number | string);
      const next = (at < 0 ? 0 : at + direction + values.length) % values.length;
      this.writeField(field.key, values[next]);
    } else {
      const rawMax = field.max;
      const max =
        typeof rawMax === "function"
          ? rawMax({ model: this.model })
          : (rawMax ?? Number.MAX_SAFE_INTEGER);
      const value = (this.readField(field.key) as number) + direction * (field.step ?? 0);
      this.writeField(field.key, Math.max(field.min ?? 0, Math.min(max, value)));
    }
    this.persist();

    // Changing the KV cache types invalidates any prior calibration (bytes/token
    // is keyed by them). Nudge a recalibrate, but only if there is a stored
    // measurement to invalidate - no point prompting a model never calibrated.
    if (
      (field.key === "cacheTypeK" || field.key === "cacheTypeV") &&
      this.model &&
      this.profile &&
      profiles.hasStaleCalibration(this.store, this.model, this.profile)
    ) {
      this.setStatus("cache types changed - press c to recalibrate for an accurate budget", "warn");
    }
  }

  activateField(): void {
    const field = FIELDS[this.fieldIndex];
    if (!field || !this.profile) return;
    if (field.kind === "number") {
      this.editing = { field, buffer: "" };
    } else {
      this.adjust(1);
    }
  }

  applyMaxContext(): void {
    const model = this.model;
    const profile = this.profile;
    const info = this.gpuInfo;
    if (!model || !profile || !info) return;
    const max = vram.maxContextThatFits({
      model,
      profile,
      calibration: this.calibration,
      totalVramBytes: info.totalBytes,
    });
    if (!max) {
      this.setStatus("cannot determine a fitting context - run calibration (c)", "warn");
      return;
    }
    profile.contextSize = max;
    this.persist();
    const how = this.calibration ? "measured" : "theoretical (calibrate for accuracy)";
    this.setStatus(`context set to ${max.toLocaleString()} from ${how} budget`, "good");
  }

  // ------------------------------------------------------------------ actions

  // -------------------------------------------------------- model management

  /** The Hugging Face repo for a model: catalog match, else the id's first two
   * path segments (`<publisher>/<repo>/<file>`). */
  repoOf(model: Model): string | null {
    if (model.catalogHfRepo) return model.catalogHfRepo;
    const segments = model.id.split("/");
    return segments.length >= 3 ? segments.slice(0, 2).join("/") : null;
  }

  async refreshDisk(): Promise<void> {
    const usage = await diskUsage(managedModelsDir(loadBrainConfig()));
    if (usage) {
      this.disk = usage;
      this.draw();
    }
  }

  beginDelete(): void {
    const model = this.model;
    if (!model) return;
    if (this.supervisor.model?.id === model.id && this.supervisor.state === "ready") {
      this.setStatus("stop the model before deleting it (x)", "warn");
      return;
    }
    const plan = planDelete(model);
    this.confirming = { kind: "delete", model };
    this.setStatus(
      `delete ${model.displayName} - frees ${vram.formatGiB(plan.bytes)}` +
        `${plan.includesProjector ? " (incl. projector)" : ""}?   y / n`,
      "warn",
    );
    this.draw();
  }

  onConfirmKey(key: string): void {
    const confirming = this.confirming;
    if (!confirming) return;
    if (key === "y") {
      this.confirming = null;
      if (confirming.kind === "delete") {
        void this.guard("delete", async () => {
          const plan = deleteModelFiles(confirming.model);
          this.reload();
          void this.refreshDisk();
          this.setStatus(
            `deleted ${confirming.model.displayName} - freed ${vram.formatGiB(plan.bytes)}`,
            "good",
          );
        });
      } else {
        void this.submitResetName(confirming.model);
      }
    } else if (key === "n" || key === "escape") {
      this.confirming = null;
      this.setStatus(confirming.kind === "delete" ? "delete cancelled" : "reset cancelled", "info");
      this.draw();
    }
  }

  async beginDownload(): Promise<void> {
    const model = this.model;
    if (!model) return;
    const repo = this.repoOf(model);
    if (!repo) {
      this.setStatus("cannot determine the Hugging Face repo for this model", "warn");
      return;
    }
    await this.openPicker(repo, model);
  }

  /** Open the quant picker for a repo (an installed model, or one from search). */
  async openPicker(repo: string, model: Model | null): Promise<void> {
    this.search = null;
    this.picker = { model, repo, loading: true, options: [], mmproj: null, index: 0 };
    this.draw();
    await this.guard("list quants", async () => {
      const token = resolveHfToken(loadBrainConfig());
      const { quants, mmproj } = await listRepoQuants(repo, token);
      const installed = new Set(
        this.catalog
          .filter((m) => this.repoOf(m) === repo && m.quant)
          .map((m) => (m.quant as string).toUpperCase()),
      );
      this.picker = {
        model,
        repo,
        loading: false,
        options: quants.map((q) => ({ ...q, installed: installed.has(q.quant.toUpperCase()) })),
        mmproj,
        index: 0,
      };
      this.draw();
    }).catch(() => {
      this.picker = null;
      this.draw();
    });
  }

  // ----------------------------------------------------------- HF model search

  /** A direct owner/repo the query names, so a known repo can be opened without
   * a round trip. Null unless the query looks like a repo path. */
  directRepo(query: string): string | null {
    const q = query.trim();
    return /^[\w.-]+\/[\w.-]+$/.test(q) ? q : null;
  }

  beginSearch(): void {
    this.search = { query: "", input: true, loading: false, results: [], index: 0 };
    this.draw();
  }

  onSearchKey(key: string): void {
    const search = this.search;
    if (!search) return;

    if (search.input) {
      if (key === "escape") {
        this.search = null;
      } else if (key === "enter") {
        void this.runSearch();
      } else if (key === "backspace") {
        search.query = search.query.slice(0, -1);
      } else if (key === "space") {
        search.query += " ";
      } else if (key.length === 1 && key >= " ") {
        search.query += key;
      }
      this.draw();
      return;
    }

    // Browsing results. Index 0 is the "open this repo directly" row when the
    // query looks like owner/repo.
    const direct = this.directRepo(search.query);
    const total = (direct ? 1 : 0) + search.results.length;
    if (key === "escape") {
      search.input = true;
    } else if (key === "up") {
      search.index = Math.max(0, search.index - 1);
    } else if (key === "down") {
      search.index = Math.min(Math.max(0, total - 1), search.index + 1);
    } else if (key === "enter" && total > 0) {
      const repo =
        direct && search.index === 0
          ? direct
          : search.results[search.index - (direct ? 1 : 0)]?.repo;
      if (repo) void this.openPicker(repo, null);
      return;
    }
    this.draw();
  }

  async runSearch(): Promise<void> {
    const search = this.search;
    if (!search || !search.query.trim()) return;
    search.loading = true;
    search.input = false;
    this.draw();
    await this.guard("search", async () => {
      const token = resolveHfToken(loadBrainConfig());
      const results = await searchModels(search.query.trim(), { limit: 30, token });
      if (this.search) {
        this.search.results = results;
        this.search.loading = false;
        this.search.index = 0;
        this.draw();
      }
    }).catch(() => {
      if (this.search) {
        this.search.loading = false;
        this.draw();
      }
    });
  }

  drawSearch(cols: number): void {
    const search = this.search;
    if (!search) return;
    const inner = Math.min(cols - 4, 78);
    const rows: string[] = [];

    if (search.input) {
      rows.push(
        `${style.grey}query${style.reset} ${search.query}${style.brightCyan}▏${style.reset}`,
      );
      rows.push("");
      rows.push(
        `${style.grey}Type a model name, or an exact owner/repo to open it directly.${style.reset}`,
      );
    } else if (search.loading) {
      rows.push(`${style.grey}searching Hugging Face…${style.reset}`);
    } else {
      const direct = this.directRepo(search.query);
      let i = 0;
      const line = (selected: boolean, text: string): string =>
        selected
          ? `${style.inverse}${pad(text.replace(/\x1b\[[0-9;]*m/g, ""), inner)}${style.reset}`
          : text;
      if (direct) {
        rows.push(line(search.index === 0, `▶ open ${direct} directly`));
        i = 1;
      }
      if (!search.results.length && !direct) {
        rows.push(`${style.yellow}no GGUF models matched${style.reset}`);
      }
      // Repos we already have on disk, so a search hit can be flagged.
      const installedRepos = new Set(
        this.catalog
          .map((x) => this.repoOf(x)?.toLowerCase())
          .filter((v): v is string => Boolean(v)),
      );
      for (let r = 0; r < search.results.length; r += 1) {
        const m = search.results[r];
        const dl = m.downloads >= 1000 ? `${Math.round(m.downloads / 1000)}k` : String(m.downloads);
        const have = installedRepos.has(m.repo.toLowerCase())
          ? ` ${style.brightGreen}have${style.reset}`
          : "";
        const text =
          `${pad(truncate(m.repo, inner - 24), inner - 24)} ` +
          `${style.grey}${dl.padStart(6)} dl  ${String(m.likes).padStart(4)}♥${m.gated ? " gated" : ""}${style.reset}${have}`;
        rows.push(line(search.index === i, text));
        i += 1;
      }
    }

    const footer = search.input
      ? `${style.grey}enter search · esc cancel${style.reset}`
      : `${style.grey}↑↓ select · enter view quants · esc edit query${style.reset}`;
    const lines = [this.header(cols), ""];
    lines.push(
      ...box({
        title: "Search Hugging Face for models",
        lines: rows,
        innerWidth: inner,
        footer,
        accent: style.brightCyan,
      }),
    );
    this.renderFitted(lines);
  }

  onPickerKey(key: string): void {
    const picker = this.picker;
    if (!picker) return;
    if (key === "escape" || key === "q") {
      this.picker = null;
      this.draw();
      return;
    }
    if (picker.loading || !picker.options.length) return;
    if (key === "up") {
      picker.index = Math.max(0, picker.index - 1);
    } else if (key === "down") {
      picker.index = Math.min(picker.options.length - 1, picker.index + 1);
    } else if (key === "enter") {
      const choice = picker.options[picker.index];
      this.picker = null;
      void this.guard("download", () => this.downloadQuant(picker.repo, choice, picker.mmproj));
      return;
    }
    this.draw();
  }

  async downloadQuant(
    repo: string,
    choice: PickerQuant,
    mmproj: RepoQuants["mmproj"],
  ): Promise<void> {
    if (choice.installed) {
      this.setStatus(`${choice.quant} is already installed`, "info");
      return;
    }
    const token = resolveHfToken(loadBrainConfig());
    const files = [...choice.files, ...(mmproj ? mmproj.files : [])];
    const total = choice.sizeBytes + (mmproj?.sizeBytes ?? 0);
    let lastPct = -1;
    this.setStatus(`downloading ${choice.quant} (${vram.formatGiB(total)})…`, "info");
    await downloadRepoFiles({
      repo,
      files,
      destRoot: managedModelsDir(loadBrainConfig()),
      token,
      onProgress: (p) => {
        const pct = total ? Math.floor((p.receivedBytes / total) * 100) : 0;
        if (pct !== lastPct) {
          lastPct = pct;
          this.setStatus(`downloading ${choice.quant}  ${pct}%`, "info");
        }
      },
    });
    this.reload();
    void this.refreshDisk();
    this.setStatus(`downloaded ${choice.quant}`, "good");
  }

  drawPicker(cols: number): void {
    const picker = this.picker;
    if (!picker) return;
    const inner = Math.min(cols - 4, 72);
    const rows: string[] = [];
    if (picker.loading) {
      rows.push(`${style.grey}fetching available quantizations…${style.reset}`);
    } else if (!picker.options.length) {
      rows.push(`${style.yellow}no GGUF quantizations found in this repo${style.reset}`);
    } else {
      // Reserve the same 1.5G VRAM the budget does, as a rough "will it fit" hint.
      const vramBudget = this.gpuInfo ? this.gpuInfo.totalBytes - 1.5 * vram.GIB : null;
      for (let i = 0; i < picker.options.length; i += 1) {
        const q = picker.options[i];
        const marker = i === picker.index ? "▶" : " ";
        const state = q.installed
          ? `${style.brightGreen}installed${style.reset}`
          : vramBudget !== null && q.sizeBytes > vramBudget
            ? `${style.yellow}heavy for VRAM${style.reset}`
            : `${style.grey}available${style.reset}`;
        const plain = `${marker} ${pad(q.quant, 12)} ${vram.formatGiB(q.sizeBytes).padStart(8)}`;
        rows.push(
          i === picker.index
            ? `${style.inverse}${pad(plain, inner)}${style.reset}`
            : `${plain}  ${state}`,
        );
      }
    }
    const lines = [this.header(cols), ""];
    lines.push(
      ...box({
        title: `Download quant - ${truncate(picker.repo, Math.max(8, inner - 18))}`,
        lines: rows,
        innerWidth: inner,
        footer: picker.loading
          ? `${style.grey}esc cancel${style.reset}`
          : `${style.grey}↑↓ select · enter download · esc cancel${style.reset}`,
        accent: style.brightCyan,
      }),
    );
    this.renderFitted(lines);
  }

  async guard(label: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.setStatus("another operation is already running", "warn");
      return;
    }
    this.busy = true;
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`${label} failed: ${message}`, "bad");
    } finally {
      this.busy = false;
      this.draw();
    }
  }

  startModel(): Promise<void> | void {
    const model = this.model;
    if (!model) return;
    const profile = this.profile;
    if (!profile) return;
    const budget = this.budget;
    if (budget && !budget.fits) {
      this.setStatus(
        `refusing to load: needs ${vram.formatGiB(budget.totalBytes)} but only ${vram.formatGiB(budget.usableBytes)} usable - press m to fit`,
        "bad",
      );
      return;
    }
    if (!profile.flashAttention && profile.cacheTypeV !== "f16") {
      this.setStatus("quantised V cache needs flash attention on", "bad");
      return;
    }
    return this.guard("start", async () => {
      this.setStatus(`loading ${model.displayName}…`, "info");
      await this.supervisor.start(model, profile);
    });
  }

  stopModel(): Promise<void> {
    return this.guard("stop", async () => {
      await this.supervisor.stop();
      this.setStatus("server stopped", "info");
    });
  }

  runCalibration(): Promise<void> | void {
    const model = this.model;
    const profile = this.profile;
    if (!model || !profile) return;
    return this.guard("calibration", async () => {
      await this.supervisor.stop();
      this.supervisor.recordLog(`operation calibrate: ${model.displayName}`);
      const measurement = await calibrate({
        runtime: this.runtime,
        model,
        profile,
        supervisor: this.supervisor,
        onProgress: (p) => {
          this.supervisor.recordLog(
            `operation calibrate: ${p.phase} ${p.contextSize.toLocaleString()}${p.reason ? `: ${p.reason}` : ""}${p.error ? `: ${p.error}` : ""}`,
          );
          if (p.phase === "loading")
            this.setStatus(
              `calibrating: loading at ${p.contextSize.toLocaleString()} ctx…`,
              "info",
            );
          if (p.phase === "measured")
            this.setStatus(
              `calibrating: ${p.contextSize.toLocaleString()} ctx used ${vram.formatGiB(p.deltaBytes ?? 0)}`,
              "info",
            );
        },
      });
      profiles.putCalibration(this.store, model, profile, measurement);
      saveProfilesStore(this.store);
      const ratio = measurement.theoreticalRatio;
      const measuredMsg =
        `measured ${(measurement.kvBytesPerToken / 1024).toFixed(1)} KB/token` +
        (ratio ? ` (formula overestimated ${ratio.toFixed(1)}x)` : "");

      // Auto-apply the fresh budget. A measured KV cost is almost always far
      // below the theoretical estimate, so the context that was safe before is
      // now needlessly low and leaves VRAM idle - raise it to the measured max.
      const info = this.gpuInfo;
      const before = profile.contextSize;
      let appliedTo: number | null = null;
      if (info) {
        const max = vram.maxContextThatFits({
          model,
          profile,
          calibration: this.calibration,
          totalVramBytes: info.totalBytes,
        });
        if (max && max !== before) {
          profile.contextSize = max;
          this.persist();
          appliedTo = max;
        }
      }

      this.setStatus(
        appliedTo !== null
          ? `${measuredMsg} - context ${before.toLocaleString()} -> ${appliedTo.toLocaleString()}`
          : measuredMsg,
        "good",
      );
      this.supervisor.recordLog(`operation calibrate: saved measurement for ${model.displayName}`);
    });
  }

  runSweep(): Promise<void> | void {
    const model = this.model;
    const profile = this.profile;
    if (!model || !profile) return;
    return this.guard("sweep", async () => {
      await this.supervisor.stop();
      this.supervisor.recordLog(`operation sweep: ${model.displayName}`);
      const result = await sweep({
        runtime: this.runtime,
        model,
        profile,
        supervisor: this.supervisor,
        onProgress: (p) => {
          this.supervisor.recordLog(
            `operation sweep: budget ${p.budget} ${p.phase}${p.error ? `: ${p.error}` : ""}`,
          );
          if (p.phase === "loading")
            this.setStatus(`sweep: loading with budget ${p.budget}…`, "info");
          if (p.phase === "generating")
            this.setStatus(`sweep: generating with budget ${p.budget}…`, "info");
          if (p.phase === "done") {
            this.setStatus(
              `sweep: budget ${p.budget} -> ${((p.contentChars ?? 0) / 1024).toFixed(1)}KB content, ${p.filesDelivered}/4 files, ${(p.elapsedSeconds ?? 0).toFixed(0)}s`,
              "info",
            );
          }
        },
      });
      this.sweepResult = result;
      if (result.recommended !== null) {
        profile.reasoningBudget = result.recommended;
        this.persist();
        this.setStatus(`sweep complete - reasoning budget set to ${result.recommended}`, "good");
        this.supervisor.recordLog(`operation sweep: saved budget ${result.recommended}`);
      } else {
        this.setStatus("sweep produced no usable result", "warn");
      }
    });
  }

  // --------------------------------------------------------------- benchmarks

  enterBench(): void {
    this.viewMode = "bench";
    this.focus = "models";
    this.loadBenchResults();
    this.loadRankings();
  }

  loadBenchResults(): void {
    try {
      this.benchResults = results.latestPerConfig();
    } catch {
      this.benchResults = [];
    }
  }

  onBenchKey(key: string): void {
    switch (key) {
      case "ctrl-c":
      case "q":
        this.shutdown();
        return;
      case "b":
        this.viewMode = "standard";
        break;
      case "up":
        this.move(-1);
        break;
      case "down":
        this.move(1);
        break;
      case "pageup":
        this.move(-8);
        break;
      case "pagedown":
        this.move(8);
        break;
      case "r":
      case "enter":
        this.runBenchmarkOnSelected();
        break;
      case "x":
        this.stopModel();
        break;
      default:
        return;
    }
    this.draw();
  }

  /** Load the selected model if needed, run the suite, and store the result. */
  runBenchmarkOnSelected(): Promise<void> | void {
    const model = this.model;
    if (!model || this.benchRunning) return;
    return this.guard("benchmark", async () => {
      this.benchRunning = true;
      this.benchModelId = model.id;
      this.benchProgress = [`preparing ${model.displayName}…`];
      this.draw();
      try {
        if (this.supervisor.model?.id !== model.id || this.supervisor.state !== "ready") {
          this.benchProgress.push("loading model…");
          this.draw();
          await this.loadModelFitted(model);
        }
        // The benchmark suite has no TypeScript port yet, so it is loaded lazily
        // and described by the local Bench/Health interfaces declared above.
        const benchModule = await import("../bench/index.js");
        const healthModule = await import("../bench/health.js");
        const bench = benchModule as unknown as BenchModule;
        const health = healthModule as unknown as HealthModule;
        const profile = this.supervisor.profile;
        const archiveId = archive.runId(model);

        const healthSampler = health.start();
        // stop() is idempotent (clearInterval); guarantee the 1s nvidia-smi
        // sampler never outlives the run even if runSuite throws - otherwise a
        // failed bench leaks a recurring subprocess.
        let sampled = false;
        try {
          const report = await bench.runSuite({
            host: this.supervisor.host,
            port: this.supervisor.internalPort,
            concurrency: Math.max(1, profile?.parallelSlots || 3),
            reasoningBudget: profile?.reasoningBudget ?? null,
            contextWindow: profile?.contextSize ?? null,
            archiveId,
            onProgress: (p) => {
              if (p.phase === "start") this.benchProgress.push(`${p.title}…`);
              else if (p.phase === "done") {
                this.benchProgress[this.benchProgress.length - 1] =
                  `${p.title}: ${(p.score * 100).toFixed(0)}%  ${p.summary}`;
              } else if (p.phase === "failed")
                this.benchProgress.push(`${p.title}: failed - ${p.summary}`);
              this.draw();
            },
          });
          report.system = healthSampler.stop();
          sampled = true;
          report.vramBytes = this.supervisor.vramAtReadyBytes;
          report.loadSeconds = this.supervisor.loadSeconds;
          results.save({
            model,
            profile,
            report,
            gpu: this.gpuInfo,
            runtime: `${this.runtime.label} v${this.runtime.version}`,
            system: report.system,
            archiveId,
            args: this.supervisor.args,
            // Only when it belongs to the model actually being benchmarked - the
            // model may have been resident since before this fit was computed.
            fit: this.lastFit?.modelId === model.id ? this.lastFit.fit : null,
            calibration: profile ? profiles.getCalibration(this.store, model, profile) : null,
            suite: {
              // The TUI runs the full static suite; only concurrency varies, and
              // it tracks the profile's slot count the same way runSuite is called.
              execute: true,
              concurrency: Math.max(1, profile?.parallelSlots || 3),
              depths: null,
              only: null,
              mined: false,
            },
          });
          this.loadBenchResults();
          this.loadRankings();
          this.benchProgress.push(
            `done - overall ${(report.overall * 100).toFixed(0)}% (${report.grade})`,
          );
          this.setStatus(
            `benchmark complete: ${model.displayName} ${(report.overall * 100).toFixed(0)}% (${report.grade})`,
            "good",
          );
        } finally {
          if (!sampled) healthSampler.stop();
        }
      } finally {
        this.benchRunning = false;
      }
    });
  }

  scoreColour(score: number): string {
    if (score >= 0.75) return style.brightGreen;
    if (score >= 0.55) return style.brightYellow;
    if (score >= 0.35) return style.yellow;
    return style.red;
  }

  // ------------------------------------------------------------------ drawing

  /**
   * Render, but never let the footer scroll off. The renderer only paints
   * rows-1 lines; if the layout is taller than the terminal, drop rows from
   * just above the footer so the keybindings hint is always on screen.
   */
  renderFitted(lines: string[]): void {
    const cap = Math.max(1, this.screen.rows - 1);
    const fitted =
      lines.length > cap ? [...lines.slice(0, cap - 1), lines[lines.length - 1]] : lines;
    this.screen.render(fitted);
  }

  draw(): void {
    if (!this.screen.entered) return;
    const cols = this.screen.columns;

    if (this.viewMode === "logs") {
      this.drawLogs(cols);
      return;
    }
    if (this.viewMode === "help") {
      this.drawHelp(cols);
      return;
    }
    if (this.viewMode === "bench") {
      this.drawBench(cols);
      return;
    }
    if (this.picker) {
      this.drawPicker(cols);
      return;
    }
    if (this.search) {
      this.drawSearch(cols);
      return;
    }

    // Give the model list the width; keep config compact. Hold the combined
    // panel row to cols-2 so nothing spills into the terminal's last column
    // (writing there scrolls the view, which read as "config goes off screen").
    const rightWidth = Math.max(
      CONFIG_MIN_WIDTH,
      Math.min(CONFIG_MAX_WIDTH, Math.round(cols * 0.38)),
    );
    const leftWidth = Math.max(MODEL_MIN_WIDTH, cols - rightWidth - 7);

    // Render the fixed-height chrome first and measure it, then hand the panels
    // exactly the rows that are left. The status panel grows once CPU/GPU and
    // telemetry lines appear, so a static guess pushes the footer off-screen.
    const header = this.header(cols);
    const budget = this.budgetPanel(cols - 2);
    const status = this.statusPanel(cols - 2);
    const footer = this.keybindings(cols - 1);

    // Lines around the panels: header + blank + [panels] + blank + budget +
    // blank + status + blank + footer. The panel box adds 3 rows of its own
    // chrome (title, its footer, bottom border) on top of listRows.
    const overhead = 1 + 1 + 3 + 1 + budget.length + 1 + status.length + 1 + footer.length;
    const listRows = Math.max(1, this.screen.rows - 1 - overhead);

    const lines = [header, ""];
    const left = this.modelPanel(leftWidth, listRows);
    const right = this.configPanel(rightWidth, listRows);
    const height = Math.max(left.length, right.length);
    for (let i = 0; i < height; i += 1) {
      const l = left[i] ?? " ".repeat(leftWidth + 2);
      const r = right[i] ?? "";
      lines.push(`${l} ${r}`);
    }

    lines.push("");
    lines.push(...budget);
    lines.push("");
    lines.push(...status);
    if (this.renaming) {
      lines.push("");
      lines.push(this.renameLine(cols - 1));
    }
    lines.push("");
    lines.push(...footer);

    this.renderFitted(lines);
  }

  /** The rename input line shown above the footer while renaming is active:
   * the current name in grey, the buffer typed so far, and a cursor. */
  renameLine(cols: number): string {
    const model = this.model;
    const name = model ? model.displayName : "";
    return truncate(
      `${style.brightYellow}rename${style.reset}  ${style.grey}${name}${style.reset} → ` +
        `${this.renameBuffer}${style.brightCyan}▏${style.reset}`,
      cols,
    );
  }

  /**
   * Benchmark workspace: the model list on the left, the selected model's
   * scorecard where Configuration sits in serve mode, and the ranked leaderboard
   * (or live run progress) where the Status panel sits.
   */
  drawBench(cols: number): void {
    // Keep this identical to draw()'s split so the Benchmark sidebar lands at the
    // same width as the Configuration panel and the model list does not jump when
    // toggling between the two screens.
    const rightWidth = Math.max(
      CONFIG_MIN_WIDTH,
      Math.min(CONFIG_MAX_WIDTH, Math.round(cols * 0.38)),
    );
    const leftWidth = Math.max(MODEL_MIN_WIDTH, cols - rightWidth - 7);

    const header = this.header(cols);
    const bottom = this.benchBottom(cols - 2);
    const footer = this.keybindings(cols - 1);
    const overhead = 1 + 1 + 3 + 1 + bottom.length + 1 + footer.length;
    const listRows = Math.max(1, this.screen.rows - 1 - overhead);

    const lines = [header, ""];
    const left = this.modelPanel(leftWidth, listRows);
    const right = this.benchSidebar(rightWidth, listRows);
    const height = Math.max(left.length, right.length);
    for (let i = 0; i < height; i += 1) {
      const l = left[i] ?? " ".repeat(leftWidth + 2);
      const r = right[i] ?? "";
      lines.push(`${l} ${r}`);
    }

    lines.push("");
    lines.push(...bottom);
    lines.push("");
    lines.push(...footer);
    this.renderFitted(lines);
  }

  /** The selected model's latest scorecard, or a prompt to run one. */
  benchSidebar(innerWidth: number, rows: number): string[] {
    const lines: string[] = [];
    const model = this.model;
    if (!model) {
      lines.push(`${style.grey}no model selected${style.reset}`);
    } else {
      lines.push(`${style.bold}${truncate(model.displayName, innerWidth)}${style.reset}`);
      lines.push(
        `${style.grey}${model.quant || "?"}  ${vram.formatGiB(model.sizeBytes)}${style.reset}`,
      );
      lines.push("");

      const rec = this.benchResults.find((r) => r.model.displayName === model.displayName) || null;
      const ranking = this.rankOf(model);

      if (this.benchRunning && this.benchModelId === model.id) {
        lines.push(`${style.brightYellow}benchmarking now…${style.reset}`);
      } else if (!ranking || !rec) {
        lines.push(`${style.yellow}not benchmarked yet${style.reset}`);
        lines.push(`${style.grey}press r to run the suite${style.reset}`);
      } else {
        lines.push(
          `${style.grey}rank${style.reset} ${style.bold}#${ranking.rank}${style.reset}${style.grey} of ${this.rankedModels.length}${style.reset}`,
        );
        lines.push(
          `${style.grey}overall${style.reset} ${this.scoreColour(ranking.overall)}${(ranking.overall * 100).toFixed(0)}%  ${ranking.grade}${style.reset}`,
        );
        lines.push(
          `${style.grey}mean of ${ranking.runs} run${ranking.runs === 1 ? "" : "s"}${ranking.runs > 1 ? ` · ±${(ranking.std * 100).toFixed(1)}pts` : ""}${style.reset}`,
        );
        lines.push("");
        for (const t of rec.tasks) {
          lines.push(
            `${pad(truncate(t.category, 16), 16)} ${this.scoreColour(t.score)}${(t.score * 100).toFixed(0).padStart(3)}%${style.reset}`,
          );
        }
        const conc = rec.tasks.find((t) => t.id === "concurrency");
        if (conc && conc.detail) {
          const detail = conc.detail as ConcurrencyDetail;
          lines.push("");
          lines.push(`${style.grey}throughput @${detail.concurrency}${style.reset}`);
          lines.push(
            `  ${style.grey}gen${style.reset} ${(detail.genPerSecond ?? 0).toFixed(0)} tok/s`,
          );
          lines.push(
            `  ${style.grey}prompt${style.reset} ${(detail.promptPerSecond ?? 0).toFixed(0)} tok/s`,
          );
        }

        // Peak context held by the long-horizon / agentic tasks. It rides in the
        // live run summary but is lost from the persisted scorecard otherwise, so
        // surface it here alongside throughput.
        const held = rec.tasks
          .map((t) => ({ task: t, detail: t.detail as ContextDetail | undefined }))
          .filter((x) => typeof x.detail?.contextUtilization === "number");
        if (held.length) {
          lines.push("");
          lines.push(`${style.grey}context held${style.reset}`);
          for (const { task, detail } of held) {
            const pct = Math.round((detail?.contextUtilization ?? 0) * 100);
            const peak = detail?.peakPromptTokens
              ? ` ${style.grey}${(detail.peakPromptTokens / 1000).toFixed(1)}k tok${style.reset}`
              : "";
            lines.push(
              `  ${style.grey}${pad(truncate(task.category, 14), 14)}${style.reset} ${this.scoreColour(1 - pct / 100)}${String(pct).padStart(3)}%${style.reset}${peak}`,
            );
          }
        }

        lines.push("");
        lines.push(`${style.grey}ran ${rec.ranAt.slice(0, 10)} · ${rec.grade}${style.reset}`);
      }
    }
    while (lines.length < rows) lines.push("");
    return box({
      title: "Benchmark",
      lines,
      innerWidth,
      footer: `${style.grey}r run · esc back${style.reset}`,
      accent: style.brightCyan,
    });
  }

  /** Live run progress, otherwise the ranked leaderboard. */
  benchBottom(innerWidth: number): string[] {
    if (this.benchRunning) {
      const lines = this.benchProgress
        .slice(-6)
        .map((line) => truncate(`  ${line}`, innerWidth - 4));
      while (lines.length < 6) lines.push("");
      return box({
        title: "Benchmark progress",
        lines,
        innerWidth: innerWidth - 2,
        accent: style.brightYellow,
      });
    }

    if (!this.rankedModels.length) {
      return box({
        title: "Leaderboard",
        lines: [
          `${style.grey}no benchmarks yet - select a model and press r to run one${style.reset}`,
        ],
        innerWidth: innerWidth - 2,
      });
    }

    const lines: string[] = [];
    lines.push(
      `${style.grey}${pad("#", 3)}${pad("model", 38)}${"mean".padStart(8)}${"runs".padStart(6)}${"grade".padStart(10)}${"gen tok/s".padStart(11)}${style.reset}`,
    );
    for (const entry of this.rankedModels.slice(0, 8)) {
      const latest = this.benchResults.find(
        (r) => (entry.id && r.model.id === entry.id) || r.model.displayName === entry.displayName,
      );
      const conc = latest && latest.tasks.find((t) => t.id === "concurrency");
      const tps = conc && conc.detail ? (conc.detail as ConcurrencyDetail).genPerSecond : null;
      const selected = this.model && entry.displayName === this.model.displayName;
      const row =
        `${pad(String(entry.rank), 3)}${pad(truncate(entry.displayName, 37), 38)}` +
        `${`${(entry.overall * 100).toFixed(0)}%`.padStart(8)}${String(entry.runs).padStart(6)}` +
        `${entry.grade.padStart(10)}${(tps != null ? tps.toFixed(0) : "-").padStart(11)}`;
      lines.push(selected ? `${style.inverse}${pad(row, innerWidth - 2)}${style.reset}` : row);
    }
    return box({
      title: `Leaderboard ${style.grey}(${this.rankedModels.length} ranked, mean of runs)${style.reset}`,
      lines,
      innerWidth: innerWidth - 2,
    });
  }

  drawLogs(cols: number): void {
    const logs = this.supervisor.logLines;
    const s = this.supervisor.status();
    const header = this.header(cols);
    const status = this.statusPanel(cols - 2);
    const footer = this.keybindings(cols - 1);
    const title = truncate(
      `${style.brightCyan}Brain log${style.reset}  ` +
        `${style.grey}${s.state}${logs.length ? ` · ${logs.length} lines` : ""} · esc or l to go back${style.reset}`,
      cols - 1,
    );

    // header + blank + title + blank + [body] + blank + status + blank + footer.
    const overhead = 1 + 1 + 1 + 1 + 1 + status.length + 1 + footer.length;
    const bodyRows = Math.max(1, this.screen.rows - 1 - overhead);

    const body: string[] = [];
    if (logs.length === 0) {
      body.push(
        `${style.grey}no logs yet - start a model or operation to see Brain output${style.reset}`,
      );
    } else {
      for (const line of logs.slice(Math.max(0, logs.length - bodyRows)))
        body.push(truncate(line, cols));
    }
    while (body.length < bodyRows) body.push("");

    const lines = [header, "", title, "", ...body, "", ...status, "", ...footer];
    this.renderFitted(lines);
  }

  header(cols: number): string {
    const title = `${style.bold}${style.brightCyan}Otto Brain${style.reset}${style.grey} v${resolveVersion()}${style.reset}`;
    const rt = `${style.grey}llama.cpp ${this.runtime.label} v${this.runtime.version}${style.reset}`;
    const g = this.gpuInfo
      ? `${style.grey}${this.gpuInfo.name} · ${vram.formatGiB(this.gpuInfo.usedBytes)}/${vram.formatGiB(this.gpuInfo.totalBytes)}${style.reset}`
      : `${style.yellow}no NVIDIA GPU detected${style.reset}`;
    const endpoint = this.routerServer
      ? `${style.grey}serving ${this.listenHost}:${this.listenPort}${style.reset}`
      : `${style.red}router not listening${style.reset}`;
    return truncate(`${title}  ${rt}  ${g}  ${endpoint}`, cols - 1);
  }

  modelPanel(innerWidth: number, rows: number): string[] {
    const list = this.visible;
    if (this.selected < this.scrollTop) this.scrollTop = this.selected;
    if (this.selected >= this.scrollTop + rows) this.scrollTop = this.selected - rows + 1;

    const lines: string[] = [];
    for (let i = this.scrollTop; i < Math.min(list.length, this.scrollTop + rows); i += 1) {
      const m = list[i];
      const isSelected = i === this.selected;
      const running = this.supervisor.model?.id === m.id && this.supervisor.state === "ready";

      const marker = running ? `${style.brightGreen}●${style.reset}` : " ";
      const quant = m.quant ? m.quant.padEnd(7) : "-".padEnd(7);
      const size = vram.formatGiB(m.sizeBytes).padStart(6);
      const isReasoning = Boolean(m.metadata?.reasoning || m.thinking);
      const tags = [
        m.mmprojPath ? `${style.cyan}V${style.reset}` : " ",
        m.features.mtp ? `${style.magenta}M${style.reset}` : " ",
        isReasoning ? `${style.green}R${style.reset}` : " ",
      ].join("");

      // Benchmark score badge: how this model ranks by our latest measurement.
      const rank = this.rankOf(m);
      const score = rank
        ? `${this.scoreColour(rank.overall)}${String(Math.round(rank.overall * 100)).padStart(3)}%${style.reset}`
        : `${style.grey}   –${style.reset}`;

      const nameWidth = innerWidth - 7 - 7 - 3 - 2 - 5;
      const name = truncate(m.displayName, nameWidth);
      const row = `${marker}${pad(name, nameWidth)} ${score} ${quant}${size} ${tags}`;
      lines.push(
        isSelected
          ? `${style.inverse}${pad(truncate(row.replace(/\x1b\[[0-9;]*m/g, ""), innerWidth), innerWidth)}${style.reset}`
          : row,
      );
    }
    while (lines.length < rows) lines.push("");

    const title = this.filterMode
      ? `Models  ${style.brightYellow}/${this.filter}${style.reset}`
      : `Models ${style.grey}(${list.length})${style.reset}`;
    const footer = `${style.grey}%=benchmark  V=vision  M=MTP  R=reasoning${style.reset}`;
    return box({
      title,
      lines,
      innerWidth,
      footer,
      accent: this.focus === "models" ? style.brightCyan : style.grey,
    });
  }

  configPanel(innerWidth: number, rows: number): string[] {
    // Build the full content first, remembering which line holds the focused
    // field, then window it to exactly `rows` so the box height always matches
    // the model list and never runs off the bottom of the screen.
    const content: string[] = [];
    let focusLine = 0;
    const model = this.model;
    const profile = this.profile;
    if (!model || !profile) {
      content.push(`${style.grey}no model selected${style.reset}`);
    } else {
      const md: ModelMetadata = model.metadata ?? {};
      content.push(
        `${style.grey}arch${style.reset} ${md.arch || "?"}   ` +
          `${style.grey}layers${style.reset} ${md.blockCount ?? "?"}   ` +
          `${style.grey}kv heads${style.reset} ${md.headCountKv ?? "?"}`,
      );
      if (model.features.mtp || model.features.distilled) {
        const flags = [
          model.features.mtp ? "multi-token prediction" : null,
          model.features.distilled ? "distilled" : null,
        ]
          .filter(Boolean)
          .join(", ");
        content.push(`${style.grey}${flags}${style.reset}`);
      }
      content.push("");

      const usable = this.usableFields();
      for (const index of usable) {
        const field = FIELDS[index];
        const focused = this.focus === "config" && index === this.fieldIndex;
        const active = this.editing;
        const value =
          active && active.field.key === field.key
            ? `${style.brightYellow}${active.buffer}_${style.reset}`
            : field.format(profile, { model });
        const arrow = focused ? `${style.brightCyan}›${style.reset}` : " ";
        if (focused) focusLine = content.length;
        content.push(`${arrow} ${pad(field.label, 17)} ${value}`);
        // The cachedChats estimate is a ProfileWarning, not a field note: it is
        // computed once in profile-edit.ts, colored by how much of the machine's
        // RAM it would take, and the app editor renders the very same object.
        const cachedWarning =
          field.key === "cachedChats"
            ? profileWarnings(profile, model, this.store).find((w) => w.field === "cachedChats")
            : undefined;
        const note = cachedWarning?.message ?? field.note?.(profile);
        if (note) {
          const tone =
            cachedWarning?.severity === "error"
              ? style.red
              : cachedWarning?.severity === "warn"
                ? style.yellow
                : field.key === "cachedChats"
                  ? style.grey
                  : style.yellow;
          content.push(`  ${tone}  ${note}${style.reset}`);
        }
      }

      const sweepResult = this.sweepResult;
      if (sweepResult) {
        content.push("");
        content.push(`${style.grey}sweep results${style.reset}`);
        for (const r of sweepResult.results) {
          if (r.error) {
            content.push(
              `  ${String(r.budget).padStart(5)}  ${style.red}${truncate(r.error, innerWidth - 10)}${style.reset}`,
            );
            continue;
          }
          const best = r.budget === sweepResult.recommended;
          const mark = best ? `${style.brightGreen}✓${style.reset}` : " ";
          content.push(
            `  ${String(r.budget).padStart(5)} ${mark} ${(r.contentChars / 1024).toFixed(1).padStart(5)}KB  ` +
              `${r.filesDelivered}/4 files  ${(r.elapsedSeconds ?? 0).toFixed(0).padStart(3)}s`,
          );
        }
      }
    }

    // Window to `rows`, keeping the focused field on screen when it overflows.
    let lines: string[];
    if (content.length <= rows) {
      lines = content;
      while (lines.length < rows) lines.push("");
    } else {
      const start = Math.max(0, Math.min(focusLine - Math.floor(rows / 2), content.length - rows));
      lines = content.slice(start, start + rows);
    }

    return box({
      title: `Configuration${this.calibration ? `  ${style.brightGreen}calibrated${style.reset}` : `  ${style.yellow}not calibrated${style.reset}`}`,
      lines,
      innerWidth,
      footer: `${style.grey}←→ change · enter edit${style.reset}`,
      accent: this.focus === "config" ? style.brightCyan : style.grey,
    });
  }

  budgetPanel(innerWidth: number): string[] {
    const b = this.budget;
    if (!b) {
      return box({
        title: "VRAM budget",
        lines: [`${style.grey}unavailable${style.reset}`],
        innerWidth: innerWidth - 2,
      });
    }

    const cells = Math.max(20, Math.min(60, innerWidth - 40));
    const bar = meter(b.utilization, cells);
    const verdict = b.fits
      ? `${style.brightGreen}fits entirely on GPU${style.reset}`
      : `${style.red}EXCEEDS VRAM by ${vram.formatGiB(-b.headroomBytes)}${style.reset}`;

    const breakdown =
      `weights ${vram.formatGiB(b.weightsBytes)}` +
      (b.mmprojBytes ? ` + projector ${vram.formatGiB(b.mmprojBytes)}` : "") +
      ` + kv ${vram.formatGiB(b.kvBytes)}` +
      ` + overhead ${vram.formatGiB(b.overheadBytes)}` +
      ` = ${style.bold}${vram.formatGiB(b.totalBytes)}${style.reset}`;

    const kvLabel = `kv ${(b.kvBytesPerToken / 1024).toFixed(1)} KB/token`;
    const cal = this.calibration;
    let sourceNote: string;
    if (b.source === "measured") {
      sourceNote = cal?.inherited
        ? `${style.yellow}${kvLabel} (measured on a relative - press c to calibrate this model)${style.reset}`
        : `${style.grey}${kvLabel} (measured)${style.reset}`;
    } else {
      const stale =
        this.model && this.profile
          ? profiles.hasStaleCalibration(this.store, this.model, this.profile)
          : false;
      const hint = stale
        ? "cache types changed - press c to recalibrate"
        : "press c to calibrate; usually unlocks more context";
      sourceNote = `${style.yellow}${kvLabel} (theoretical - ${hint})${style.reset}`;
    }

    return box({
      title: "VRAM budget",
      lines: [
        `${bar}  ${vram.formatGiB(b.totalBytes)} / ${vram.formatGiB(b.usableBytes)} usable   ${verdict}`,
        breakdown,
        sourceNote,
      ],
      innerWidth: innerWidth - 2,
    });
  }

  statusPanel(innerWidth: number): string[] {
    const s = this.supervisor.status();
    const tone = {
      info: style.grey,
      good: style.brightGreen,
      warn: style.brightYellow,
      bad: style.red,
    }[this.status.tone];
    const stateColour =
      {
        ready: style.brightGreen,
        starting: style.brightYellow,
        stopping: style.yellow,
        failed: style.red,
        stopped: style.grey,
      }[s.state] || style.grey;

    const lines = [
      `${style.grey}server${style.reset} ${stateColour}${s.state}${style.reset}` +
        (s.model ? `  ${truncate(s.model, 40)}` : "") +
        (s.pid ? `  ${style.grey}pid ${s.pid}${style.reset}` : ""),
      `${tone}${truncate(this.status.text, innerWidth - 4)}${style.reset}`,
    ];

    // Live resource line: CPU, system RAM, GPU utilisation and VRAM.
    const sys = this.sys;
    if (sys) {
      const bits: string[] = [];
      if (typeof sys.cpu === "number") {
        bits.push(
          `${style.grey}cpu${style.reset} ${(sys.cpu * 100).toFixed(0).padStart(3)}%` +
            `${style.grey}/${sys.cpuCount}c${style.reset}`,
        );
      }
      bits.push(
        `${style.grey}ram${style.reset} ${vram.formatGiB(sys.ramUsedBytes)}/${vram.formatGiB(sys.ramTotalBytes)}`,
      );
      const gpuSample = sys.gpu;
      if (gpuSample) {
        const hot = gpuSample.utilization >= 90 ? style.brightGreen : style.reset;
        bits.push(
          `${style.grey}gpu${style.reset} ${hot}${String(gpuSample.utilization).padStart(3)}%${style.reset}`,
        );
        bits.push(
          `${style.grey}vram${style.reset} ${vram.formatGiB(gpuSample.usedBytes)}/${vram.formatGiB(gpuSample.totalBytes)}`,
        );
        if (typeof gpuSample.temperature === "number" && gpuSample.temperature > 0) {
          bits.push(`${style.grey}${gpuSample.temperature}C${style.reset}`);
        }
      }
      lines.push(bits.join("  "));

      const slotInfo = sys.slots;
      if (slotInfo) {
        const busyColour = slotInfo.busy > 0 ? style.brightGreen : style.grey;
        lines.push(
          `${style.grey}slots${style.reset} ${busyColour}${slotInfo.busy} busy${style.reset}` +
            `${style.grey} / ${slotInfo.total} total${style.reset}` +
            `${slotInfo.busy >= slotInfo.total ? `  ${style.brightYellow}saturated - further requests queue${style.reset}` : ""}`,
        );
      }
    }

    // Disk: total space the models take, and free space where new downloads land.
    const modelBytes = totalModelBytes(this.catalog);
    const diskLine =
      `${style.grey}disk${style.reset} models ${vram.formatGiB(modelBytes)}` +
      (this.disk
        ? `  ${vram.formatGiB(this.disk.freeBytes)} free of ${vram.formatGiB(this.disk.totalBytes)}`
        : "");
    lines.push(diskLine);

    const t = this.telemetry.totals;
    if (t.requests) {
      lines.push(
        `${style.grey}requests${style.reset} ${t.requests}  ` +
          `${style.brightGreen}ok ${t.ok}${style.reset}  ` +
          `${t.reasoningOnly ? style.red : style.grey}reasoning-only ${t.reasoningOnly}${style.reset}  ` +
          `${t.truncated ? style.brightYellow : style.grey}truncated ${t.truncated}${style.reset}`,
      );
    }
    const warning = this.telemetry.warning;
    if (warning)
      lines.push(`${style.brightYellow}${truncate(warning, innerWidth - 4)}${style.reset}`);

    return box({ title: "Status", lines, innerWidth: innerWidth - 2 });
  }

  /** Full-screen reference so no option ever has to be guessed. */
  drawHelp(cols: number): void {
    const inner = Math.min(cols - 4, 76);
    const rows: string[] = [];
    const section = (t: string): void => {
      rows.push("", `${style.brightCyan}${t}${style.reset}`);
    };
    const item = (k: string, d: string): void => {
      rows.push(`  ${style.brightCyan}${pad(k, 12)}${style.reset}${style.grey}${d}${style.reset}`);
    };

    section("Navigate");
    item("↑ ↓", "move within the focused panel");
    item("PgUp PgDn", "jump by 8");
    item("Tab", "switch between the Models and Configuration panels");
    section("Change settings (Configuration panel)");
    item("← →", "change the selected field (toggle / cycle / ± step)");
    item("- +", "same as ← →");
    item("Enter", "edit a number field - type digits, Enter saves, Esc cancels");
    item("m", "set context to the largest size that fits in VRAM");
    section("Run the model");
    item("s", "start / load the selected model");
    item("x", "stop the running model");
    item("c", "calibrate - measure real VRAM per token");
    item("w", "sweep - find the best reasoning budget");
    section("Manage models");
    item("f", "find on Hugging Face - search and add a new model");
    item("g", "get a quant - pick Q4/Q5/Q6… to download for this repo");
    item("D", "delete the selected model (frees disk, asks to confirm)");
    item("R", "rename the selected model (Enter saves, Esc cancels)");
    item("u", "reset the selected model's name to its default (asks to confirm)");
    section("Views");
    item("b", "benchmark mode - rank models, run the coding suite");
    item("l", "view the live Brain log");
    item("/", "filter the model list (Enter apply, Esc clear)");
    item("r", "rescan the models folder");
    item("?", "this help");
    section("Anywhere");
    item("Esc", "leave logs / help / the current mode");
    item("q  Ctrl-C", "quit Otto Brain");

    const lines = [this.header(cols), ""];
    lines.push(
      ...box({
        title: "Help - every key and what it does",
        lines: rows,
        innerWidth: inner,
        footer: `${style.grey}esc or ? to go back${style.reset}`,
        accent: style.brightCyan,
      }),
    );
    this.renderFitted(lines);
  }

  /**
   * The key hints for the current mode, as an array of lines. Groups are
   * deliberately broken onto separate lines - navigation first, then the
   * actions - and each group wraps further only if the terminal is too narrow.
   */
  keybindings(cols: number): string[] {
    let groups: string[][][];
    if (this.renaming) {
      groups = [
        [
          ["type", "rename"],
          ["enter", "save"],
          ["esc", "cancel"],
        ],
      ];
    } else if (this.confirming) {
      const label = this.confirming.kind === "delete" ? "confirm delete" : "confirm reset";
      groups = [
        [
          ["y", label],
          ["n", "cancel"],
        ],
      ];
    } else if (this.filterMode) {
      groups = [
        [
          ["type", "to filter"],
          ["enter", "apply"],
          ["esc", "clear & exit"],
        ],
      ];
    } else if (this.editing) {
      groups = [
        [
          ["0-9", "type value"],
          ["enter", "save"],
          ["esc", "cancel"],
        ],
      ];
    } else if (this.viewMode === "logs") {
      groups = [
        [
          ["esc", "back"],
          ["l", "back"],
          ["q", "quit"],
        ],
      ];
    } else if (this.viewMode === "help") {
      groups = [
        [
          ["esc", "back"],
          ["?", "back"],
          ["q", "quit"],
        ],
      ];
    } else if (this.viewMode === "bench") {
      groups = [
        [
          ["↑↓", "model"],
          ["r", "run benchmark"],
          ["x", "stop"],
          ["b", "serve mode"],
          ["q", "quit"],
        ],
      ];
    } else {
      groups = [
        // Navigation - line one.
        [
          ["↑↓", "select"],
          ["tab", "panel"],
          ["←→", "change"],
          ["enter", "edit"],
        ],
        // Actions - line two onward.
        [
          ["s", "start"],
          ["x", "stop"],
          ["m", "max ctx"],
          ["c", "calibrate"],
          ["w", "sweep"],
          ["f", "find on HF"],
          ["g", "get quant"],
          ["D", "delete"],
          ["R", "rename"],
          ["u", "reset name"],
          ["b", "benchmarks"],
          ["l", "logs"],
          ["/", "filter"],
          ["r", "rescan"],
          ["?", "help"],
          ["q", "quit"],
        ],
      ];
    }

    const gap = "   ";
    const lines: string[] = [];
    for (const group of groups) {
      const cells = group.map(
        ([k, v]) => `${style.brightCyan}${k}${style.reset} ${style.grey}${v}${style.reset}`,
      );
      let line = "";
      for (const cell of cells) {
        const candidate = line ? `${line}${gap}${cell}` : cell;
        if (line && width(candidate) > cols) {
          lines.push(line);
          line = cell;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
    }
    return lines.length ? lines : [""];
  }
}

import { Screen, style, onKeys } from "./screen.js";
import type { TuiScreen } from "./screen.js";
import type {
  BrainTuiHost,
  BrainTuiSnapshot,
  BrainTuiAction,
  BrainTuiActionType,
  BrainTuiActions,
  TuiModel,
  TuiModelInfo as Model,
  TuiProfile as Profile,
} from "./host.js";
import { standardKey } from "./keys.js";
import { draw } from "./views.js";
import { ProfileDraft } from "./draft.js";
import { requestHost, TuiActionError } from "./host.js";
import type { ProfileFieldDescriptor } from "../config/profile-edit.js";
import type { RankedModel } from "../ops/results.js";
import type { QuantOption, RepoQuants, ModelSearchResult } from "../models/hf.js";
import * as vram from "../vram.js";

const VISION_RANK_BONUS = 0.03;
const THINKING_RANK_BONUS = 0.02;
type Tone = "info" | "good" | "warn" | "bad";
type ViewMode = "standard" | "logs" | "help" | "bench" | "catalog" | "runtimes" | "jobs";
interface PickerQuant extends QuantOption {
  installed: boolean;
}
interface PickerState {
  model: Model | null;
  repo: string;
  loading: boolean;
  options: PickerQuant[];
  mmproj: RepoQuants["mmproj"];
  index: number;
}
interface SearchState {
  query: string;
  input: boolean;
  loading: boolean;
  results: ModelSearchResult[];
  index: number;
}
interface Field extends ProfileFieldDescriptor {
  values: (string | number | boolean | null)[];
  format(profile: Profile): string;
}
type ConfirmState =
  | { kind: "action"; action: BrainTuiAction; label: string }
  | { kind: "discard"; modelId: string; label: string };
export interface AppOptions {
  host: BrainTuiHost;
  screen?: TuiScreen;
  keys?: (handler: (key: string) => void) => () => void;
  signal?: AbortSignal;
}

/** Original full-screen Brain presentation; the host is the sole effect owner. */
export class App {
  readonly host: BrainTuiHost;
  readonly screen: TuiScreen;
  snapshot: BrainTuiSnapshot;
  filter = "";
  selected = 0;
  scrollTop = 0;
  focus: "models" | "config" = "models";
  fieldIndex = 0;
  editing: { field: Field; buffer: string } | null = null;
  busy = false;
  status: { text: string; tone: Tone } = { text: "", tone: "info" };
  viewMode: ViewMode = "standard";
  filterMode = false;
  renaming = false;
  renameBuffer = "";
  renameModelId: string | null = null;
  confirming: ConfirmState | null = null;
  picker: PickerState | null = null;
  search: SearchState | null = null;
  auxiliaryIndex = 0;
  private readonly drafts = new Map<string, ProfileDraft>();
  private readonly lifetime = new AbortController();
  private readonly keys: NonNullable<AppOptions["keys"]>;
  private readonly signal: AbortSignal | undefined;
  private disposers: (() => void)[] = [];
  private done: (() => void) | null = null;
  private running = false;
  private selectionId: string | null = null;

  constructor({ host, screen = new Screen(), keys = onKeys, signal }: AppOptions) {
    this.host = host;
    this.screen = screen;
    this.keys = keys;
    this.signal = signal;
    this.snapshot = host.getSnapshot();
    this.syncProfile();
  }

  async run(): Promise<void> {
    if (this.running) throw new Error("The terminal UI is already running.");
    if (this.lifetime.signal.aborted || this.signal?.aborted) return;
    this.running = true;
    const finished = new Promise<void>((resolve) => {
      this.done = resolve;
    });
    const stop = (): void => {
      this.shutdown();
    };
    try {
      this.signal?.addEventListener("abort", stop, { once: true });
      this.disposers.push(() => this.signal?.removeEventListener("abort", stop));
      this.screen.enter();
      this.disposers.push(this.keys((key) => this.onKey(key)));
      this.disposers.push(
        this.screen.onResize(() => {
          this.screen.invalidate();
          this.draw();
        }),
      );
      this.disposers.push(this.host.subscribe(() => this.receive()));
      this.disposers.push(this.host.retainStatus());
      this.receive();
      await finished;
    } finally {
      this.shutdown();
    }
  }

  shutdown(): void {
    this.lifetime.abort();
    // Every release must run, even if a terminal/transport disposer fails.
    try {
      for (const dispose of this.disposers.splice(0).toReversed()) {
        try {
          dispose();
        } catch {
          this.status = { text: "The terminal session could not close cleanly.", tone: "bad" };
        }
      }
    } finally {
      try {
        this.screen.leave();
      } finally {
        this.running = false;
        this.done?.();
        this.done = null;
      }
    }
  }

  receive(): void {
    const selectedId = this.selectionId;
    const auxiliaryId = this.auxiliaryIds()[this.auxiliaryIndex];
    const next = this.host.getSnapshot();
    if (next.instanceId !== this.snapshot.instanceId) {
      this.drafts.clear();
      this.editing = null;
      this.renaming = false;
      this.confirming = null;
      this.picker = null;
      this.search = null;
      this.setStatus("Brain host restarted; profile drafts were discarded", "warn");
    }
    this.snapshot = next;
    const auxiliaryIndex = this.auxiliaryIds().findIndex((id) => id === auxiliaryId);
    if (auxiliaryIndex >= 0) this.auxiliaryIndex = auxiliaryIndex;
    const found = this.visible.findIndex((model) => model.id === selectedId);
    this.selected =
      found >= 0 ? found : Math.min(this.selected, Math.max(0, this.visible.length - 1));
    if (this.model?.id !== selectedId) {
      this.editing = null;
      this.renaming = false;
    }
    for (const row of next.models) this.drafts.get(row.model.id)?.receive(row);
    this.syncProfile();
    this.draw();
  }

  get catalog(): Model[] {
    return this.snapshot.models.map((row) => row.model);
  }
  get row(): TuiModel | null {
    return this.snapshot.models.find((row) => row.model.id === this.model?.id) ?? null;
  }
  get draft(): ProfileDraft | null {
    return this.model ? (this.drafts.get(this.model.id) ?? null) : null;
  }
  get profile(): Profile | null {
    return this.draft?.profile ?? null;
  }
  get calibration() {
    return this.row?.calibration ?? null;
  }
  get budget() {
    return this.draft?.dirty ? null : (this.row?.budget ?? null);
  }
  get gpuInfo() {
    return this.snapshot.gpu;
  }
  get sys() {
    return this.snapshot.system;
  }
  get disk() {
    return this.snapshot.storage;
  }
  get sweepResult() {
    return this.row?.sweep ?? null;
  }
  get rankings(): Map<string, RankedModel> {
    const map = new Map<string, RankedModel>();
    for (const row of this.snapshot.rankings) {
      if (row.id) map.set(row.id, row);
      map.set(row.displayName, row);
    }
    return map;
  }
  get rankedModels() {
    return this.snapshot.rankings;
  }
  get benchResults() {
    return this.snapshot.benchmarks;
  }
  get benchJob() {
    return this.snapshot.jobs.find(
      (job) => job.operation === "bench" && (job.state === "queued" || job.state === "running"),
    );
  }
  get benchRunning() {
    return Boolean(this.benchJob);
  }
  get benchModelId() {
    return this.benchJob?.modelId ?? null;
  }
  get benchProgress() {
    return this.benchJob?.progress ?? [];
  }
  get fields(): Field[] {
    return (this.row?.fields ?? []).map((field) =>
      Object.assign({}, field, {
        values: field.optionValues ?? field.options ?? [],
        format: (profile: Profile): string => {
          const value = profile[field.key];
          const at = (field.optionValues ?? field.options ?? []).findIndex(
            (option) => option === value,
          );
          if (field.optionLabels && at >= 0) return field.optionLabels[at];
          if (field.key === "reasoningBudget" && value === -1)
            return `${style.red}unrestricted${style.reset}`;
          if (value === null || value === undefined) return "default";
          if (typeof value === "boolean") return value ? "on" : "off";
          if (typeof value === "number") return value.toLocaleString();
          return String(value);
        },
      }),
    );
  }

  syncProfile(): void {
    const row = this.row;
    this.selectionId = row?.model.id ?? null;
    if (row && !this.drafts.has(row.model.id)) this.drafts.set(row.model.id, new ProfileDraft(row));
    const usable = this.usableFields();
    if (!usable.includes(this.fieldIndex)) this.fieldIndex = usable[0] ?? 0;
  }
  reload(): void {
    void this.dispatch({ type: "refresh" });
  }

  async send<K extends BrainTuiActionType>(
    action: BrainTuiAction<K>,
  ): Promise<BrainTuiActions[K]["result"]> {
    if (this.snapshot.connection !== "connected")
      throw new TuiActionError("failed", "Brain host is disconnected.");
    if (!this.snapshot.availableActions.includes(action.type))
      throw new TuiActionError("unsupported", `${action.type} is unavailable on this host.`);
    return requestHost(this.host, action, this.lifetime.signal);
  }
  async dispatch(action: BrainTuiAction): Promise<void> {
    await this.guard(action.type, async () => {
      await this.send(action);
      this.receive();
      this.setStatus(`${action.type} accepted`, "good");
    });
  }
  persist(): void {
    void this.saveDraft();
  }
  private async saveDraft(): Promise<void> {
    const draft = this.draft;
    const model = this.model;
    if (!draft || !model) return;
    try {
      await draft.save(this.host, model.id, this.lifetime.signal);
      if (this.lifetime.signal.aborted) return;
      this.receive();
      this.setStatus("profile saved", "good");
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      const message = error instanceof TuiActionError ? error.message : "Save failed.";
      this.setStatus(`profile not saved: ${message} Press r to reload the host profile.`, "bad");
    }
  }
  reloadOrDiscard(): void {
    if (this.row && this.draft?.error && !this.draft.saving) {
      this.confirming = {
        kind: "discard",
        modelId: this.row.model.id,
        label: "discard profile draft and reload the host profile?",
      };
      this.setStatus(`${this.confirming.label} y / n`, "warn");
    } else this.reload();
  }
  readField(key: string): unknown {
    return this.draft?.read(key);
  }
  writeField(key: string, value: unknown): void {
    this.draft?.write(key, value);
  }
  usableFields(): number[] {
    return this.fields.flatMap((field, index) => (field.available ? [index] : []));
  }
  adjust(direction: number): void {
    if (
      this.focus !== "config" ||
      !this.profile ||
      !this.snapshot.availableActions.includes("profile.save")
    )
      return;
    const field = this.fields[this.fieldIndex];
    if (!field?.available) return;
    const current = this.readField(field.key);
    if (field.kind === "toggle") this.writeField(field.key, !current);
    else if (field.kind === "cycle" && field.values.length) {
      const at = field.values.findIndex((value) => value === current);
      const next = at < 0 ? 0 : (at + direction + field.values.length) % field.values.length;
      this.writeField(field.key, field.values[next]);
    } else if (field.kind === "number" && typeof current === "number") {
      const stepped = current + direction * (field.step ?? 1);
      const rounded = Number(stepped.toFixed(field.precision ?? 0));
      this.writeField(
        field.key,
        Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, rounded)),
      );
    }
    this.persist();
  }
  activateField(): void {
    const field = this.fields[this.fieldIndex];
    if (
      !field?.available ||
      !this.profile ||
      !this.snapshot.availableActions.includes("profile.save")
    )
      return;
    if (field.kind === "number") this.editing = { field, buffer: "" };
    else this.adjust(1);
  }
  onEditKey(key: string): void {
    const active = this.editing;
    if (!active) return;
    if (key === "escape") this.editing = null;
    else if (key === "enter") {
      if (/^-?\d+(?:\.\d+)?$/.test(active.buffer)) {
        const value = Number(active.buffer);
        if (Number.isFinite(value)) {
          this.writeField(
            active.field.key,
            Math.max(active.field.min ?? -Infinity, Math.min(active.field.max ?? Infinity, value)),
          );
          this.persist();
        }
      }
      this.editing = null;
    } else if (key === "backspace") active.buffer = active.buffer.slice(0, -1);
    else if (/^[0-9.-]$/.test(key)) active.buffer += key;
    this.draw();
  }
  applyMaxContext(): void {
    const model = this.model;
    const draft = this.draft;
    if (!model || !draft || draft.saving || draft.error) return;
    const profile = draft.profile;
    void this.guard("profile.fit", async () => {
      const preview = await this.send({
        type: "profile.fit",
        modelId: model.id,
        expectedRevision: draft.revision,
        patch: draft.overrides(),
      });
      if (draft !== this.draft || draft.profile !== profile || this.lifetime.signal.aborted) return;
      if (preview.contextSize === null) {
        this.setStatus("A GPU budget is unavailable for this profile.", "warn");
        return;
      }
      draft.write("contextSize", preview.contextSize);
      await draft.save(this.host, model.id, this.lifetime.signal);
      this.receive();
      this.setStatus("Context fitted and saved", "good");
    });
  }
  async modelAction(
    type: "model.load" | "model.unload" | "job.start",
    operation?: "calibrate" | "sweep" | "bench",
  ): Promise<void> {
    const model = this.model;
    const draft = this.draft;
    if (!model) return;
    await this.guard(type, async () => {
      if (draft?.dirty) await draft.save(this.host, model.id, this.lifetime.signal);
      if (type === "job.start" && operation)
        await this.send({ type, modelId: model.id, operation });
      else if (type !== "job.start") await this.send({ type, modelId: model.id });
      this.receive();
      this.setStatus(`${operation ?? type} accepted for ${model.displayName}`, "good");
    });
  }
  startModel(): void {
    void this.modelAction("model.load");
  }
  stopModel(): void {
    void this.modelAction("model.unload");
  }
  runCalibration(): void {
    void this.modelAction("job.start", "calibrate");
  }
  runSweep(): void {
    void this.modelAction("job.start", "sweep");
  }
  runBenchmarkOnSelected(): void {
    void this.modelAction("job.start", "bench");
  }
  enterBench(): void {
    this.viewMode = "bench";
    this.focus = "models";
  }

  beginRename(): void {
    if (!this.model) return;
    this.renaming = true;
    this.renameModelId = this.model.id;
    this.renameBuffer = "";
    this.setStatus(`rename "${this.model.displayName}"`, "info");
  }
  async submitRename(): Promise<void> {
    const modelId = this.renameModelId;
    const displayName = this.renameBuffer.trim();
    if (!modelId || !displayName) {
      this.setStatus("name cannot be empty", "warn");
      return;
    }
    await this.guard("rename", async () => {
      await this.send({ type: "model.rename", modelId, displayName });
      this.renaming = false;
      this.renameBuffer = "";
      this.receive();
      this.setStatus(`renamed to ${displayName}`, "good");
    });
  }
  beginResetName(): void {
    if (!this.model || !this.row?.renamed) return;
    this.confirming = {
      kind: "action",
      action: { type: "model.resetName", modelId: this.model.id },
      label: `reset "${this.model.displayName}" to its default name?`,
    };
    this.setStatus(`${this.confirming.label} y / n`, "warn");
  }
  beginDelete(): void {
    const row = this.row;
    if (!row) return;
    if (row.deleteBlocked) {
      this.setStatus(row.deleteBlocked, "warn");
      return;
    }
    this.confirming = {
      kind: "action",
      action: { type: "model.delete", modelId: row.model.id },
      label: `delete ${row.model.displayName} - frees ${row.deleteBytes === null ? "an unknown size" : vram.formatGiB(row.deleteBytes)}?`,
    };
    this.setStatus(`${this.confirming.label} y / n`, "warn");
  }
  onConfirmKey(key: string): void {
    const pending = this.confirming;
    if (!pending) return;
    if (key === "y") {
      this.confirming = null;
      if (pending.kind === "action") void this.dispatch(pending.action);
      else {
        const row = this.snapshot.models.find((entry) => entry.model.id === pending.modelId);
        const draft = this.drafts.get(pending.modelId);
        if (row && draft && !draft.saving) {
          draft.discard(row);
          this.setStatus("host profile reloaded");
        }
      }
    } else if (key === "n" || key === "escape") {
      this.confirming = null;
      this.setStatus("cancelled");
    }
  }
  async openPicker(repo: string, model: Model | null): Promise<void> {
    if (this.busy) {
      this.setStatus("another request is pending", "warn");
      return;
    }
    this.search = null;
    const picker: PickerState = { model, repo, loading: true, options: [], mmproj: null, index: 0 };
    this.picker = picker;
    this.draw();
    await this.guard("list quants", async () => {
      try {
        const result = await this.send({ type: "hf.quants", repo });
        if (this.picker !== picker) return;
        const installed = new Set(
          this.catalog
            .filter((item) => this.repoOf(item) === repo)
            .map((item) => item.quant?.toUpperCase()),
        );
        picker.options = result.quants.map((quant) => ({
          ...quant,
          installed: installed.has(quant.quant.toUpperCase()),
        }));
        picker.mmproj = result.mmproj;
      } finally {
        picker.loading = false;
      }
    });
  }
  async runSearch(): Promise<void> {
    const search = this.search;
    if (!search?.query.trim() || search.loading || this.busy) return;
    search.loading = true;
    search.input = false;
    this.draw();
    await this.guard("search", async () => {
      try {
        const result = await this.send({ type: "hf.search", query: search.query.trim() });
        if (this.search !== search) return;
        search.results = result;
        search.index = 0;
      } finally {
        search.loading = false;
      }
    });
  }
  async downloadQuant(
    repo: string,
    choice: PickerQuant,
    _mmproj: RepoQuants["mmproj"],
  ): Promise<void> {
    if (choice.installed) {
      this.setStatus(`${choice.quant} is already installed`);
      return;
    }
    const result = await this.send({ type: "hf.add", repo, quant: choice.quant });
    this.setStatus(`download queued: ${result.jobId}`, "good");
  }
  rankOf(model: Model | null): RankedModel | null {
    if (!model) return null;
    return (
      (model.id && this.rankings.get(model.id)) || this.rankings.get(model.displayName) || null
    );
  }

  capabilityBonus(model: Model): number {
    return (
      (model.hasProjector ? VISION_RANK_BONUS : 0) +
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

  setStatus(text: string, tone: Tone = "info"): void {
    this.status = { text, tone };
    this.draw();
  }

  onKey(key: string): void {
    if (key === "ctrl-c") {
      this.shutdown();
      return;
    }
    if (this.renaming) return this.onRenameKey(key);
    if (this.editing) return this.onEditKey(key);
    if (this.filterMode) return this.onFilterKey(key);
    if (this.confirming) return this.onConfirmKey(key);
    if (this.picker) return this.onPickerKey(key);
    if (this.search) return this.onSearchKey(key);

    const extraViews: Record<string, ViewMode> = { t: "runtimes", C: "catalog", J: "jobs" };
    const extraView = extraViews[key];
    if (extraView) {
      this.viewMode = extraView;
      this.auxiliaryIndex = 0;
      this.draw();
      return;
    }

    // Esc always returns to the standard view from logs / help / bench.
    if (key === "escape" && this.viewMode !== "standard") {
      this.viewMode = "standard";
      this.draw();
      return;
    }

    if (["catalog", "runtimes", "jobs"].includes(this.viewMode)) {
      this.onAuxiliaryKey(key);
      return;
    }

    // Benchmark mode is a full second workspace with its own keys.
    if (this.viewMode === "bench") return this.onBenchKey(key);

    standardKey(this, key);
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

  repoOf(model: Model): string | null {
    return model.repo;
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

  async guard(label: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.setStatus("another operation is already running", "warn");
      return;
    }
    this.busy = true;
    try {
      await fn();
    } catch (error) {
      if (!this.lifetime.signal.aborted) {
        const message =
          error instanceof TuiActionError
            ? error.message
            : "The Brain host request could not complete.";
        this.setStatus(`${label}: ${message}`, "bad");
      }
    } finally {
      this.busy = false;
      this.draw();
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

  scoreColour(score: number): string {
    if (score >= 0.75) return style.brightGreen;
    if (score >= 0.55) return style.brightYellow;
    if (score >= 0.35) return style.yellow;
    return style.red;
  }

  renderFitted(lines: string[]): void {
    const cap = Math.max(1, this.screen.rows - 1);
    const fitted =
      lines.length > cap ? [...lines.slice(0, cap - 1), lines[lines.length - 1]] : lines;
    this.screen.render(fitted);
  }

  draw(): void {
    draw(this);
  }

  hostStatus() {
    const resident = this.snapshot.residents.find((item) => item.modelId === this.model?.id);
    return {
      state: resident?.phase ?? this.snapshot.state,
      model: resident?.displayName ?? null,
      pid: resident?.pid ?? null,
    };
  }
  can(action: BrainTuiActionType): boolean {
    return (
      this.snapshot.connection === "connected" && this.snapshot.availableActions.includes(action)
    );
  }
  actionForKey(key: string): BrainTuiActionType | null {
    if (key === "r") return this.viewMode === "bench" ? "job.start" : "refresh";
    const keys: Record<string, BrainTuiActionType> = {
      s: "model.load",
      x: "model.unload",
      m: "profile.fit",
      c: "job.start",
      w: "job.start",
      f: "hf.search",
      g: "hf.quants",
      D: "model.delete",
      R: "model.rename",
      u: "model.resetName",
      "←→": "profile.save",
      enter: "profile.save",
    };
    return keys[key] ?? null;
  }
  slotSummary() {
    const slots = this.snapshot.residents.flatMap((resident) => resident.slots);
    if (!slots.length) return null;
    return { total: slots.length, busy: slots.filter((slot) => slot.phase !== "idle").length };
  }
  onAuxiliaryKey(key: string): void {
    if (key === "q") {
      this.shutdown();
      return;
    }
    const list = this.auxiliaryRows();
    if (key === "up") this.auxiliaryIndex = Math.max(0, this.auxiliaryIndex - 1);
    if (key === "down")
      this.auxiliaryIndex = Math.min(Math.max(0, list.length - 1), this.auxiliaryIndex + 1);
    if (key === "r") this.reload();
    const index = Math.min(this.auxiliaryIndex, Math.max(0, list.length - 1));
    if (this.viewMode === "jobs" && key === "x") {
      const job = this.snapshot.jobs[index];
      if (job?.cancelable) void this.dispatch({ type: "job.cancel", jobId: job.id });
    }
    if (this.viewMode === "catalog" && key === "enter") {
      const entry = this.snapshot.catalog[index];
      if (entry && !entry.installed)
        void this.dispatch({ type: "catalog.pull", catalogId: entry.id });
    }
    if (this.viewMode === "runtimes") this.runtimeKey(key, index);
    this.draw();
  }
  private runtimeKey(key: string, index: number): void {
    const entry = this.snapshot.runtimes[index];
    if (!entry || entry.unavailableReason) return;
    if (key === "enter")
      void this.dispatch({
        type: entry.installed ? "runtime.select" : "runtime.install",
        runtimeId: entry.id,
      });
    if (key === "D" && entry.installed) {
      this.confirming = {
        kind: "action",
        action: { type: "runtime.remove", runtimeId: entry.id },
        label: `remove ${entry.label}?`,
      };
      this.setStatus(`${this.confirming.label} y / n`, "warn");
    }
  }
  auxiliaryIds(): string[] {
    if (this.viewMode === "catalog") return this.snapshot.catalog.map((entry) => entry.id);
    if (this.viewMode === "runtimes") return this.snapshot.runtimes.map((entry) => entry.id);
    return this.snapshot.jobs.map((entry) => entry.id);
  }
  auxiliaryRows(): string[] {
    if (this.viewMode === "catalog")
      return this.snapshot.catalog.map(
        (entry) => `${entry.installed ? "●" : " "} ${entry.displayName}  ${entry.description}`,
      );
    if (this.viewMode === "runtimes")
      return this.snapshot.runtimes.map(
        (entry) =>
          `${entry.selected ? "●" : " "} ${entry.label} ${entry.version}  ${entry.installed ? "installed" : "available"} ${entry.unavailableReason ?? ""}`,
      );
    return this.snapshot.jobs.map(
      (job) =>
        `${job.id}  ${job.operation} ${job.modelId ?? ""}  ${job.state} ${job.fraction === null ? "" : Math.round(job.fraction * 100) + "%"} ${job.error ?? job.progress.at(-1) ?? ""}`,
    );
  }
}
